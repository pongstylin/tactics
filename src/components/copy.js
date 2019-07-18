export default text => {
  let input = document.createElement('INPUT');
  input.type = 'text';
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'absolute';
  input.style.left = '-9999px';
  document.body.appendChild(input);

  input.select();
  document.execCommand('copy', false);
  input.remove();
};
