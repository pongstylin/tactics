import 'tactics/core.scss';
import clientFactory from 'client/clientFactory.js';
import Token from 'client/Token.js';
import popup from 'components/popup.js';

let authClient = clientFactory('auth');

window.addEventListener('DOMContentLoaded', () => {
  let identityToken = new Token(location.search.slice(1));

  if (authClient.playerId === identityToken.playerId)
    authClient.whenReady.then(() => popup({
      message: `This device is already associated with the ${authClient.playerName} account.`,
      buttons: [],
      onCancel: () => false,
      minWidth: '300px',
    }));
  else if (authClient.playerId)
    authClient.whenReady.then(() => popup({
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
            onCancel: () => false,
          }),
        }
      ],
      onCancel: () => false,
      minWidth: '300px',
    }));
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
        error.message = 'This link was removed';

      popup({
        message: error.toString(),
        onCancel: () => false,
        buttons: [],
      });
    });
}
