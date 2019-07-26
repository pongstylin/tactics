import 'tactics/core.scss';
import clientFactory from 'client/clientFactory.js';
import copy from 'components/copy.js';
import popup from 'components/popup.js';

window.addEventListener('DOMContentLoaded', () => {
  let authClient = clientFactory('auth');
  let gameClient = clientFactory('game');

  let txtPlayerName = document.querySelector('INPUT[name=playerName]');
  let btnCreate = document.querySelector('BUTTON[name=create]');
  let divSetup = document.querySelector('.setup');
  let divWaiting = document.querySelector('.waiting');
  let divReady = document.querySelector('.ready');
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
        let relLink = '/game.html?' + gameId;
        let absLink = location.origin + relLink;

        if (vs === 'me')
          location.href = relLink;
        else {
          let shareLink;
          if (navigator.share)
            shareLink = '<SPAN class="share"><SPAN class="fa fa-share"></SPAN><SPAN class="label">Share Game Link</SPAN></SPAN>';
          else
            shareLink = '<SPAN class="copy"><SPAN class="fa fa-copy"></SPAN><SPAN class="label">Copy Game Link</SPAN></SPAN>';

          let divShareLink = divReady.querySelector('.shareLink');
          divShareLink.innerHTML = shareLink;
          divShareLink.addEventListener('click', event => {
            if (navigator.share)
              navigator.share({
                title: 'Tactics',
                text: 'Want to play?',
                url: absLink,
              });
            else {
              copy(absLink);
              popup({
                message: 'Game link copied to clipboard.',
                buttons: [{ label:'Ok' }],
              });
            }
          });

          let divPlayLink = divReady.querySelector('.playLink');
          divPlayLink.innerHTML = `<A href="${relLink}">Wait for Opponent</A>`;

          divWaiting.style.display = 'none';
          divReady.style.display = null;
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
