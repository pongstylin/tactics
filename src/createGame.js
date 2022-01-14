import popup from 'components/popup.js';

const authClient = Tactics.authClient;
const gameClient = Tactics.gameClient;

window.addEventListener('DOMContentLoaded', () => {
  let txtPlayerName = document.querySelector('INPUT[name=playerName]');
  let btnCreate = document.querySelector('BUTTON[name=create]');
  let divConfigure = document.querySelector('.view.configure');
  let divWaiting = document.querySelector('.waiting');
  let divError = document.querySelector('.view.configure .row.error');

  let notice;
  if (navigator.onLine === false)
    notice = popup({
      message: 'The page will load once you are online.',
      buttons: [],
      closeOnCancel: false,
    });
  else if (!authClient.isOnline)
    notice = popup({
      message: 'Connecting to server...',
      buttons: [],
      closeOnCancel: false,
      autoOpen: 1000, // open after one second
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

  authClient.whenReady.then(async () => {
    if (notice)
      notice.close();

    if (!authClient.playerId)
      await authClient.register({ name:'Noob' })
        .catch(error => popup({
          message: 'There was an error while loading your account.',
          buttons: [],
          closeOnCancel: false,
        }));

    txtPlayerName.value = authClient.playerName;
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
    let gameTypeId = selGameType.querySelector(':checked').value;

    divConfigure.classList.remove('show');
    await Tactics.setup(gameTypeId, 'default');
    divConfigure.classList.add('show');
  });
  selGameType.addEventListener('change', async event => {
    let gameTypeId = selGameType.querySelector(':checked').value;
    let gameType = await gameClient.getGameType(gameTypeId);

    aChangeLink.style.display = gameType.isCustomizable ? '' : 'none';
  });
  // setTimeout() seemed to be necessary in Chrome to detect auto-fill of
  // dropdown after hitting the browser back button.
  setTimeout(() => {
    document.querySelector('SELECT[name=type]').dispatchEvent(
      new CustomEvent('change')
    );
    document.querySelector('INPUT[name=vs]:checked').dispatchEvent(
      new CustomEvent('change')
    );
  });

  document.querySelector('.fa.fa-info').addEventListener('click', event => {
    popup({
      title: 'The Tale of Two Blocking Systems',
      message: `In the original 'Luck' blocking system, attacks will succeed or
        fail depending on randomly generated numbers.  In the chess, a.k.a. No
        Luck, blocking system you will know if an attack will succeed ahead of
        time.  In both blocking systems, you can hover your mouse (or finger)
        over a tile you intend to attack.  This will display the chances (a
        percentage) or result (hit or block) for the attack.  Generally, if the
        percentage is high enough for an attack in luck mode, then it will
        succeed in chess, a.k.a. No Luck, mode.`,
      maxWidth: '500px',
    });
  });

  document.querySelectorAll('INPUT[name=vs]').forEach(radio => {
    radio.addEventListener('change', event => {
      if (radio.value === 'you') {
        document.querySelectorAll('INPUT[name=turnLimit]').forEach(radio => {
          radio.disabled = true;
        });

        btnCreate.textContent = 'Start Playing';
      }
      else {
        document.querySelectorAll('INPUT[name=turnLimit]').forEach(radio => {
          radio.disabled = false;
        });

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

    let gameTypeId = document.querySelector('SELECT[name=type] OPTION:checked').value;
    let vs = document.querySelector('INPUT[name=vs]:checked').value;
    let turnOrder = document.querySelector('INPUT[name=turnOrder]:checked').value;
    let turnLimit = document.querySelector('INPUT[name=turnLimit]:checked').value;
    let randomHitChance = document.querySelector('INPUT[name=randomHitChance]:checked').value;
    let gameOptions = {
      randomFirstTurn: turnOrder === 'random',
      collection: vs === 'public' ? 'public' : undefined,
      randomHitChance: randomHitChance === 'true',
      teams: [null, null],
    };

    let youSlot = turnOrder === '2nd' ? 1 : 0;

    gameOptions.teams[youSlot] = {
      playerId: authClient.playerId,
      set: { name:'default' },
    };

    if (vs !== 'you')
      gameOptions.turnTimeLimit = parseInt(turnLimit);

    let myGameQuery;
    let matchingGameQuery;
    let joinQuery;
    if (gameOptions.collection) {
      let excludedPlayerIds = new Set();

      if (authClient.playerId) {
        // Do not join my own waiting games.
        excludedPlayerIds.add(authClient.playerId);

        try {
          // Do not join waiting games against players we are already playing.
          let games = await gameClient.searchMyGames({
            filter: {
              // Game type must match player preference.
              type: gameTypeId,
              startedAt: { '!':null },
              endedAt: null,
            },
            sort: { field:'createdAt', order:'desc' },
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
            startedAt: null,
            // Game type must match player preference.
            type: gameTypeId,
            // Look for an open game with this player as a participant
            'teams[].playerId': authClient.playerId,
            // Time limit must match
            turnTimeLimit: gameOptions.turnTimeLimit,
            // First turn randomization must match player preference.
            randomFirstTurn: gameOptions.randomFirstTurn,
            // Blocking system must match player preference.
            randomHitChance: gameOptions.randomHitChance,
          },
          sort: 'createdAt',
          limit: 1,
        };

        matchingGameQuery = {
          filter: {
            startedAt: null,
            // Game type must match player preference.
            type: gameTypeId,
            // Look for an open game with this player as a participant
            'teams[].playerId': authClient.playerId,
          },
          sort: 'createdAt',
          limit: 1,
        };
      }

      joinQuery = {
        filter: {
          startedAt: null,
          // Game type must match player preference.
          type: gameTypeId,
          // Don't join games against disqualified players
          'teams[].playerId': { '!':[...excludedPlayerIds] },
          // Time limit must match
          turnTimeLimit: gameOptions.turnTimeLimit,
          // First turn randomization must match player preference.
          randomFirstTurn: gameOptions.randomFirstTurn,
          // Blocking system must match player preference.
          randomHitChance: gameOptions.randomHitChance,
        },
        sort: 'createdAt',
        limit: 1,
      };

      if (turnOrder === '1st')
        // 1st turn must be available
        joinQuery.filter['teams[0]'] = null;
      else if (turnOrder === '2nd')
        // 2nd turn must be available
        joinQuery.filter['teams[1]'] = null;
    }

    Promise.resolve()
      .then(async () => {
        let gameId = await joinOpenGame(joinQuery);
        if (gameId) return gameId;

        gameId = await findMyGame(myGameQuery, matchingGameQuery);
        if (gameId) return gameId;

        if (vs === 'you') {
          const themSlot = (youSlot + 1) % 2;

          // The set will be selected on the game page
          // ...unless the set is not customizable.
          gameOptions.teams[themSlot] = { playerId:authClient.playerId };
        }

        return gameClient.createGame(gameTypeId, gameOptions);
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

async function findMyGame(myGameQuery, matchingGameQuery) {
  if (!myGameQuery) return;

  // Use a matching existing public game, if any.
  let result = await gameClient.searchGameCollection('public', myGameQuery);
  if (result.count)
    return result.hits[0].id;

  // Cancel a game matching the game style
  result = await gameClient.searchGameCollection('public', matchingGameQuery);
  if (!result.count) return;

  gameClient.cancelGame(result.hits[0].id);
}

async function joinOpenGame(query) {
  if (!query) return;

  try {
    const result = await gameClient.searchGameCollection('public', query);
    if (!result.count) return;

    const hits = result.hits.filter(h => h.creatorACL?.type !== 'blocked');
    if (!hits.length) return;

    const gameSummary = hits[0];
    return gameClient.joinGame(gameSummary.id, { set:{ name:'default' }})
      .then(() => gameSummary.id);
  }
  catch (error) {
    // If somebody else beat us to joining the game, try again.
    if (error.code === 409)
      return joinOpenGame(query);

    // On any other error, bail out to create the game.
    console.warn('Failed to join open game', error);
    return;
  }
}
