window.tacticsUtils = window.tacticsUtils || {};

(function () {
    'use strict';

    tacticsUtils.getWebResourceJSON = function (url){ 

        // thank you https://developers.google.com/web/fundamentals/primers/promises#whats-all-the-fuss-about
         // Return a new promise.
        return new Promise(function(resolve, reject) {
            // Do the usual XHR stuff
            var req = new XMLHttpRequest();
            req.open('GET', url);

            req.onload = function() {
            // This is called even on 404 etc
            // so check the status
            if (req.status == 200) {
                // Resolve the promise with the response text
                resolve(JSON.parse(req.response));
            }
            else {
                // Otherwise reject with the status text
                // which will hopefully be a meaningful error
                reject(Error(req.statusText));
            }
            };

            // Handle network errors
            req.onerror = function() {
            reject(Error("Network Error"));
            };

            // Make the request
            req.send();
        });
    };
})();  