import config from 'config/client.js';

if (window.sessionStorage) {
  var data = window.sessionStorage.getItem('log');
  if (data)
    reportError(data);
}

window.onerror = function (message, source, lineno, colno, error) {
  try {
    reportError(JSON.stringify({
      createdAt: new Date(),
      page: location.href,
      name: error ? error.name : null,
      code: error ? error.code : null,
      message: message,
      source: source,
      lineno: lineno ? lineno : null,
      colno: colno ? colno : null,
      stack: error ? error.stack : null,
    }));
  }
  catch (e) {
    var error = 'Log error failed: ' + e;
    error = error.replace(/"/g, '\\"');

    reportError('{"error":"' + error + '"}');
  }
};

window.onunhandledrejection = function (event) {
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

function reportError(logData) {
  if (window.sessionStorage)
    window.sessionStorage.setItem('log', logData);

  $.ajax({
    method: 'POST',
    url: `${config.apiPrefix || ''}/errors`,
    contentType: 'application/json',
    data: logData,
  }).done(function () {
    if (window.sessionStorage)
      window.sessionStorage.removeItem('log');
  }).fail(function () {
    setTimeout(function () { reportError(logData) }, 5000);
  });
}
