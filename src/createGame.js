import 'tactics/core.scss';
import clientFactory from 'client/clientFactory.js';

window.addEventListener('DOMContentLoaded', () => {
  let authClient = clientFactory('auth');
  let gameClient = clientFactory('game');

  let greeting = document.querySelector('.greeting');
  let txtPlayerName = document.querySelector('INPUT[name=playerName]');
  let btnCreate = document.querySelector('BUTTON[name=create]');
  let btnSetup = document.querySelector('BUTTON[name=setup]');
  let divSetup = document.querySelector('.setup');
  let divWaiting = document.querySelector('.waiting');
  let divLink = document.querySelector('.link');
  let divError = document.querySelector('.setup .error');

  authClient.whenReady.then(() => {
    let playerName = authClient.playerName;
    if (playerName !== null) {
      greeting.innerHTML = `
        Welcome back, ${playerName}!  You may change your name here.<BR>
        Note: This won't change your name on previously created/joined games.
      `;
      txtPlayerName.value = playerName;
    }
    else {
      greeting.innerHTML = `Welcome!  Choose your game name.`;
      txtPlayerName.value = 'Noob';
    }

    divSetup.style.display = null;
  });

  btnCreate.addEventListener('click', () => {
    divSetup.style.display = 'none';
    divWaiting.style.display = null;

    let turnOrder = document.querySelector('INPUT[name=turnOrder]:checked').value;
    let stateData = {
      type:'classic',
      randomFirstTurn: turnOrder === 'random',
    };
    let slot = turnOrder === '2nd' ? 1 : 0;

    authClient.setAccountName(txtPlayerName.value)
      .then(() => gameClient.authorize(authClient.token))
      .then(() => gameClient.createGame(stateData))
      .then(gameId =>
        gameClient.joinGame(gameId, { slot }).then(() => gameId)
      )
      .then(gameId => {
        let link = location.origin + '/game.html?' + gameId;
        let anchor = document.querySelector('.link A');
        anchor.href = link;
        anchor.textContent = link;

        divWaiting.style.display = 'none';
        divLink.style.display = null;
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

  btnSetup.addEventListener('click', () => {
    divLink.style.display = 'none';
    divError.textContent = null;
    divSetup.style.display = null;
  });

  document.querySelector('.content').style.display = null;
});
