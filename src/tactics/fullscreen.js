Tactics.fullscreen = (function ( doc ) {
  var fullscreen,pollute = true,api,vendor;

  var apis =
  {
      // http://dvcs.w3.org/hg/fullscreen/raw-file/tip/Overview.html
      w3: {
        is: "taoIsFullscreen",
        enabled: "taoFullscreenEnabled",
        element: "taoFullscreenElement",
        request: "requestFullscreen",
        exit:    "exitFullscreen",
        events: {
          change: "fullscreenchange",
          error:  "fullscreenerror"
        }
      },
      webkit: {
        is:      function () { return doc.webkitIsFullScreen; },
        enabled: "webkitFullscreenEnabled",
        element: function () { return doc.webkitCurrentFullScreenElement; },
        request: "webkitRequestFullScreen",
        exit:    "webkitCancelFullScreen",
        events: {
          change: "webkitfullscreenchange",
          error:  "webkitfullscreenerror"
        }
      },
      moz: {
        is:      function () { return doc.mozFullScreen; },
        enabled: "mozFullScreenEnabled",
        element: function () { return doc.mozFullScreenElement; },
        request: "mozRequestFullScreen",
        exit:    "mozCancelFullScreen",
        events: {
          change: "mozfullscreenchange",
          error:  "mozfullscreenerror"
        }
      },
      ms: {
        is:      function () { return !!doc.msFullscreenElement; },
        enabled: "msFullscreenEnabled",
        element: function () { return doc.msFullscreenElement; },
        request: "msRequestFullscreen",
        exit:    "msExitFullscreen",
        events: {
          change: "MSFullscreenChange",
          error:  "MSFullscreenError"
        }
      }
    },
    w3 = apis.w3;

  // Loop through each vendor's specific API
  for (vendor in apis) {
    // Check if document has the "request" property
    if (apis[vendor].enabled in doc) {
      // It seems this browser support the fullscreen API
      api = apis[vendor];
      break;
    }
  }
  if (!api) api = apis.webkit;

  function dispatch( type, target ) {
    var event = doc.createEvent( "Event" );

    event.initEvent( type, true, false );
    target.dispatchEvent( event );
  } // end of dispatch()

  function handleChange( e )
  {
    // Recopy the enabled and element values
    doc[w3.enabled] = doc[api.enabled];
    doc[w3.element] = doc[api.element];

    dispatch( w3.events.change, e.target );
  } // end of handleChange()

  function handleError( e )
  {
    dispatch( w3.events.error, e.target );
  } // end of handleError()

  // Tactics functions return the prefixed value.
  if (api)
  {
    fullscreen =
    {
      isAvailable:function () { return doc[api.enabled]; },
      isEnabled:api.is,
      withElement:api.element,
      on:function () { return doc.documentElement[api.request](); },
      off:function () { return doc[api.exit]() },
      toggle:function () { return fullscreen[fullscreen.isEnabled() ? 'off' : 'on'](); }
    };

    // Pollute only if the API doesn't already exists
    if (pollute && !('fullscreenEnabled' in doc))
    {
      // Add listeners for fullscreen events
      doc.addEventListener( api.events.change, handleChange, false );
      doc.addEventListener( api.events.error,  handleError,  false );
    }
  }
  else
  {
    fullscreen =
    {
      isAvailable:function () { return false; },
      isEnabled:function () { return false; },
      withElement:function () { return null; },
      on:function () { return; },
      off:function () { return; },
      toggle:function () { return; },
    };
  }

  // Return the API found (or undefined if the Fullscreen API is unavailable)
  return fullscreen;
})(document);
