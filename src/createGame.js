import 'tactics/core.scss';
import clientFactory from 'client/clientFactory.js';

window.addEventListener('DOMContentLoaded', () => {
  let authClient = clientFactory('auth');
  let gameClient = clientFactory('game');

  let txtPlayerName = document.querySelector('INPUT[name=playerName]');
  let btnCreate = document.querySelector('BUTTON[name=create]');
  let divSetup = document.querySelector('.setup');
  let divWaiting = document.querySelector('.waiting');
  let divLink = document.querySelector('.link');
  let divError = document.querySelector('.setup .error');

  authClient.whenReady.then(() => {
    let playerName = authClient.playerName;
    if (playerName !== null) {
      txtPlayerName.value = playerName;
    }
    else {
      txtPlayerName.value = 'Noob';
    }

    divSetup.style.display = null;
  });

  document.querySelector('INPUT[name=vs][value=them').addEventListener('click', event => {
    document.querySelector('INPUT[name=turnOrder][value="1st"]').disabled = false;
    document.querySelector('INPUT[name=turnOrder][value="2nd"]').disabled = false;

    btnCreate.textContent = 'Create Game Link';
  });
  document.querySelector('INPUT[name=vs][value=me').addEventListener('click', event => {
    document.querySelector('INPUT[name=turnOrder][value=random]').checked = true;
    document.querySelector('INPUT[name=turnOrder][value="1st"]').disabled = true;
    document.querySelector('INPUT[name=turnOrder][value="2nd"]').disabled = true;

    btnCreate.textContent = 'Create and Join Game';
  });

  btnCreate.addEventListener('click', () => {
    divSetup.style.display = 'none';
    divWaiting.style.display = null;

    let vs = document.querySelector('INPUT[name=vs]:checked').value;
    let turnOrder = document.querySelector('INPUT[name=turnOrder]:checked').value;
    let stateData = {
      type: 'classic',
      randomFirstTurn: vs === 'me' || turnOrder === 'random',
      turnTimeLimit: 86400 * 7, // 7 days
    };
    let slot = turnOrder === '2nd' ? 1 : 0;

    authClient.setAccountName(txtPlayerName.value)
      .then(() => gameClient.createGame(stateData))
      .then(gameId => {
        if (vs === 'them')
          return gameClient.joinGame(gameId, { slot }).then(() => gameId);
        else
          return gameClient.joinGame(gameId)
            .then(() => gameClient.joinGame(gameId))
            .then(() => gameId);
      })
      .then(gameId => {
        let link = location.origin + '/game.html?' + gameId;

        if (vs === 'me')
          location.href = link;
        else {
          let anchor = document.querySelector('.link A');
          anchor.href = link;
          anchor.textContent = link;

          divWaiting.style.display = 'none';
          divLink.style.display = null;
        }
      })
      .catch(error => {
        if (error.code)
          divError.textContent = 'Error: '+error.message;
        else {
          console.error(error);
          divError.textContent = 'Unexpected client-side error';
        }

        divWaiting.style.display = 'none';
        divSetup.style.display = null;
      });
  });

  document.querySelector('.content').style.display = null;
});
