import { gameConfig } from 'config/client.js';
import Autosave from 'components/Autosave.js';
import popup from 'components/popup.js';

const authClient = Tactics.authClient;
const gameClient = Tactics.gameClient;

window.addEventListener('DOMContentLoaded', () => {
  const divPlayerSetup = document.querySelector('.playerSetup .indent');
  const btnCreate = document.querySelector('BUTTON[name=create]');
  const divConfigure = document.querySelector('.view.configure');
  const divWaiting = document.querySelector('.waiting');
  const divError = document.querySelector('.view.configure .row.error');

  const autosave = new Autosave({
    submitOnChange: true,
    defaultValue: false,
    value: 'Noob',
    maxLength: 20,
  }).on('submit', event => event.waitUntil(
    authClient.setAccountName(event.data),
  )).appendTo(divPlayerSetup);

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

    if (authClient.token)
      autosave.value = authClient.playerName;

    divConfigure.classList.add('show');
  });

  const selGameType = document.querySelector('SELECT[name=type]');
  const selSet = document.querySelector('SELECT[name=set]');
  const aChangeLink = document.querySelector('.change');
  const state = {};

  selGameType.addEventListener('change', async event => {
    selSet.disabled = true;
    selSet.selectedIndex = 0;
    selSet.options[0].textContent = 'Default';
    aChangeLink.style.display = '';

    const gameTypeId = selGameType.querySelector(':checked').value;
    const [ gameType, sets ] = await Promise.all([
      gameClient.getGameType(gameTypeId),
      gameClient.getPlayerSets(gameTypeId),
    ]);
    state.gameType = gameType;
    state.sets = sets;

    if (gameType.isCustomizable)
      aChangeLink.textContent = 'Change Set';
    else
      aChangeLink.textContent = 'View Set';

    if (sets.length > 1) {
      for (const setId of gameConfig.setsById.keys()) {
        const setOption = selSet.querySelector(`OPTION[value="${setId}"]`);
        const set = sets.find(s => s.id === setId);
        if (set) {
          setOption.style.display = '';
          setOption.textContent = set.name;
        } else
          setOption.style.display = 'none';
      }

      if (gameConfig.set === 'random') {
        selSet.selectedIndex = 4;
        aChangeLink.style.display = 'none';
      }
      selSet.disabled = false;
    }
  });
  selSet.addEventListener('change', event => {
    aChangeLink.style.display = selSet.selectedIndex === 4 ? 'none' : '';
  });
  aChangeLink.addEventListener('click', async event => {
    const setOption = selSet.querySelector(':checked');
    const setId = setOption.value;
    const setIndex = state.sets.findIndex(s => s.id === setId);
    const setBuilder = await Tactics.editSet({
      gameType: state.gameType,
      set: state.sets[setIndex],
    });
    const newSet = setBuilder.set;

    if (newSet.units.length > 0) {
      state.sets[setIndex] = newSet;
      setOption.textContent = state.sets[setIndex].name;
    } else {
      state.sets.splice(setIndex, 1);
      setOption.style.display = 'none';
      selSet.selectedIndex = 0;

      if (state.sets.length === 1)
        selSet.disabled = true;
    }
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

  document.querySelector('.fa.fa-info.style').addEventListener('click', event => {
    popup({
      title: 'Choosing Your Style',
      message: `
        Every style has different requirements on what sets you may use when
        playing a game in that style.  The word "set" is used to describe what
        units are on your team and where they are placed at the beginning of a
        game.  Some styles like "Classic" may not allow you to customize your
        set while most styles allow customization with various restrictions.
      `,
      maxWidth: '500px',
    });
  });
  document.querySelector('.fa.fa-info.selected-style').addEventListener('click', event => {
    popup({
      title: `${state.gameType.name} Style`,
      message: state.gameType.description,
      maxWidth: '500px',
    });
  });
  document.querySelector('.fa.fa-info.vs').addEventListener('click', event => {
    popup({
      title: 'Choosing Your Opponent',
      message: `
        <UL class="vs-info">
          <LI><B>Public</B> games allow you to get auto matched with another
          player or "jumped" by another player that sees your game in the public
          games list.</LI>

          <LI><B>Private</B> games allow you to choose your opponent by sharing
          a link with them so that they may join you.</LI>

          <LI><B>Tournament</B> games are for experienced players since your
          ability to undo is more limited and you may not create fork games
          until the game ends.  Also, if your time runs out, you will surrender
          automatically.</LI>

          <LI><B>Unrated</B> games are for friendly matches that won't affect
          your stats.  These are great for training games since you may use undo
          freely and in full view of your opponent.</LI>

          <LI><B>Practice</B> games are played against yourself or someone
          sharing your screen.  If possible, you are given the opportunity to
          choose what set you wish to play against.</LI>
        </UL>
      `,
      maxWidth: '500px',
    });
  });
  document.querySelector('.fa.fa-info.set').addEventListener('click', event => {
    popup({
      title: 'Choosing Your Set(up)',
      message: `
        Most game styles let you define up to 4 sets where you can customize
        what units are placed where.  You can do that by clicking the
        <B>Setup</B> button after choosing the style of interest in the lobby.
        Once you do, all of your sets for the selected game style will appear in
        the list.  Until then, you may still change the <B>Default</B> set via
        the <B>Change Set</B> link.  If you only see a <B>View Set</B> link, the
        selected game style does not allow custom sets.
      `,
      maxWidth: '500px',
    });
  });
  document.querySelector('.fa.fa-info.randomHitChance').addEventListener('click', event => {
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

  document.querySelectorAll('INPUT[name=vs]').forEach(vsRadio => {
    vsRadio.addEventListener('change', event => {
      document.querySelectorAll('INPUT[name=turnLimit]').forEach(turnLimitRadio => {
        turnLimitRadio.disabled = vsRadio.value === 'you';
      });

      if (vsRadio.value === 'you')
        btnCreate.textContent = 'Start Playing';
      else if (vsRadio.value === 'public')
        btnCreate.textContent = 'Create or Join Game';
      else
        btnCreate.textContent = 'Create Game Link';
    });
  });

  btnCreate.addEventListener('click', async () => {
    divConfigure.classList.remove('show');
    divWaiting.classList.add('show');

    const gameTypeId = document.querySelector('SELECT[name=type] OPTION:checked').value;
    const vs = document.querySelector('INPUT[name=vs]:checked').value;
    const set = document.querySelector('SELECT[name=set] OPTION:checked').value;
    const turnOrder = document.querySelector('INPUT[name=turnOrder]:checked').value;
    const turnLimit = document.querySelector('INPUT[name=turnLimit]:checked').value;
    const randomHitChance = document.querySelector('INPUT[name=randomHitChance]:checked').value;
    const gameOptions = {
      randomFirstTurn: turnOrder === 'random',
      collection: vs === 'public' ? 'public' : undefined,
      randomHitChance: randomHitChance === 'true',
      teams: [ null, null ],
    };

    const youSlot = turnOrder === '2nd' ? 1 : 0;
    const youTeam = gameOptions.teams[youSlot] = {
      playerId: authClient.playerId,
      set,
    };

    if (vs !== 'you') {
      gameOptions.turnTimeLimit = isNaN(turnLimit) ? turnLimit : parseInt(turnLimit);
      if (!state.gameType.hasFixedPositions)
        youTeam.randomSide = gameConfig.randomSide;

      if (vs !== 'unrated')
        gameOptions.rated = true;
    }
    if (vs === 'tournament')
      gameOptions.strictUndo = gameOptions.strictFork = gameOptions.autoSurrender = true;

    let myGameQuery;
    let matchingGameQuery;
    let joinQuery;
    if (gameOptions.collection) {
      const excludedPlayerIds = new Set();

      if (authClient.playerId) {
        // Do not join my own waiting games.
        excludedPlayerIds.add(authClient.playerId);

        try {
          // Do not join waiting games against players we are already playing.
          const games = await gameClient.searchMyGames({
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
            const team = g.teams.find(t => t.playerId !== authClient.playerId);
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
        let gameId = await joinOpenGame(joinQuery, youTeam);
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

async function joinOpenGame(query, youTeam) {
  if (!query) return;

  let gameSummary;

  try {
    const result = await gameClient.searchGameCollection('public', query);
    if (!result.count) return;

    const hits = result.hits.filter(h => h.creatorACL?.type !== 'blocked');
    if (!hits.length) return;

    gameSummary = hits[0];
    await gameClient.joinGame(gameSummary.id, {
      set: youTeam.set,
      randomSide: youTeam.randomSide,
    });

    return gameSummary.id;
  } catch (error) {
    if (error.code === 409)
      if (error.message === 'Already joined this game')
        // Open the already joined game (shouldn't happen)
        return gameSummary.id;
      else
        // Try again when somebody else beats us to joining the game
        return joinOpenGame(query, youTeam);

    // On any other error, bail out to create the game.
    console.warn('Failed to join open game', error);
    return;
  }
}
