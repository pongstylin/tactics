import 'tactics/core.scss';
import clientFactory from 'client/clientFactory.js';
import popup from 'components/popup.js';

let authClient = clientFactory('auth');
let gameClient = clientFactory('game');

window.addEventListener('DOMContentLoaded', () => {
  let txtPlayerName = document.querySelector('INPUT[name=playerName]');
  let btnCreate = document.querySelector('BUTTON[name=create]');
  let divSetup = document.querySelector('.setup');
  let divWaiting = document.querySelector('.waiting');
  let divError = document.querySelector('.setup .error');

  let notice;
  if (navigator.onLine === false)
    notice = popup({
      message: 'The page will load once you are online.',
      buttons: [],
      onCancel: () => false,
    });
  else if (!authClient.isOnline)
    notice = popup({
      message: 'Connecting to server...',
      buttons: [],
      onCancel: () => false,
      open: 1000, // open after one second
    });

  authClient.whenReady.then(() => {
    if (notice)
      notice.close();

    let playerName = authClient.playerName;
    if (playerName !== null)
      txtPlayerName.value = playerName;
    else
      txtPlayerName.value = 'Noob';

    divSetup.style.display = '';
  });

  document.querySelectorAll('INPUT[name=vs]').forEach(radio => {
    radio.addEventListener('change', event => {
      if (radio.value === 'you') {
        document.querySelector('INPUT[name=turnOrder][value=random]').checked = true;
        document.querySelector('INPUT[name=turnOrder][value="1st"]').disabled = true;
        document.querySelector('INPUT[name=turnOrder][value="2nd"]').disabled = true;

        btnCreate.textContent = 'Start Playing';
      }
      else {
        document.querySelector('INPUT[name=turnOrder][value="1st"]').disabled = false;
        document.querySelector('INPUT[name=turnOrder][value="2nd"]').disabled = false;

        if (radio.value === 'public')
          btnCreate.textContent = 'Create or Join Game';
        else
          btnCreate.textContent = 'Create Game Link';
      }
    });
  });

  btnCreate.addEventListener('click', () => {
    divSetup.style.display = 'none';
    divWaiting.style.display = '';

    let vs = document.querySelector('INPUT[name=vs]:checked').value;
    let turnOrder = document.querySelector('INPUT[name=turnOrder]:checked').value;
    let gameOptions = {
      type: 'classic',
      randomFirstTurn: vs === 'you' || turnOrder === 'random',
      turnTimeLimit: 86400 * 7, // 7 days
      isPublic: vs === 'public',
    };
    let slot =
      turnOrder === '1st' ? 0 :
      turnOrder === '2nd' ? 1 : null;

    let query;
    if (gameOptions.isPublic) {
      query = {
        filter: {
          // This player must not already be a participant.
          '!': [{ 'teams[].playerId':authClient.playerId }],
          // First turn randomization must match player preference.
          randomFirstTurn: turnOrder === 'random',
        },
        sort: 'created',
        limit: 1,
      };

      if (turnOrder === '1st')
        // First turn must be available.
        query.filter['teams[0]'] = null;
      else if (turnOrder === '2nd')
        // First turn must not be available.
        query.filter['!'].push({ 'teams[0]':null });
    }

    authClient.setAccountName(txtPlayerName.value)
      .then(() => joinOpenGame(query, slot))
      .then(gameId => {
        if (gameId)
          return gameId;

        return gameClient.createGame(gameOptions).then(gameId => {
          if (vs === 'you')
            return gameClient.joinGame(gameId)
              .then(() => gameClient.joinGame(gameId))
              .then(() => gameId);
          else
            return gameClient.joinGame(gameId, { slot })
              .then(() => gameId);
        });
      })
      .then(gameId => {
        location.href = '/game.html?' + gameId;
      })
      .catch(error => {
        if (error.code)
          divError.textContent = 'Error: '+error.message;
        else {
          console.error(error);
          divError.textContent = 'Unexpected client-side error';
        }

        divWaiting.style.display = 'none';
        divSetup.style.display = '';
      });
  });

  document.querySelector('.content').style.display = '';
});

async function joinOpenGame(query, slot) {
  if (!query) return;

  try {
    let result = await gameClient.searchOpenGames(query);
    if (!result.count) return;

    let gameSummary = result.hits[0];

    return gameClient.joinGame(gameSummary.id, { slot })
      .then(() => gameSummary.id);
  }
  catch (error) {
    // If somebody else beat us to joining the game, try again.
    if (error.code === 409)
      return joinOpenGame(query, slot);

    // On any other error, bail out to create the game.
    console.warn('Failed to join open game', error);
    return;
  }
}
