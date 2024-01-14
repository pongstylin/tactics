import { gameConfig } from 'config/client.js';
import Autosave from 'components/Autosave.js';
import popup from 'components/popup.js';

const authClient = Tactics.authClient;
const gameClient = Tactics.gameClient;
const teamName = new Autosave({
  submitOnChange: true,
  defaultValue: false,
  value: 'Noob',
  maxLength: 20,
});

window.addEventListener('DOMContentLoaded', () => {
  const divPlayerSetup = document.querySelector('.playerSetup .indent');
  const btnCreate = document.querySelector('BUTTON[name=create]');
  const divConfigure = document.querySelector('.view.configure');
  const divWaiting = document.querySelector('.waiting');
  const divError = document.querySelector('.view.configure .row.error');

  teamName.appendTo(divPlayerSetup);

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

  authClient.whenReady.then(async () => {
    if (notice)
      notice.close();

    await authClient.requireAuth();

    teamName.value = authClient.playerName;

    divConfigure.classList.add('show');
  });

  const selGameType = document.querySelector('SELECT[name=type]');
  const selSet = document.querySelector('SELECT[name=set]');
  const aChangeLink = document.querySelector('.change');
  const state = {};
  let untilStateReady = new Promise();

  selGameType.addEventListener('change', async event => {
    selSet.disabled = true;
    selSet.selectedIndex = 0;
    selSet.options[0].textContent = 'Default';
    aChangeLink.style.display = '';
    if (untilStateReady.isResolved)
      untilStateReady = new Promise();

    const gameTypeId = selGameType.querySelector(':checked').value;
    const [ gameType, sets ] = await Promise.all([
      gameClient.getGameType(gameTypeId),
      gameClient.getPlayerSets(gameTypeId),
    ]);
    state.gameType = gameType;
    state.sets = sets;
    untilStateReady.resolve();

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
    if (state.changeInProgress)
      return;
    state.changeInProgress = true;
    await untilStateReady;

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

    state.changeInProgress = false;
  });

  gameClient.getGameTypes().then(gameTypes => {
    const options = gameTypes.map(gameType => `<OPTION value="${gameType.id}">${gameType.name}</OPTION>`);
    const selGameType = document.querySelector('SELECT[name=type]');
    selGameType.innerHTML = options.join('');

    document.querySelector('SELECT[name=type]').dispatchEvent(new CustomEvent('change'));
  });

  // Detect auto-fill of dropdown in Chrome after using browser back button.
  window.addEventListener('load', () => {
    document.querySelector('INPUT[name=vs]:checked').dispatchEvent(new CustomEvent('change'));
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
  document.querySelector('.fa.fa-info.selected-style').addEventListener('click', async event => {
    if (state.infoInProgress)
      return;
    state.infoInProgress = true;
    await untilStateReady;

    popup({
      title: `${state.gameType.name} Style`,
      message: state.gameType.description,
      maxWidth: '500px',
    });

    state.infoInProgress = false;
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
  document.querySelector('.fa.fa-info.rated').addEventListener('click', event => {
    popup({
      title: 'To Be Rated, or Not To Be',
      message: `<P>Yes there are stats, but not like those in the original game.
        You can see how many times you have won, lost, or drawn against somebody
        by tapping their name in an active or completed game.  But, it only
        counts rated games.  It does not count unrated or fork games.</P>
        <P>In rated games, your opponent cannot see what you do until you are no
        longer able to undo without approval.  You can undo without approval if
        the undo button is enabled and white (not red).  Observers also can't
        see the last 2 turns to make it harder for them to assist.</P>
        <P>Unrated (and fork) games are similar to practice games in that you
        may undo previous turns or even after the game ends, but only with your
        opponent's approval.  Opponents and observers see everything.</P>`,
      maxWidth: '500px',
    });
  });

  document.querySelectorAll('INPUT[name=vs]').forEach(vsRadio => {
    vsRadio.addEventListener('change', event => {
      document.querySelectorAll('INPUT[name=turnLimit]').forEach(turnLimitRadio => {
        turnLimitRadio.disabled = vsRadio.value === 'you';
      });
      document.querySelectorAll('INPUT[name=rated]').forEach(ratedRadio => {
        ratedRadio.disabled = vsRadio.value === 'you';
      });
      if (vsRadio.value === 'you')
        document.querySelector('INPUT[name=rated][value=false]').checked = true;

      if (vsRadio.value === 'you')
        btnCreate.textContent = 'Start Playing';
      else if (vsRadio.value === 'public')
        btnCreate.textContent = 'Create or Join Game';
      else
        btnCreate.textContent = 'Create Game Link';
    });
  });

  btnCreate.addEventListener('click', async () => {
    if (state.createInProgress)
      return;
    state.createInProgress = true;
    await untilStateReady;

    divConfigure.classList.remove('show');
    divWaiting.classList.add('show');

    const gameTypeId = document.querySelector('SELECT[name=type] OPTION:checked').value;
    const vs = document.querySelector('INPUT[name=vs]:checked').value;
    const set = document.querySelector('SELECT[name=set] OPTION:checked').value;
    const turnOrder = document.querySelector('INPUT[name=turnOrder]:checked').value;
    const turnLimit = document.querySelector('INPUT[name=turnLimit]:checked').value;
    const randomHitChance = document.querySelector('INPUT[name=randomHitChance]:checked').value;
    const rated = document.querySelector('INPUT[name=rated]:checked').value;
    const gameOptions = {
      randomFirstTurn: turnOrder === 'random',
      collection: vs === 'public' ? 'public' : undefined,
      randomHitChance: randomHitChance === 'true',
      rated: rated === 'true',
      teams: [ null, null ],
    };

    const youSlot = turnOrder === '2nd' ? 1 : 0;
    const youTeam = gameOptions.teams[youSlot] = {
      playerId: authClient.playerId,
      name: teamName.value,
      set,
    };

    if (vs !== 'you') {
      gameOptions.turnTimeLimit = isNaN(turnLimit) ? turnLimit : parseInt(turnLimit);
      if (!state.gameType.hasFixedPositions)
        youTeam.randomSide = gameConfig.randomSide;
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

        state.createInProgress = false;
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
      name: teamName.value,
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
