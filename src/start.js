import waitForAdsCanBeLoaded from './ads-can-be-loaded';
import AS24AdSlot from './as24-ad-slot';
import AS24AdTargeting from './as24-ad-targeting';

waitUntilAdsCanBeLoaded()
    .then(() => {
        loadScript('https://www.googletagservices.com/tag/js/gpt.js');
        AS24AdSlot.registerElement('as24-ad-slot');
        AS24AdTargeting.registerElement('as24-ad-targeting');
    });
