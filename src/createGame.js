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

  btnCreate.addEventListener('click', async () => {
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

    let myGameQuery;
    let joinQuery;
    if (gameOptions.isPublic) {
      // Null teams don't count as a qualifying team.
      let excludedPlayerIds = new Set([null]);

      if (authClient.playerId) {
        // Do not join my own open games.
        excludedPlayerIds.add(authClient.playerId);

        try {
          // Do not join open games against players we are already playing.
          let games = await gameClient.searchMyGames({
            filter:{
              started: { '!':null },
              ended: null,
            },
            sort: { field:'created', order:'desc' },
            limit: 50,
          });

          games.hits.forEach(g => {
            let team = g.teams.find(t => t.playerId !== authClient.playerId);
            if (team)
              excludedPlayerIds.add(team.playerId);
          });
        }
        catch (e) {
          console.error(e);
        }

        myGameQuery = {
          filter: {
            'teams[].playerId': authClient.playerId,
            // First turn randomization must match player preference.
            randomFirstTurn: turnOrder === 'random',
          },
          sort: 'created',
          limit: 1,
        };

        if (turnOrder === '1st')
          // 1st turn must be available
          myGameQuery.filter['teams[0]'] = null;
        else if (turnOrder === '2nd')
          // 2nd turn must be available
          myGameQuery.filter['teams[1]'] = null;
      }

      joinQuery = {
        filter: {
          'teams[].playerId': { '!':[...excludedPlayerIds] },
          // First turn randomization must match player preference.
          randomFirstTurn: turnOrder === 'random',
        },
        sort: 'created',
        limit: 1,
      };

      if (turnOrder === '1st')
        // 1st turn must be available
        joinQuery.filter['teams[0]'] = null;
      else if (turnOrder === '2nd')
        // 2nd turn must be available
        joinQuery.filter['teams[1]'] = null;
    }

    authClient.setAccountName(txtPlayerName.value)
      .then(async () => {
        let gameId = await joinOpenGame(joinQuery, slot);
        if (gameId) return gameId;

        gameId = await findMyGame(myGameQuery);
        if (gameId) return gameId;

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

        // Log the error
        throw error;
      });
  });

  document.querySelector('.content').style.display = '';
});

async function findMyGame(query) {
  if (!query) return;

  try {
    let result = await gameClient.searchOpenGames(query);
    if (!result.count) return;

    return result.hits[0].id;
  }
  catch (error) {
    // On any other error, bail out to create the game.
    console.warn('Failed to join open game', error);
    return;
  }
}

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
