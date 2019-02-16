if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    notify('update', 'A new update has been installed.  <A href="javascript:location.reload()">Reload</A>');
  });
}

function notify(name, msg) {
  if ($('#notifications .'+name).length === 0)
    $('<DIV>')
      .addClass(name)
      .append(msg)
      .append('<SPAN class="close">X</SPAN>')
      .one('click', event => $(event.target).fadeOut())
      .hide()
      .appendTo('#notifications')
      .fadeIn();
}
