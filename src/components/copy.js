import 'components/copy.scss';
import popup from 'components/popup.js';

export const copy = text => {
  const input = document.createElement('INPUT');
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

export const copyLink = text => {
  const link = document.createElement('A');
  link.href = 'javascript:void(0)';
  link.classList.add('copy');
  link.innerHTML = `<SPAN class="fa fa-copy"></SPAN><SPAN class="text">${ text }</SPAN>`;
  link.addEventListener('click', event => {
    copy(text);
    popup(`The linked text was copied to the clipboard.`);
  });

  return link;
};

export const copyBlob = blob => new Promise((resolve, reject) => {
  if (navigator.clipboard === undefined)
    return reject('No Clipboard API');
  if (typeof ClipboardItem === 'undefined') {
    if (navigator.userAgent.indexOf('Firefox') > -1) {
      popup({
        message: [`
          Firefox does support copying images, but only if you enable the feature.
          To enable the feature, go to the `, copyLink('about:config'), ` page and
          search for `, copyLink(`dom.events.asyncClipboard.clipboardItem`), ` and
          use the toggle button to set it to "true".
        `],
        maxWidth: '312px',
      });
      return reject('Clipboard Item API disabled');
    }

    return reject('No Clipboard Item API');
  }

  const item = new ClipboardItem({ [ blob.type ]:blob });

  navigator.clipboard.write([ item ]).then(resolve, reject);
});

export default copy;
