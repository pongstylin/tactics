var logs = [];

if (window.sessionStorage) {
  logs = JSON.parse(window.sessionStorage.getItem('logs') || '[]');
  if (logs.length)
    reportErrors(JSON.stringify(logs));
}

window.onerror = (message, source, lineno, colno, error) => {
  try {
    logs.push({
      createdAt: new Date(),
      page: location.href,
      message: message,
      source: source,
      lineno: lineno ? lineno : null,
      colno: colno ? colno : null,
      stack: error ? error.stack : null,
    });

    var data = JSON.stringify(logs);

    if (window.sessionStorage)
      window.sessionStorage.setItem('logs', data);

    reportErrors(data);
  }
  catch (e) {
    var error = 'Log error failed: ' + e;
    error = error.replace(/"/g, '\\"');

    reportErrors('{"error":"' + error + '"}');
  }
};

window.onunhandledrejection = event => {
  try {
    var log = {
      createdAt: new Date(),
      page: location.href,
      promise: true,
    };
    var error = event.reason;

    if (error instanceof Error) {
      log.code = error.code;
      log.message = error.toString();
      log.stack = error.stack;
    }
    else {
      log.message = error + '';
    }

    logs.push(log);

    var data = JSON.stringify(logs);

    if (window.sessionStorage)
      window.sessionStorage.setItem('logs', data);

    reportErrors(data);
  }
  catch (e) {
    var error = 'Log reject failed: ' + e;
    error = error.replace(/"/g, '\\"');

    reportErrors('{"error":"' + error + '"}');
  }
};

function reportErrors(data) {
  $.ajax({
    method: 'POST',
    url: '/errors',
    contentType: 'application/json',
    data: data,
  }).done(() => {
    if (window.sessionStorage)
      window.sessionStorage.removeItem('logs');
    logs.length = 0;
  }).fail(() => {
    setTimeout(() => {
      if (window.sessionStorage)
        data = window.sessionStorage.getItem('logs');
      if (data)
        reportErrors(data);
    }, 5000);
  });
}
