import { once, adsAreDisabled, batch, debounce } from './helpers.js';

import * as cookie from './cookie.js';
import * as dom from './dom.js';

import { hasAttribute, getAttribute, setAttribute, removeAttribute, loadScript, ready as domready } from './dom.js';

(() => {

    const hideAdTargetingElements = () => {
        const style = document.createElement('style');
        style.innerHTML = 'as24-ad-targeting{display:none}';
        document.head.appendChild(style);
    };

    hideAdTargetingElements();

    const googletag = window.googletag = window.googletag || { cmd: [] };

    if (adsAreDisabled() || cookie.isUserDealer()) { return; }

    if (cookie.consentNeededAndNotGivenYet()) {
        // waiting for cookie-consent-given event
        // i.e. window.dispatchEvent(new Event('cookie-consent-given', { bubbles: true }))
        return window.addEventListener('cookie-consent-given', start);
    }

    start();

    function start() {

        loadScript('https://www.googletagservices.com/tag/js/gpt.js');

        const batchRefresh = batch(slots => {
            googletag.cmd.push(() => {
                // googletag.pubads().refresh(slots, { changeCorrelator: false });
                googletag.pubads().refresh(slots);
            });
        });

        let slotsToRefreshWhenInViewport = [];
        const rfr = () => {
            slotsToRefreshWhenInViewport.forEach(slot => {
                if (dom.isElementInViewport(slot)) {
                    slot.refreshAdSlot();
                }
            });
        };

        const debouncedRfr = debounce(rfr, 50);

        window.addEventListener('scroll', debouncedRfr);
        dom.ready(debouncedRfr);

        googletag.cmd.push(() => {
            const pubads = googletag.pubads();

            pubads.addEventListener('slotRenderEnded', eventData => {
                const element = document.querySelector(`#${eventData.slot.getSlotElementId()}`);
                if (element) {
                    const slotElement = element.parentNode;

                    if (eventData.isEmpty) {
                        setAttribute(slotElement, 'empty', '');
                    } else {
                        removeAttribute(slotElement, 'empty');
                    }
                }
            });

            pubads.enableSingleRequest();
            pubads.collapseEmptyDivs(false);
            pubads.disableInitialLoad();

            setTargeting(pubads);
            googletag.enableServices();
        });

        const prototype = Object.create(HTMLElement.prototype);

        prototype.attachedCallback = function() {
            if (doesScreenResolutionProhibitFillingTheAdSlot(this)) { return; }

            const slotType = getAttribute(this, 'type', 'doubleclick');

            switch(slotType) {
                case 'doubleclick':
                    loadDoubleClickAdSlot(this);
                    break;
                default:
                    return;
            }
        };

        prototype.detachedCallback = function() {
            googletag.cmd.push(() => {
                googletag.destroySlots([this.gptAdSlot]);
                this.gptAdSlot = undefined;
            });
        };

        prototype.refreshAdSlot = function() {
            slotsToRefreshWhenInViewport = slotsToRefreshWhenInViewport.filter(s => s !== this);
            setAttribute(this, 'loaded', '');
            batchRefresh(this.gptAdSlot);
        };

        const loadDoubleClickAdSlot = element => {
            const elementId = getAttribute(element, 'element-id') || `ad-slot-element-${Math.random() * 1000000 | 0}`;
            const adunit = getAttribute(element, 'ad-unit');
            const outOfPage = hasAttribute(element, 'out-of-page');

            const parseResolution = str => {
                const matches = str.replace(/[\s]/g, '').match(/([\d]+)x([\d]+)/i);

                if (matches && matches[2]) {
                    return [matches[1] | 0, matches[2] | 0];
                }

                return null;
            };

            const sizeMaps = [...element.attributes].filter(x => /size-map-/.test(x.nodeName)).map(x => ({ name: x.nodeName, value: x.value }))//.filter(x => /size-map-/.test(x.name));

            if (sizeMaps.length > 0) {

                const parsedSizeMaps = sizeMaps.map(m => {
                    return [parseResolution(m.name), m.value.split(',').map(parseResolution).filter(r => r && r[0] && r[1])];
                });

                parsedSizeMaps.sort((a, b) => {
                    const ax = a[0][0];
                    const ay = a[0][1];

                    const bx = b[0][0];
                    const by = b[0][1];

                    if (ax === bx) { return ay - by };
                    return bx - ax;
                });

                const smallest = parsedSizeMaps[parsedSizeMaps.length - 1];
                if (smallest[0][0] !== 0 || smallest[0][1] !== 0) {
                    parsedSizeMaps.push([[0,0],[]])
                }
                setAttribute(element, 'size-mapping', JSON.stringify(parsedSizeMaps));
            }

            const rawSizes = getAttribute(element, 'sizes');
            const rawSizeMapping = getAttribute(element, 'size-mapping');

            if (!adunit) { console.warn('Missing attribute: ad-unit parameter must be provided.'); return; }
            if (!outOfPage && !rawSizes && !rawSizeMapping) { console.warn('Missing attribute: either sizes or size-mapping must be provided if not out-of-page ad slot.'); return; }

            var sizes, sizeMapping;

            try {
                sizes = JSON.parse(rawSizes || '[]');
                sizeMapping = JSON.parse(rawSizeMapping || '[]');
            } catch(ex) {
                console.warn('Invalid attribute: either sizes or size-mapping attribute cannot be JSON-parsed.');
                return;
            }


            var adContainer = document.createElement('div');
            adContainer.id = elementId;

            element.appendChild(adContainer);

            googletag.cmd.push(() => {
                if (!document.body.contains(element)) {
                    console.warn('Ad container div was not available.');
                    return;
                }

                element.gptAdSlot = outOfPage
                        ? googletag.defineOutOfPageSlot(adunit, elementId).addService(googletag.pubads())
                        : googletag.defineSlot(adunit, sizes, elementId).defineSizeMapping(sizeMapping).addService(googletag.pubads());

                googletag.display(elementId);

                if (dom.isElementInViewport(element)) {
                    element.refreshAdSlot();
                } else {
                    slotsToRefreshWhenInViewport.push(element);
                }
            });
        };

        const doesScreenResolutionProhibitFillingTheAdSlot = el => {
            const pageResolution = {
                x: window.innerWidth,
                y: window.innerHeight
            };

            const minX = getAttribute(el, 'min-x-resolution', 0);
            const maxX = getAttribute(el, 'max-x-resolution', Infinity);
            const minY = getAttribute(el, 'min-y-resolution', 0);
            const maxY = getAttribute(el, 'max-y-resolution', Infinity);
            const resolutionRanges = getAttribute(el, 'resolution-ranges', '');

            if(resolutionRanges.length > 0) {
                const rangeArray = JSON.parse(resolutionRanges);
                for(var i = 0; i < rangeArray.length; i++){
                    var min = rangeArray[i][0] || 0;
                    var max = rangeArray[i][1] || 8192;
                    if ((pageResolution.x >= min) && (pageResolution.x <= max)) {
                        return false;
                        break;
                    }
                }
                return true;
            }

            return minX > pageResolution.x || maxX < pageResolution.x || minY > pageResolution.y || maxY < pageResolution.y;
        };

        const extend = (target, source) => {
            for (var key in source) {
                target[key] = source[key];
            }
            return target;
        };

        const setTargeting = pubads => {
            const targetingElements = Array.prototype.slice.call(document.querySelectorAll('as24-ad-targeting'));
            const targeting = targetingElements.map(el => JSON.parse(el.innerHTML || '{}')).reduce(extend, {});

            const matches = location.search.match(/test=([^&]*)/);
            if (matches && matches.length >= 2) {
                targeting.test = matches[1];
            }

            for (let key in targeting) {
                const value = `${targeting[key]}`.split(',');
                pubads.setTargeting(key, value);
            }
        };

        try {
            document.registerElement('as24-ad-slot', { prototype });
        } catch(ex) {
            console.warn('Custom element already registered: "as24-ad-slot".');
        }
    }

})();
