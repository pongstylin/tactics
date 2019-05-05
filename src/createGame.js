import 'tactics/core.scss';
import clientFactory from 'client/clientFactory.js';

window.addEventListener('DOMContentLoaded', () => {
  let authClient = clientFactory('auth');
  let gameClient = clientFactory('game');

  let greeting = document.querySelector('.greeting');
  let playerName = document.querySelector('INPUT[name=playerName]');
  let btnCreate = document.querySelector('BUTTON[name=create]');
  let btnSetup = document.querySelector('BUTTON[name=setup]');
  let divSetup = document.querySelector('.setup');
  let divWaiting = document.querySelector('.waiting');
  let divLink = document.querySelector('.link');
  let divError = document.querySelector('.setup .error');

  let userName = authClient.userName;
  if (userName !== null) {
    greeting.innerHTML = `
      Welcome back, ${userName}!  You may change your name here.<BR>
      Note: This won't change your name on previously created/joined games.
    `;
    playerName.value = userName;
  }
  else {
    greeting.innerHTML = `Welcome!  Choose your game name.`;
    playerName.value = 'Noob';
  }

  divSetup.style.display = null;

  btnCreate.addEventListener('click', () => {
    divSetup.style.display = 'none';
    divWaiting.style.display = null;

    let turnOrder = document.querySelector('INPUT[name=turnOrder][checked]').value;
    let stateData = { type:'classic' };
    let slot = 0;

    if (turnOrder === 'random')
      stateData.randomStart = true;
    else if (turnOrder === '2nd')
      slot = 1;

    authClient.setAccountName(playerName.value)
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
