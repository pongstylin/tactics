import 'plugins/index.js';
import 'tactics/core.scss';
import clientFactory from 'client/clientFactory.js';
import Token from 'client/Token.js';
import popup from 'components/popup.js';

const authClient = clientFactory('auth');

window.addEventListener('DOMContentLoaded', async () => {
  const tokenValue = location.search.slice(1).replace(/[&=].*$/, '');
  let identityToken;

  try {
    identityToken = new Token(tokenValue);
  } catch (e) {
    return popup({
      message: 'Oops!  This is not a valid account URL.',
      buttons: [],
      closeOnCancel: false,
      maxWidth: '300px',
    });
  }

  if (identityToken.isExpired)
    return popup({
      message: `Sorry!  This link has expired.`,
      buttons: [],
      closeOnCancel: false,
      maxWidth: '300px',
    });

  await authClient.whenReady;

  if (authClient.playerId === identityToken.playerId)
    popup({
      message: `This device is already associated with the ${authClient.playerName} account.`,
      buttons: [],
      closeOnCancel: false,
      maxWidth: '300px',
    });
  else if (authClient.playerId)
    popup({
      title: 'Transfer Device',
      message: `You are about to add this device to the ${identityToken.playerName} account.  This means the device must be removed from the ${authClient.playerName} account.  Do you want to proceed?`,
      buttons: [
        {
          label: 'Yes',
          onClick: () => addDevice(identityToken),
        },
        {
          label: 'No',
          onClick: () => popup({
            message: 'Cancelled device transfer.',
            buttons: [],
            closeOnCancel: false,
          }),
        }
      ],
      closeOnCancel: false,
      maxWidth: '300px',
    });
  else
    addDevice(identityToken);
});

function addDevice(identityToken) {
  authClient.addDevice(identityToken)
    .then(() => {
      location.href = '/online.html';
    })
    .catch(error => {
      if (error.code === 403)
        error.message = 'Sorry!  This link was either removed or already used on another device.  You may generate a new link and try again.';

      popup({
        message: error.message,
        closeOnCancel: false,
        buttons: [],
      });
    });
}
