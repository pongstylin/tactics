import popup from 'components/popup.js';

const authClient = Tactics.authClient;
const gameClient = Tactics.gameClient;

window.addEventListener('DOMContentLoaded', () => {
  let txtPlayerName = document.querySelector('INPUT[name=playerName]');
  let btnCreate = document.querySelector('BUTTON[name=create]');
  let divConfigure = document.querySelector('.view.configure');
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

    divConfigure.classList.add('show');
  });

  document.body.addEventListener('focus', event => {
    let target = event.target;
    if (target.matches('INPUT[type=text]'))
      target.select();
  }, true);
  document.body.addEventListener('blur', event => {
    let target = event.target;
    if (target.matches('INPUT[type=text]'))
      // Clear selection
      target.value = target.value;
  }, true);
  document.body.addEventListener('keydown', event => {
    let target = event.target;
    if (target.matches('INPUT[type=text]'))
      if (event.keyCode === 13)
        event.target.blur();
  }, true);
  document.body.addEventListener('input', event => {
    let target = event.target;
    if (target.matches('INPUT[type=text]')) {
      let inputTextAutosave = event.target.parentElement;
      inputTextAutosave.classList.remove('is-saved');
      inputTextAutosave.classList.remove('is-saving');
    }
  }, true);

  let divAccountAutoSave = document.querySelector('.inputTextAutosave');
  let divAccountError = divAccountAutoSave.nextElementSibling;
  let txtAccountName = divAccountAutoSave.querySelector('INPUT');
  txtAccountName.addEventListener('blur', event => {
    let newAccountName = txtAccountName.value.trim().length
      ? txtAccountName.value.trim() : null;

    if (newAccountName === null)
      newAccountName = authClient.playerName;

    // Just in case spaces were trimmed or the name unset.
    txtAccountName.value = newAccountName;

    divAccountError.textContent = '';

    if (newAccountName === authClient.playerName)
      divAccountAutoSave.classList.add('is-saved');
    else {
      divAccountAutoSave.classList.remove('is-saved');
      divAccountAutoSave.classList.add('is-saving');

      authClient.setAccountName(newAccountName)
        .then(() => {
          divAccountAutoSave.classList.remove('is-saving');
          divAccountAutoSave.classList.add('is-saved');
        })
        .catch(error => {
          divAccountAutoSave.classList.remove('is-saving');
          divAccountError.textContent = error.toString();
        });
    }
  });

  let selGameType = document.querySelector('SELECT[name=type]');
  let aChangeLink = document.querySelector('.change');
  aChangeLink.addEventListener('click', async event => {
    let gameType = selGameType.querySelector(':checked').value;

    divConfigure.classList.remove('show');
    await Tactics.setup(gameType);
    divConfigure.classList.add('show');
  });
  selGameType.addEventListener('change', event => {
    let gameType = selGameType.querySelector(':checked').value;

    aChangeLink.style.display = gameType === 'classic' ? 'none' : '';
  });
  document.querySelector('SELECT[name=type]').dispatchEvent(
    new CustomEvent('change')
  );

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
    divConfigure.classList.remove('show');
    divWaiting.classList.add('show');

    let type = document.querySelector('SELECT[name=type] OPTION:checked').value;
    let vs = document.querySelector('INPUT[name=vs]:checked').value;
    let turnOrder = document.querySelector('INPUT[name=turnOrder]:checked').value;
    let gameOptions = {
      type: type,
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
      let excludedPlayerIds = new Set();

      if (authClient.playerId) {
        // Do not join my own open games.
        excludedPlayerIds.add(authClient.playerId);

        try {
          // Do not join open games against players we are already playing.
          let games = await gameClient.searchMyGames({
            filter:{
              // Game type must match player preference.
              type: type,
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
            // Game type must match player preference.
            type: type,
            // Look for an open game with this player as a participant
            'teams[].playerId': authClient.playerId,
            // First turn randomization must match player preference.
            randomFirstTurn: turnOrder === 'random',
          },
          sort: 'created',
          limit: 1,
        };

        if (turnOrder === '1st')
          // 2nd turn must be available
          myGameQuery.filter['teams[1]'] = null;
        else if (turnOrder === '2nd')
          // 1st turn must be available
          myGameQuery.filter['teams[0]'] = null;
      }

      joinQuery = {
        filter: {
          // Game type must match player preference.
          type: type,
          // Don't join games against disqualified players
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

    // Usually redundant, but helpful for creating new accounts.
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

        divWaiting.classList.remove('show');
        divConfigure.classList.add('show');

        // Log the error
        throw error;
      });
  });
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
