window.tacticsUtils = window.tacticsUtils || {};

(function () {
    'use strict';

    tacticsUtils.getWebResourceJSON = function (url) {
        return fetch(url).then(response => response.json());
    }
})();  