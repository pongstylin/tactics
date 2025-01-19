import config from 'config/client.js';

if (window.sessionStorage) {
  var data = window.sessionStorage.getItem('reportData');
  if (data)
    sendReport(data);
}

var errorListener = function (event) {
  try {
    var now = new Date();

    report({
      type: event.type,
      message: event.message,
      filename: event.filename,
      lineno: event.lineno === undefined ? null : event.lineno,
      colno: event.colno  === undefined ? null : event.colno,
      error: event.error ? getErrorData(event.error) : null,
    }, now);
  }
  catch (e) {
    var error = 'Log error failed: ' + e;
    error = error.replace(/"/g, '\\"');

    sendReport('{"error":"' + error + '"}');
  }
};

var unhandledrejectionListener = function (event) {
  try {
    var now = new Date();
    var reportData = {
      type: event.type,
    };
    var promise = event.promise;
    var error = event.reason;

    if (promise.ignoreConnectionReset && error === 'Connection reset')
      return event.preventDefault();

    if (error instanceof Error)
      reportData.error = getErrorData(error);
    else if (error instanceof Event)
      reportData.error = getEventData(error);
    else if (error !== undefined)
      reportData.error = error + '';
    reportData.promise = promise.tags;

    report(reportData, now);
  } catch (e) {
    var error = 'Log reject failed: ' + e;
    error = error.replace(/"/g, '\\"');

    sendReport('{"error":"' + error + '"}');
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
      type: 'error',
      message: message,
      filename: source,
      lineno: lineno,
      colno: colno,
      error: error
    });
  };
  window.onunhandledrejection = unhandledrejectionListener;
}

function getErrorData(error) {
  if (!(error instanceof Error))
    return { message:error };

  var stack = error.stack;
  if (typeof stack === 'string') {
    stack = stack.split('\n');
    if (stack[0] === `${error.name}: ${error.message}`)
      stack.shift();
  }

  return {
    name: error.name,
    code: error.code,
    message: error.message,
    fileName: error.fileName,
    lineNumber: error.lineNumber,
    columnNumber: error.columnNumber,
    stack,
  };
}
function getEventData(error) {
  var data = {};
  var key;

  for (key in error) {
    if (error[key] instanceof Node)
      data[key] = 'Node';
    else if (error[key] instanceof Window)
      data[key] = 'Window';
    else
      data[key] = error[key];
  }

  return { type:'Event', data:data };
}

function reportError(error) {
  var now = new Date();

  if (error instanceof Error)
    report({ error:getErrorData(error) }, now);
  else
    report({ error }, now);
}

function report(data, now) {
  if (now === undefined)
    now = new Date();
  if (data === undefined || data === null)
    return;

  if (typeof data !== 'object')
    data = { report:data };

  data.createdAt = now;
  data.page = location.href;

  try {
    sendReport(JSON.stringify(data));
  } catch (e) {
    var error = 'Stringify report failed: ' + e;
    error = error.replace(/"/g, '\\"');
    error = error.replace(/\n/g, '\\n');

    sendReport('{"error":"' + error + '"}');
  }
}

function sendReport(data) {
  if (window.sessionstorage)
    window.sessionstorage.setItem('reportData', data);

  $.ajax({
    method: 'POST',
    url: config.local.apiEndpoint + '/report',
    contentType: 'application/json',
    data: data
  }).done(function () {
    if (window.sessionStorage)
      window.sessionStorage.removeItem('reportData');
  }).fail(function () {
    setTimeout(function () { sendReport(data) }, 5000);
  });
}

window.report = report;
window.reportError = reportError;
window.getErrorData = getErrorData;
