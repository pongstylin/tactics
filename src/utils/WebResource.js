window.tacticsUtils = window.tacticsUtils || {};

(function () {
    'use strict';

    tacticsUtils.getWebResourceJSON = function (url) {
        return fetch(url).then(function (response) {
            if (response.ok) {
                return response.json();
            }
            throw new Error('Network response was not ok.');
        });
    }
})();  