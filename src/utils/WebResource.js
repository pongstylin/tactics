window.tacticsUtils = window.tacticsUtils || {};

(function () {
    'use strict';

    tacticsUtils.getWebResourceJSON = function (url){ 
        return new Promise(function(resolve, reject) {
           fetch(url).then(function(response) {
               if (response.ok)
                {
                    resolve(response.json());
                }
                else
                {
                    reject(Error('Error when getting web resource.'));
                }
           }
           ).catch(function(error) 
           {
            reject(Error(error));
           });
        });
    };
})();  