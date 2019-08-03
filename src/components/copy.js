export default text => {
  let input = document.createElement('INPUT');
  input.type = 'text';
  input.value = text;
  input.readOnly = true;
  input.style.position = 'absolute';
  input.style.top = window.pageYOffset+'px';
  input.style.left = '-9999px';
  input.style.fontSize = '12pt';
  input.style.border = '0';
  input.style.padding = '0';
  input.style.margin = '0';
  document.body.appendChild(input);

  input.select();
  input.setSelectionRange(0, input.value.length);
  document.execCommand('copy', false);
  input.remove();
};
