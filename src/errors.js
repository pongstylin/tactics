import config from 'config/client.js';

if (window.sessionStorage) {
  var data = window.sessionStorage.getItem('log');
  if (data)
    reportError(data);
}

var errorListener = function (event) {
  console.log('error', event);
  try {
    reportError(JSON.stringify({
      createdAt: new Date(),
      page:    location.href,
      name:    event.error ? event.error.name : null,
      code:    event.error ? event.error.code : null,
      message: event.message,
      source:  event.filename,
      lineno:  event.lineno === undefined ? null : event.lineno,
      colno:   event.colno  === undefined ? null : event.colno,
      stack:   event.error ? event.error.stack : null
    }));
  }
  catch (e) {
    var error = 'Log error failed: ' + e;
    error = error.replace(/"/g, '\\"');

    reportError('{"error":"' + error + '"}');
  }
};

var unhandledrejectionListener = function (event) {
  try {
    var log = {
      createdAt: new Date(),
      page: location.href,
      promise: true,
    };
    var promise = event.promise;
    var error = event.reason;

    if (promise.ignoreConnectionReset && error === 'Connection reset')
      return event.preventDefault();

    if (error instanceof Error) {
      log.name = error.name;
      log.code = error.code;
      log.message = error.toString();
      log.stack = error.stack;
    }
    else if (error !== undefined) {
      log.message = error + '';
    }

    reportError(JSON.stringify(log));
  }
  catch (e) {
    var error = 'Log reject failed: ' + e;
    error = error.replace(/"/g, '\\"');

    reportError('{"error":"' + error + '"}');
  }
};

/*
 * "Cannot set property onunhandledrejection of [object Object] which has only a getter"
 *
 * I don't know why I got this strange error since the property should always be
 * settable even if it doesn't exist.  So, let's favor 'addEventListener' and
 * fallback to assignment if necessary.
 */
try {
  window.addEventListener('error', errorListener);
  window.addEventListener('unhandledrejection', unhandledrejectionListener);
}
catch (e) {
  window.onerror = function (message, source, lineno, colno, error) {
    errorListener({
      message: message,
      filename: source,
      lineno: lineno,
      colno: colno,
      error: error
    });
  };
  window.onunhandledrejection = unhandledrejectionListener;
}

function reportError(logData) {
  if (window.sessionstorage)
    window.sessionstorage.setitem('log', logData);

  $.ajax({
    method: 'POST',
    url: `${config.apiPrefix || ''}/errors`,
    contentType: 'application/json',
    data: logData
  }).done(function () {
    if (window.sessionStorage)
      window.sessionStorage.removeItem('log');
  }).fail(function () {
    setTimeout(function () { reportError(logData) }, 5000);
  });
}

window.reportError = reportError;
