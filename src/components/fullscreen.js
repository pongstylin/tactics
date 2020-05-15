let apis = {
  // http://dvcs.w3.org/hg/fullscreen/raw-file/tip/Overview.html
  w3: {
    is: 'taoIsFullscreen',
    enabled: 'taoFullscreenEnabled',
    element: 'taoFullscreenElement',
    request: 'requestFullscreen',
    exit: 'exitFullscreen',
    events: {
      change: 'fullscreenchange',
      error: 'fullscreenerror',
    },
  },
  webkit: {
    is: () => document.webkitIsFullScreen,
    enabled: 'webkitFullscreenEnabled',
    element: () => document.webkitCurrentFullScreenElement,
    request: 'webkitRequestFullScreen',
    exit: 'webkitCancelFullScreen',
    events: {
      change: 'webkitfullscreenchange',
      error: 'webkitfullscreenerror',
    },
  },
  moz: {
    is: () => document.mozFullScreen,
    enabled: 'mozFullScreenEnabled',
    element: () => document.mozFullScreenElement,
    request: 'mozRequestFullScreen',
    exit: 'mozCancelFullScreen',
    events: {
      change: 'mozfullscreenchange',
      error: 'mozfullscreenerror',
    },
  },
  ms: {
    is: () => !!document.msFullscreenElement,
    enabled: 'msFullscreenEnabled',
    element: () => document.msFullscreenElement,
    request: 'msRequestFullscreen',
    exit: 'msExitFullscreen',
    events: {
      change: 'MSFullscreenChange',
      error: 'MSFullscreenError',
    },
  },
};
let w3 = apis.w3;

// Loop through each vendor's specific API
let api;
for (let vendor in apis) {
  // Check if document has the "request" property
  if (apis[vendor].enabled in document) {
    // It seems this browser support the fullscreen API
    api = apis[vendor];
    break;
  }
}
if (!api) api = apis.webkit;

function dispatch(type, target) {
  let event = document.createEvent('Event');

  event.initEvent( type, true, false );
  target.dispatchEvent( event );
}

let fullscreen;
if (api) {
  fullscreen = {
    isAvailable: () => document[api.enabled],
    isEnabled: api.is,
    withElement: api.element,
    on: () => document.documentElement[api.request](),
    off: () => document[api.exit](),
    toggle: () => fullscreen[fullscreen.isEnabled() ? 'off' : 'on'](),
  };

  // Pollute only if the API doesn't already exists
  if (!('fullscreenEnabled' in document)) {
    // Add listeners for fullscreen events
    document.addEventListener(api.events.change, event => {
      // Recopy the enabled and element values
      document[w3.enabled] = document[api.enabled];
      document[w3.element] = document[api.element];

      dispatch(w3.events.change, event.target);
    });
    document.addEventListener(api.events.error, event => {
      dispatch(w3.events.error, event.target);
    });
  }
}
else {
  fullscreen = {
    isAvailable: () => false,
    isEnabled: () => false,
    withElement: () => null,
    on: () => {},
    off: () => {},
    toggle: () => {},
  };
}

// Return the API found (or undefined if the Fullscreen API is unavailable)
export default fullscreen;
