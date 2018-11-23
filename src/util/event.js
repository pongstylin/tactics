window.utils = window.utils || {};

(function () {
  'use strict';

  utils.addEvents = function () {
    var self = this;
    var events = {};

    $.extend(self, {
      hasListeners: function (types) {
        return !!types.split(' ').find(type => type in events && events[type].length > 0);
      },

      on: function (types, fn) {
        types.split(' ').forEach(type => {
          events[type] = events[type] || [];
          events[type].push(fn);
        });

        return self;
      },

      emit: function (event) {
        (events[event.type] || []).forEach(fn => fn.call(self, event));

        return self;
      },

      off: function (types, fn) {
        if (types) {
          types.split(' ').forEach(type => {
            if (!events[type]) return;

            if (fn) {
              let index = events[type].indexOf(fn);
              if (index > -1)
                events[type].splice(index, 1);
            }
            else {
              delete events[type];
            }
          });
        }
        else {
          events = {};
        }

        return self;
      }
    });

    return self;
  };
})();
