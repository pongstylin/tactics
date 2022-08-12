import config from 'config/client.js';
import copy from 'components/copy.js';
import share from 'components/share.js';
import ScrollButton from 'components/ScrollButton.js';
import sleep from 'utils/sleep.js';
import Autosave from 'components/Autosave.js';
import Setup from 'components/Setup.js';
import whenDOMReady from 'components/whenDOMReady.js';
import whenTransitionEnds from 'components/whenTransitionEnds.js';
import LobbySettingsModal from 'components/Modal/LobbySettings.js';

// We will be fetching the updates games list from the server on this interval
const GAMES_FETCH_INTERVAL = 5 * 1000;

const authClient = Tactics.authClient;
const gameClient = Tactics.gameClient;
const pushClient = Tactics.pushClient;
const popup = Tactics.popup;

const styles = new Map([
  [ 'freestyle',        'Freestyle' ],
  [ 'classic',          'Classic' ],
  [ 'droplessGray',     'Dropless Gray' ],
  [ 'fpsGray',          'FPS Gray' ],
  [ 'legendsGray',      'Legends Gray' ],
  [ 'alphaTurtle',      'Alpha Turtle' ],
  [ 'legendsTurtle',    'Legends Turtle' ],
  [ 'fpsGold',          'FPS Gold' ],
  [ 'legendsGold',      'Legends Gold' ],
  [ 'legendsGoldNoDSM', 'Legends Gold (no DSM)' ],
  [ 'delta',            'Delta Force' ],
  [ 'moderator',        'Moderator' ],
]);

const groups = new Map([
  [ 'lobby',    'Lobby' ],
  [ 'active',   'Active Games' ],
  [ 'complete', 'Completed Games' ],
]);

let myPlayerId = null;
const state = {
  audioEnabled: false,
  activeGameId: null,
  // Indicates the currently selected tab
  currentTab: null,
  tabContent: {
    stats: {
      isSynced: false,
      whenSynced: Promise.resolve(),
      byCollection: new Map(),
    },
    yourGames: {
      // Indicates whether the tab content is loaded, rendered, and visible.
      isOpen: false,
      // Indicates whether the tab content is synced (groups are joined)
      // This is expected to be synced even if tab is not open.
      isSynced: false,
      whenSynced: Promise.resolve(),
      // Indicates that loading tab content is in progress.
      isLoading: false,
      // Used to update game clocks
      renderTimeout: null,
    },
    lobby: {
      // Indicates we should do a dramatic open of the lobby
      firstOpen: true,
      // The tab can be open, but not synced (spinner is shown)
      isOpen: false,
      // This should only be synced while the tab is open
      isSynced: false,
      // The value of this promise tells us the styleId that was joined
      whenSynced: Promise.resolve(),
      isLoading: false,
      selectedStyleId: null,
      selectedGroupId: 'lobby',
      sets: null,
    },
    publicGames: {
      isOpen: false,
      isSynced: false,
      whenSynced: Promise.resolve(),
      isLoading: false,
      renderTimeout: null,
    },
  },
  settings: null,
  avatars: new Map(),
};
const fillArenaQueueMap = new Map();

const settings = new LobbySettingsModal({
  autoShow: false,
  hideOnCancel: true,
}).on('settings', event => {
  state.settings = event.data;
});

const pushPublicKey = Uint8Array.from(
  atob(
    config.pushPublicKey
      .replace(/-/g, '+').replace(/_/g, '/')
  ),
  chr => chr.charCodeAt(0),
);

let avatars;
let arena;
const avatarsPromise = Tactics.load([ 'avatars' ]).then(async () => {
  if (Howler.ctx.state === 'running')
    state.audioEnabled = true;
  else {
    const stateChangeListener = () => {
      if (Howler.ctx.state !== 'running')
        return;

      Howler.ctx.removeEventListener('statechange', stateChangeListener);
      state.audioEnabled = true;
    };
    Howler.ctx.addEventListener('statechange', stateChangeListener);
  }

  avatars = Tactics.getSprite('avatars');
  arena = avatars.getImage('arena');
  ScrollButton.config.icons = {
    up: avatars.getImage('scrollup').src,
    down: avatars.getImage('scrolldown').src,
  };
  ScrollButton.config.howls = {
    hover: avatars.getSound('focus').howl,
    click: avatars.getSound('select').howl,
  };

  await whenDOMReady;
  renderLobby();
});

const getAvatar = (playerId, direction) => {
  const avatar = state.avatars.get(playerId);

  return Tactics.drawAvatar(avatar, { direction, withShadow:true });
};

gameClient
  .on('event', ({ body }) => {
    const statsContent = state.tabContent.stats;
    const yourContent = state.tabContent.yourGames;
    const lobbyContent = state.tabContent.lobby;
    const publicContent = state.tabContent.publicGames;

    if (body.group === `/myGames/${authClient.playerId}`) {
      if (body.type === 'stats') {
        yourContent.stats = body.data;
        renderStats('my');
      } else if (body.type === 'add' || body.type === 'change')
        setYourGame(body.data);
      else if (body.type === 'remove')
        unsetYourGame(body.data);
    } else if (body.group === '/collections') {
      if (body.type === 'stats') {
        statsContent.byCollection.set(body.data.collectionId, body.data.stats);
        renderStats('collections');
      }
    } else if (body.group === `/collections/lobby/${lobbyContent.selectedStyleId}`) {
      if (body.type === 'add' || body.type === 'change')
        setLobbyGame(body.data);
      else if (body.type === 'remove')
        unsetLobbyGame(body.data);
    } else if (body.group === '/collections/public') {
      if (body.type === 'add' || body.type === 'change')
        setPublicGame(body.data);
      else if (body.type === 'remove')
        unsetPublicGame(body.data);
    }
  })
  .on('open', async ({ data:{ reason } }) => {
    if (state.currentTab === null || reason === 'resume')
      return;

    /*
     * Now that the connection is open, sync the current tab.  This is always
     * required regardless of whether the page has never finished loading any
     * data or if tabs have changed while offline or if a tab was in the middle
     * of being loaded.  But just in case any tabs were synced at the time we
     * lost connection, mark them as no longer synced.
     */
    for (const tabContent of Object.values(state.tabContent)) {
      tabContent.isSynced = false;
      tabContent.whenSynced = Promise.resolve();
    }
    syncTab();
  })
  .on('close', ({ data:{ reopen } }) => {
    const divLoading = document.querySelector('.tabContent .loading');
    if (reopen)
      divLoading.classList.add('is-active');
  });

window.addEventListener('DOMContentLoaded', () => {
  const divGreeting = document.querySelector('.greeting');
  const divNotice = document.querySelector('#notice');

  if (authClient.token) {
    // Just in case fetching the most recent info is slow...
    divGreeting.textContent = `Welcome, ${authClient.playerName}!`;
    divGreeting.style.display = '';

    if (navigator.onLine === false)
      divNotice.textContent = 'Your games will be loaded once you are online.';
    else
      divNotice.textContent = 'Loading your games...';
  } else
    showRegister();

  authClient.whenReady.then(async () => {
    myPlayerId = authClient.playerId;

    if (myPlayerId) {
      divGreeting.textContent = `Welcome, ${authClient.playerName}!`;
      await openTab();
      divNotice.textContent = '';
      document.querySelector('.tabs').style.display = '';
    } else
      showRegister();
  });

  if (navigator.serviceWorker)
    navigator.serviceWorker.ready
      .catch(error => {
        // This can happen when 'Delete cookies and site data when Firefox is closed' option is enabled.
        if (error.name === 'SecurityError' && error.code === 18 && error.message === 'The operation is insecure.')
          return null;
        throw error;
      })
      .then(renderPN);
  else
    document.querySelector('#pn').innerHTML = 'Your browser does not support push notifications.';

  document.querySelector('.tabs UL').addEventListener('click', event => {
    const liTab = event.target.closest('LI:not(.is-active)');
    if (!liTab) return;

    const tab = getTabNameForElement(liTab);
    if (!tab) return;

    location.hash = '#' + tab;
  });

  const getShareGameMessage = async gameId => {
    const gameData = await gameClient.getGameData(gameId);
    const gameType = await gameClient.getGameType(gameData.state.type);

    let message = `Want to play a ${gameType.name} game`;
    if (gameData.state.turnTimeLimit === 120)
      message += ' at 2min per turn';
    else if (gameData.state.turnTimeLimit === 30)
      message += ' at 30sec per turn';
    if (!gameData.state.randomHitChance)
      message += ' without luck';
    message += '?';

    return message;
  };
  const gameClickHandler = async event => {
    const divGame = event.target.closest('.game');
    if (!divGame) return;

    const gameId = divGame.id;
    const link = location.origin + '/game.html?' + gameId;

    const spnCopy = event.target.closest('.copy');
    if (spnCopy) {
      const message = await getShareGameMessage(gameId);

      copy(`${message} ${link}`);
      popup({
        message:'Copied the game link.  Paste the link to invite using your app of choice.',
        maxWidth: '250px',
      });
      return;
    }

    const spnShare = event.target.closest('.share');
    if (spnShare) {
      const message = await getShareGameMessage(gameId);

      share({
        title: 'Tactics',
        text: message,
        url: link,
      }).catch(error => {
        if (error.isInternalError)
          popup({
            message: 'App sharing failed.  You can copy the link to share it instead.',
            buttons: [
              { label:'Copy', onClick:() => copy(`${message} ${link}`) },
              { label:'Cancel' },
            ],
            maxWidth: '250px',
          });
        else
          popup({
            message: 'App sharing cancelled.  You can still copy the link to share it instead.',
            buttons: [
              { label:'Copy', onClick:() => copy(`${message} ${link}`) },
              { label:'Cancel' },
            ],
            maxWidth: '250px',
          });
      });
      return;
    }

    // Support common open-new-tab semantics
    if (event.ctrlKey || event.metaKey || event.button === 1)
      open(link, '_blank');
    else
      location.href = link;
  };
  document.querySelector('.tabContent').addEventListener('mouseup', event => {
    // Detect and handle middle-click
    if (event.button === 1)
      gameClickHandler(event);
  });
  document.querySelector('.tabContent').addEventListener('click', gameClickHandler);

  window.addEventListener('hashchange', event => openTab());

  const dynamicStyle = document.createElement('STYLE');
  document.body.appendChild(dynamicStyle);

  window.addEventListener('resize', () => resize(dynamicStyle.sheet));
  resize(dynamicStyle.sheet);
});

function showRegister() {
  const divRegister = document.querySelector('#register');
  if (divRegister.style.display === '')
    return;

  const divGreeting = document.querySelector('.greeting');
  const divNotice = document.querySelector('#notice');

  divGreeting.textContent = `Welcome!`;
  divGreeting.style.display = '';
  divNotice.textContent = [
    'Never seen you before!',
    'By what name are you known?',
  ].map(s => s.replace(/ /g, '\u00A0')).join('  ');

  const btnEnter = document.createElement('BUTTON');
  btnEnter.textContent = 'Enter Lobby';
  btnEnter.addEventListener('click', async () => {
    if (!btnEnter.classList.contains('disabled'))
      try {
        await register(autosave.inputValue);
      } catch(error) {
        btnEnter.classList.add('disabled');
        autosave.error = error.toString();
      }
  });
  btnEnter.classList.add('disabled');

  const autosave = new Autosave({
    isRequired: true,
    autoFocus: true,
    maxLength: 20,
  }).on('submit', event => {
    event.waitUntil(register(event.data)).catch(error => {
      btnEnter.classList.add('disabled');
    });
  }).on('change', ({ data:name }) => {
    btnEnter.classList.toggle('disabled', name === null);
  });

  autosave.appendTo(divRegister);
  divRegister.appendChild(btnEnter);
  divRegister.style.display = '';
}
async function register(name) {
  const divNotice = document.querySelector('#notice');
  const divRegister = document.querySelector('#register');
  const divGreeting = document.querySelector('.greeting');

  await authClient.register({ name });

  myPlayerId = authClient.playerId;
  divNotice.textContent = '';
  divRegister.style.display = 'none';
  divGreeting.textContent = `Welcome, ${authClient.playerName}!`;

  history.replaceState(null, null, '#lobby');
  await openTab();
  document.querySelector('.tabs').style.display = '';
}

function setYourLobbyGame(gameSummary, skipRender = false) {
  if (state.activeGameId === gameSummary.id && gameSummary.startedAt) {
    const newGame = avatars.getSound('newgame').howl;
    newGame.once('end', () => {
      location.href = `/game.html?${gameSummary.id}`;
    });
    newGame.play();
    return;
  }

  const yourContent = state.tabContent.yourGames;
  const lobbyContent = state.tabContent.lobby;
  const lobbyGame = yourContent.lobbyGame;
  const styleId = gameSummary.collection.slice(6);
  yourContent.lobbyGame = gameSummary;

  if (!skipRender && state.currentTab === 'lobby' && lobbyContent.selectedStyleId === styleId)
    renderLobbyGames();

  if (!lobbyGame && gameSummary.startedAt)
    popup({
      message: 'You have an active lobby game!',
      buttons: [
        {
          label: 'Play Now',
          onClick: () => location.href = `/game.html?${gameSummary.id}`,
        },
        {
          label: 'Ignore',
        },
      ],
    });
}
function unsetYourLobbyGame(gameSummary, skipRender = false) {
  const lobbyGame = state.tabContent.yourGames.lobbyGame;
  if (!lobbyGame || lobbyGame.id !== gameSummary.id)
    return;

  const styleId = lobbyGame.collection.slice(6);
  state.tabContent.yourGames.lobbyGame = null;

  if (!skipRender && state.currentTab === 'lobby')
    if (state.tabContent.lobby.selectedStyleId === styleId)
      unsetLobbyGame(gameSummary);
}
function setYourGame(gameSummary) {
  const yourGames = state.tabContent.yourGames.games;
  const isLobbyGame = gameSummary.collection?.startsWith('lobby/');

  yourGames[0].delete(gameSummary.id);
  yourGames[1].delete(gameSummary.id);
  yourGames[2].delete(gameSummary.id);
  yourGames[3].delete(gameSummary.id);
  if (gameSummary.endedAt)
    yourGames[2] = new Map([ [ gameSummary.id, gameSummary ], ...yourGames[2] ]);
  else if (isLobbyGame)
    yourGames[3] = new Map([ [ gameSummary.id, gameSummary ], ...yourGames[3] ]);
  else if (gameSummary.startedAt)
    yourGames[1] = new Map([ [ gameSummary.id, gameSummary ], ...yourGames[1] ]);
  else
    yourGames[0] = new Map([ [ gameSummary.id, gameSummary ], ...yourGames[0] ]);

  if (isLobbyGame) {
    const lobbyGame = state.tabContent.yourGames.lobbyGame;
    if (lobbyGame) {
      if (lobbyGame.id === gameSummary.id) {
        if (gameSummary.endedAt)
          unsetYourLobbyGame(gameSummary);
        else
          setYourLobbyGame(gameSummary);
      }
    } else {
      if (!gameSummary.endedAt)
        setYourLobbyGame(gameSummary);
    }
  }

  if (state.currentTab === 'yourGames')
    renderYourGames();
}
function unsetYourGame(gameSummary) {
  const yourGames = state.tabContent.yourGames.games;
  let isDirty = false;

  for (let i = 0; i < yourGames.length; i++) {
    if (yourGames[i].delete(gameSummary.id))
      isDirty = true;
  }

  if (isDirty) {
    if (gameSummary.id === state.tabContent.yourGames.lobbyGame?.id)
      unsetYourLobbyGame(gameSummary);

    if (state.currentTab === 'yourGames')
      renderYourGames();
  }
}
function setLobbyGame(gameSummary) {
  const lobbyGames = state.tabContent.lobby.games;

  lobbyGames[0].delete(gameSummary.id);
  lobbyGames[1].delete(gameSummary.id);
  lobbyGames[2].delete(gameSummary.id);
  if (!gameSummary.startedAt)
    lobbyGames[0] = new Map([ [ gameSummary.id, gameSummary ], ...lobbyGames[0] ]);
  else if (!gameSummary.endedAt)
    lobbyGames[1] = new Map([ [ gameSummary.id, gameSummary ], ...lobbyGames[1] ]);
  else if (gameSummary.teams.findIndex(t => t?.playerId === authClient.playerId) === -1)
    lobbyGames[2] = new Map([ [ gameSummary.id, gameSummary ], ...lobbyGames[2] ]);

  renderLobbyGames();
}
function unsetLobbyGame(gameSummary) {
  const lobbyGames = state.tabContent.lobby.games;
  let isDirty = false;

  for (let i = 0; i < lobbyGames.length; i++) {
    if (lobbyGames[i].delete(gameSummary.id))
      isDirty = true;
  }

  if (isDirty)
    renderLobbyGames();
}
function setPublicGame(gameSummary) {
  const publicGames = state.tabContent.publicGames.games;

  publicGames[0].delete(gameSummary.id);
  publicGames[1].delete(gameSummary.id);
  publicGames[2].delete(gameSummary.id);
  if (!gameSummary.startedAt)
    publicGames[0] = new Map([ [ gameSummary.id, gameSummary ], ...publicGames[0] ]);
  else if (!gameSummary.endedAt)
    publicGames[1] = new Map([ [ gameSummary.id, gameSummary ], ...publicGames[1] ]);
  else
    publicGames[2] = new Map([ [ gameSummary.id, gameSummary ], ...publicGames[2] ]);

  renderPublicGames();
}
function unsetPublicGame(gameSummary) {
  const publicGames = state.tabContent.publicGames.games;
  let isDirty = false;

  for (let i = 0; i < publicGames.length; i++) {
    if (publicGames[i].delete(gameSummary.id))
      isDirty = true;
  }

  if (isDirty)
    renderPublicGames();
}

function resize(sheet) {
  const availWidth = document.body.clientWidth;

  for (let i = sheet.cssRules.length-1; i > -1; i--) {
    sheet.deleteRule(i);
  }

  let scale = 1;
  let rows = Math.floor(125 / 17);
  if (availWidth < 480) {
    scale = availWidth / 3 / 160;
    rows = 4;
  }

  if (scale < 1) {
    sheet.insertRule(`
      .floors {
        width: calc(160px * ${scale} * 1.5});
      }
    `, sheet.cssRules.length);

    sheet.insertRule(`
      .groups {
        width: calc(160px * ${scale} * 1.5});
      }
    `, sheet.cssRules.length);

    sheet.insertRule(`
      .arena {
        width: calc(160px * ${scale});
        height: calc(125px * ${scale});
        transform: scale(${scale});
      }
    `, sheet.cssRules.length);
  }

  sheet.insertRule(`
    .floors .list {
      height: ${rows * 17}px;
    }
  `, sheet.cssRules.length);

  sheet.insertRule(`
    .groups .list {
      height: ${rows * 17}px;
    }
  `, sheet.cssRules.length);
}
function selectStyle(styleId) {
  const tabContent = state.tabContent.lobby;
  const spnStyle = document.querySelector('.lobby HEADER .style');
  const divArenas = document.querySelector('.lobby .arenas');
  const ulFloorList = divArenas.querySelector('.floors UL');
  const divArenaList = Array.from(divArenas.querySelectorAll('.arena'));

  if (tabContent.selectedStyleId)
    ulFloorList.querySelector(`[data-style-id=${tabContent.selectedStyleId}]`).classList.remove('selected');
  ulFloorList.querySelector(`[data-style-id=${styleId}]`).classList.add('selected');

  spnStyle.textContent = styles.get(styleId);
  tabContent.selectedStyleId = styleId;
}
async function selectGroup(groupId) {
  const tabContent = state.tabContent.lobby;
  const divArenas = document.querySelector('.lobby .arenas');
  const divGroups = divArenas.querySelector('.groups');
  const ulGroupList = divGroups.querySelector('UL');
  const divArenaList = Array.from(divArenas.querySelectorAll('.arena'));
  const footer = document.querySelector('.lobby FOOTER');
  const spnGroup = footer.querySelector('.group');

  divArenas.classList.toggle('active', groupId === 'active');
  divArenas.classList.toggle('complete', groupId === 'complete');

  ulGroupList.querySelector(`[data-group-id=${tabContent.selectedGroupId}]`).classList.remove('selected');
  ulGroupList.querySelector(`[data-group-id=${groupId}]`).classList.add('selected');

  const groupIds = [ ...groups.keys() ];
  const groupIndex = groupIds.indexOf(groupId);

  divGroups.querySelector('.scroll.up').disabled =
    footer.querySelector('.scroll.left').disabled =
      groupIndex === 0;
  divGroups.querySelector('.scroll.down').disabled =
    footer.querySelector('.scroll.right').disabled =
      groupIndex === (groupIds.length - 1);

  spnGroup.textContent = groups.get(groupId);
  tabContent.selectedGroupId = groupId;
}
async function selectArena(divArena) {
  const tabContent = state.tabContent.lobby;
  if (divArena.classList.contains('empty')) {
    const lobbyGame = state.tabContent.yourGames.lobbyGame;
    if (lobbyGame?.collection === `lobby/${tabContent.selectedStyleId}`)
      moveGame(divArena);
    else
      createGame(divArena);
  } else if (divArena.classList.contains('waiting')) {
    const arena = JSON.parse(divArena.dataset.arena);

    if (arena.teams.find(t => t?.playerId === authClient.playerId))
      cancelGame();
    else
      joinGame(arena);
  } else {
    const arena = JSON.parse(divArena.dataset.arena);
    location.href = `/game.html?${arena.id}`;
  }
}
async function createGame(divArena) {
  if (!await cancelGame())
    return;

  const tabContent = state.tabContent.lobby;
  let { createBlocking, createTimeLimit, set, randomSide } = state.settings;
  if (createBlocking === 'ask')
    await popup({
      message: 'Choose blocking system.',
      buttons: [
        {
          label: 'Luck',
          onClick: () => createBlocking = 'luck',
        },
        {
          label: 'No Luck',
          onClick: () => createBlocking = 'noluck',
        },
      ],
      closeOnCancel: false,
    }).whenClosed;
  if (createTimeLimit === 'ask')
    await popup({
      message: 'Choose turn time limit.',
      buttons: [
        {
          label: 'Standard',
          onClick: () => createTimeLimit = 'standard',
        },
        {
          label: 'Blitz',
          onClick: () => createTimeLimit = 'blitz',
        },
      ],
      closeOnCancel: false,
    }).whenClosed;
  if (set === 'ask' && tabContent.sets.length === 1)
    set = tabContent.sets[0].id;
  else if (set === 'ask')
    await popup({
      message: 'Choose set.',
      buttons: tabContent.sets.map(s => (
        {
          label: s.name,
          onClick: () => set = s.id,
        }
      )),
      closeOnCancel: false,
    }).whenClosed;

  const myTeam = {
    playerId: authClient.playerId,
    set,
    randomSide: randomSide && !tabContent.gameType.hasFixedPositions,
  };

  try {
    state.activeGameId = await gameClient.createGame(tabContent.selectedStyleId, {
      collection: `lobby/${tabContent.selectedStyleId}`,
      randomHitChance: createBlocking === 'luck',
      turnTimeLimit: createTimeLimit,
      teams: [ myTeam, null ],
      tags: {
        arenaIndex: parseInt(divArena.dataset.index),
      },
    });
  } catch (e) {
    if (e.code === 429)
      popup('Creating games too quickly.');
    // Ignore cases where we attempted to create multiple open games
    else if (e.code !== 409) {
      reportError(e);
      popup('Oops!  Something went wrong.');
    }
    return false;
  }

  return true;
}
async function moveGame(divArena) {
  const myLobbyGame = state.tabContent.yourGames.lobbyGame;

  gameClient.tagGame(myLobbyGame.id, {
    arenaIndex: parseInt(divArena.dataset.index),
  });
}
async function cancelGame() {
  const myLobbyGame = state.tabContent.yourGames.lobbyGame;
  if (!myLobbyGame)
    return true;

  try {
    await gameClient.cancelGame(myLobbyGame.id);
    state.activeGameId = null;
    return true;
  } catch (e) {
    if (e.code !== 404 && e.code !== 409) {
      reportError(e);
      popup('Oops!  Something went wrong.');
    }
    return false;
  }
}
async function joinGame(arena) {
  if (!await cancelGame())
    return false;

  const creatorTeam = arena.teams.find(t => t?.playerId === arena.createdBy);
  if (arena.creatorACL) {
    let proceed = false;
    let message;
    let joinLabel = 'Join Game';

    if (arena.creatorACL.type === 'blocked') {
      if (arena.creatorACL.name !== creatorTeam.name)
        message = `
          You blocked this player under the name ${arena.creatorACL.name}.
          You may still play them if you mute them instead.
        `;
      else
        message = `
          You blocked this player, but may still play them if you mute them instead.
        `;
      joinLabel = 'Mute and Join Game';
    } else {
      if (arena.creatorACL.name !== creatorTeam.name)
        message = `
          You ${arena.creatorACL.type} this player under the name ${arena.creatorACL.name}.
          Do you still want to join their game?
        `;
      else
        proceed = true;
    }

    if (proceed === false)
      proceed = await popup({
        message,
        buttons: [
          {
            label: joinLabel,
            onClick: () => true,
          },
          {
            label: 'Cancel',
            onClick: () => false,
          },
        ],
        maxWidth: '300px',
      }).whenClosed;
    if (proceed === false)
      return false;
  }

  const tabContent = state.tabContent.lobby;
  let { set, randomSide } = state.settings;
  if (set === 'ask' && tabContent.sets.length === 1)
    set = tabContent.sets[0].id;
  else if (set === 'ask')
    await popup({
      message: 'Choose set.',
      buttons: tabContent.sets.map(s => (
        {
          label: s.name,
          onClick: () => set = s.id,
        }
      )),
      closeOnCancel: false,
    }).whenClosed;

  try {
    state.activeGameId = arena.id;
    await gameClient.joinGame(arena.id, {
      set,
      randomSide: randomSide && !tabContent.gameType.hasFixedPositions,
    });
    return true;
  } catch (e) {
    state.activeGameId = null;

    // A 404 means the game was cancelled right before we tried to join
    // A 409 means someone else joined the game first.
    if (e.code !== 404 && e.code !== 409) {
      reportError(e);
      popup('Oops!  Something went wrong.');
    }
    return false;
  }
}

function renderPN(reg) {
  const divPN = document.querySelector('#pn');

  if (reg === null) {
    divPN.innerHTML = 'Your privacy settings prevent push notifications.';
    return;
  }

  if (!('pushManager' in reg)) {
    divPN.innerHTML = 'Your browser does not support push notifications.';
    return;
  }

  /*
   * It is possible to disable notifications in Firefox such that the object is
   * completely unavailable.
   */
  if (!window.Notification) {
    pushClient.setSubscription(null);

    divPN.innerHTML = `
      <DIV>Push notifications are currently <SPAN class="blocked">DISABLED</SPAN>.</DIV>
      <DIV>You will not get notified when it is your turn.</DIV>
    `;
    return;
  }
  if (window.Notification.permission === 'denied') {
    pushClient.setSubscription(null);

    divPN.innerHTML = `
      <DIV>Push notifications are currently <SPAN class="blocked">BLOCKED</SPAN>.</DIV>
      <DIV>You will not get notified when it is your turn.</DIV>
    `;
    return;
  }

  reg.pushManager.getSubscription().then(subscription => {
    if (subscription) {
      pushClient.setSubscription(subscription.toJSON());

      divPN.innerHTML = 'Push notifications are currently <SPAN class="toggle is-on">ON</SPAN>.';
      divPN.querySelector('.toggle').addEventListener('click', () => {
        popup({
          title: 'Disable Push Notifications',
          message: `Are you sure you don't want to be notified when it is your turn?`,
          buttons: [
            {
              label: 'Yes',
              onClick: () => unsubscribePN(),
            },
            { label: 'No' },
          ],
          maxWidth: '250px',
        });
      });
    }
    else {
      pushClient.setSubscription(null);

      divPN.innerHTML = `
        <DIV>Enable push notifications to know when it is your turn.</DIV>
        <DIV><SPAN class="toggle">Turn on push notifications</SPAN></DIV>
      `;
      divPN.querySelector('.toggle').addEventListener('click', () => {
        subscribePN();
      });
    }
  }).catch(error => {
    // Encountered this in Firefox on my PC.  It is supposed to work.
    divPN.innerHTML = 'Push notifications are broken in this browser.';

    throw error;
  });
}
function subscribePN() {
  const divPN = document.querySelector('#pn');

  return navigator.serviceWorker.getRegistration().then(reg =>
    reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: pushPublicKey,
    }).then(subscription => {
      // renderPN() will sync the server with the current status.
      renderPN(reg);
    })
    .catch(async error => {
      if (window.Notification.permission === 'denied')
        return renderPN(reg);
      else if (window.Notification.permission === 'granted') {
        const isBrave = (navigator.brave && await navigator.brave.isBrave() || false);
        if (isBrave && error.message === 'Registration failed - push service error') {
          const link = `brave://settings/privacy`;
          const bravePopup = popup({
            className: 'brave',
            message: [
              `Notifications in the Brave browser won't work until you enable `,
              `"Use Google services for push messaging" in your Privacy Settings.  `,
              `You can copy the link to this setting and paste it into the address bar.`,

              `<DIV class="copy brave"><SPAN class="fa fa-copy"></SPAN><SPAN class="label">`,
                link,
              `</SPAN></DIV>`,
            ].join(''),
            maxWidth: '300px',
          });
          const divCopy = bravePopup.el.querySelector('.copy.brave');

          divCopy.addEventListener('click', event => {
            if (window.getComputedStyle(event.target).cursor !== 'pointer')
              return;

            copy(link);

            const thumbsUp = document.createElement('SPAN');
            thumbsUp.classList.add('fa');
            thumbsUp.classList.add('fa-thumbs-up');
            divCopy.appendChild(thumbsUp);
          });

          return;
        }
      }

      console.error('subscribe:', error);

      divPN.innerHTML = 'Failed to subscribe to push notifications.';
    })
  );
}
function unsubscribePN() {
  const divPN = document.querySelector('#pn');

  return navigator.serviceWorker.getRegistration().then(reg =>
    reg.pushManager.getSubscription().then(subscription =>
      subscription.unsubscribe()
    ).then(() => {
      // renderPN() will sync the server with the current status.
      renderPN(reg);
    })
    .catch(error => {
      console.error('unsubscribe', error);
      divPN.innerHTML = 'Failed to unsubscribe.';
    })
  );
}

function renderStats(scope = 'all') {
  const statsByCollection = state.tabContent.stats.byCollection;
  const yourGames = state.tabContent.yourGames.games;

  if (scope === 'my' || scope === 'all') {
    let numYourTurn = 0;

    for (const game of yourGames[1].values()) {
      // Exclude practice games
      if (!game.teams.find(t => t.playerId !== myPlayerId))
        continue;

      if (game.teams[game.currentTeamId].playerId === myPlayerId)
        numYourTurn++;
    }

    document.querySelector('.tabs .yourGames .badge').textContent = numYourTurn || '';
  }

  if (scope === 'collections' || scope === 'all') {
    let numLobby = 0;
    let numPublic = statsByCollection.get('public').waiting;
    const numLobbyByStyle = new Map();

    for (const [ collectionId, stats ] of statsByCollection) {
      if (!collectionId.startsWith('lobby/'))
        continue;

      const styleId = collectionId.slice(6);
      numLobby += stats.waiting;

      numLobbyByStyle.set(styleId, stats.waiting);
    }

    for (const game of yourGames[3].values()) {
      if (game.startedAt)
        continue;

      numLobby--;

      const styleId = game.collection.slice(6);
      numLobbyByStyle.set(styleId, numLobbyByStyle.get(styleId) - 1);
    }

    for (const game of yourGames[0].values()) {
      if (game.collection === 'public')
        numPublic--;
    }

    document.querySelector('.tabs .lobby .badge').textContent = numLobby || '';
    document.querySelector('.tabs .publicGames .badge').textContent = numPublic || '';

    const floors = document.querySelector('.floors UL');
    if (floors) {
      for (const [ styleId, num ] of numLobbyByStyle) {
        floors.querySelector(`LI[data-style-id=${styleId}] .badge`).textContent = num || '';
      }
    }
  }
}

function renderLobby() {
  const lobbyState = state.tabContent.lobby;
  const liLobby = document.querySelector('.tabContent .lobby');

  /*
   * Header
   */
  const header = document.createElement('HEADER');
  header.addEventListener('mouseenter', event => {
    if (event.target.tagName === 'BUTTON')
      avatars.getSound('focus').howl.play();
  }, true);
  header.addEventListener('click', event => {
    if (event.target.tagName === 'BUTTON')
      avatars.getSound('select').howl.play();
  }, true);
  liLobby.appendChild(header);

  const spnStyle = document.createElement('SPAN');
  spnStyle.classList.add('style');
  spnStyle.textContent = 'Freestyle';
  header.appendChild(spnStyle);

  const divControls = document.createElement('DIV');
  divControls.classList.add('controls');
  header.appendChild(divControls);

  const btnSetup = document.createElement('BUTTON');
  btnSetup.textContent = 'Setup';
  btnSetup.addEventListener('click', () => toggleSetup(btnSetup, lobbyState));
  divControls.appendChild(btnSetup);

  const btnSettings = document.createElement('BUTTON');
  btnSettings.classList.add('fa');
  btnSettings.classList.add('fa-cog');
  btnSettings.name = 'settings';
  btnSettings.title = 'Settings';
  btnSettings.addEventListener('click', event => {
    settings.show();
  });
  divControls.appendChild(btnSettings);

  /*****************************************************************************
   * Content
   */
  const divContent = document.createElement('DIV');
  divContent.classList.add('content');
  liLobby.appendChild(divContent);

  lobbyState.setup = new Setup();
  lobbyState.setup.on('change:avatar', async ({ data:avatar }) => {
    state.avatars.set(myPlayerId, { ...avatar, imageData:new Map() });

    if (state.tabContent.lobby.lobbyGame)
      resetLobbyGames();

    gameClient.saveMyAvatar(avatar);
  });

  const divSetup = lobbyState.setup.el;
  divSetup.classList.add('hide');
  divContent.appendChild(divSetup);

  const divArenas = renderArenas(divContent);

  /*****************************************************************************
   * Footer
   */
  const footer = document.createElement('FOOTER');
  const groupIds = [ ...groups.keys() ];

  const btnScrollLeft = new ScrollButton('left').render();
  btnScrollLeft.addEventListener('click', () => {
    const groupIndex = groupIds.indexOf(state.tabContent.lobby.selectedGroupId);
    selectGroup(groupIds[groupIndex - 1]);
    resetLobbyGames();
  });
  footer.appendChild(btnScrollLeft);

  const spnGroup = document.createElement('SPAN');
  spnGroup.classList.add('group');
  spnGroup.textContent = 'Lobby';
  footer.appendChild(spnGroup);

  const btnScrollRight = new ScrollButton('right').render();
  btnScrollRight.addEventListener('click', async () => {
    const groupIndex = groupIds.indexOf(state.tabContent.lobby.selectedGroupId);
    selectGroup(groupIds[groupIndex + 1]);
    resetLobbyGames();
  });
  footer.appendChild(btnScrollRight);

  liLobby.appendChild(footer);
}
async function toggleSetup(btnSetup, lobbyState) {
  const divLoading = document.querySelector(`.tabContent .loading`);
  const divSetup = lobbyState.setup.el;
  const divArenas = document.querySelector('.lobby .arenas');
  const footer = document.querySelector('.lobby FOOTER');
  btnSetup.disabled = true;

  if (btnSetup.textContent === 'Setup') {
    btnSetup.textContent = 'Lobby';
    footer.style.display = 'none';

    divLoading.classList.add('is-active');
    divLoading.classList.add('hide');
    whenTransitionEnds(divLoading, () => {
      divLoading.classList.remove('hide');
    });

    const untilReady = lobbyState.setup.setGameType(lobbyState.gameType, lobbyState.sets);

    divArenas.classList.remove('show');
    await whenTransitionEnds(divArenas, () => divArenas.classList.add('hide'));
    await untilReady;

    divSetup.classList.remove('hide');
    await sleep();
    divLoading.classList.remove('is-active');
    divSetup.classList.add('show');
    await whenTransitionEnds(divSetup);
  } else {
    btnSetup.textContent = 'Setup';
    footer.style.display = '';

    divSetup.classList.remove('show');
    await whenTransitionEnds(divSetup, () => divSetup.classList.add('hide'));

    divArenas.classList.remove('hide');
    await sleep();
    divArenas.classList.add('show');
    await whenTransitionEnds(divArenas);
  }

  btnSetup.disabled = false;
}
function renderArenas(divContent) {
  const divArenas = document.createElement('DIV');
  divArenas.classList.add('arenas');
  divArenas.classList.add('show');
  divContent.appendChild(divArenas);

  divArenas.appendChild(renderFloors());
  divArenas.appendChild(renderGroups());

  for (let i = 0; i < 14; i++) {
    divArenas.appendChild(renderArena(i));
  }

  return divArenas;
}
function renderFloors() {
  const tabContent = state.tabContent.lobby;

  const divFloors = document.createElement('DIV');
  divFloors.classList.add('floors');

  const divFloorList = document.createElement('DIV');
  divFloorList.classList.add('list');
  divFloors.appendChild(divFloorList);

  const ulFloorList = document.createElement('UL');
  for (const [ styleId, styleName ] of styles) {
    const liFloor = document.createElement('LI');
    liFloor.dataset.styleId = styleId;
    liFloor.addEventListener('mouseenter', () => {
      if (liFloor.classList.contains('selected'))
        return;

      avatars.getSound('focus').howl.play();
    });
    liFloor.addEventListener('click', async () => {
      if (liFloor.classList.contains('selected'))
        return;
      // Do not load this floor if still loading another floor.
      if (tabContent.isLoading)
        return;

      avatars.getSound('select').howl.play();

      selectStyle(styleId);
      const divArenaList = Array.from(document.querySelectorAll('.arenas .arena'));
      await Promise.all(divArenaList.map(d =>
        queueFillArena(d, tabContent.selectedGroupId === 'lobby'))
      );
      tabContent.isSynced = false;
      syncTab();
    });
    ulFloorList.appendChild(liFloor);

    const spnLabel = document.createElement('SPAN');
    spnLabel.classList.add('label');
    spnLabel.textContent = styleName;
    liFloor.appendChild(spnLabel);

    const spnBadge = document.createElement('SPAN');
    spnBadge.classList.add('badge');
    liFloor.appendChild(spnBadge);
  }
  divFloorList.appendChild(ulFloorList);

  const btnScrollUp = new ScrollButton('up').render();
  divFloorList.appendChild(btnScrollUp);

  const btnScrollDown = new ScrollButton('down').render();
  divFloorList.appendChild(btnScrollDown);

  divFloors.addEventListener('click', event => {
    const btnScroll = event.target.closest('BUTTON.scroll');
    if (btnScroll) {
      ulFloorList.scrollBy({
        top: ulFloorList.clientHeight * (btnScroll === btnScrollUp ? -1 : 1),
        left: 0,
        behavior: 'smooth',
      });
    }
  });
  ulFloorList.addEventListener('scroll', () => {
    btnScrollUp.disabled = ulFloorList.scrollTop === 0;
    btnScrollDown.disabled = ulFloorList.scrollHeight - ulFloorList.scrollTop === ulFloorList.clientHeight;
  });

  ulFloorList.scrollTo(0, 0);
  btnScrollUp.disabled = true;

  return divFloors;
}
function renderGroups() {
  const tabContent = state.tabContent.lobby;

  const divGroups = document.createElement('DIV');
  divGroups.classList.add('groups');

  const divGroupList = document.createElement('DIV');
  divGroupList.classList.add('list');
  divGroups.appendChild(divGroupList);

  const ulGroupList = document.createElement('UL');
  for (const [ groupId, groupName ] of groups) {
    const liGroup = document.createElement('LI');
    liGroup.classList.toggle('selected', groupId === tabContent.selectedGroupId);
    liGroup.dataset.groupId = groupId;
    liGroup.addEventListener('mouseenter', () => {
      if (liGroup.classList.contains('selected'))
        return;

      avatars.getSound('focus').howl.play();
    });
    liGroup.addEventListener('click', async () => {
      if (liGroup.classList.contains('selected'))
        return;

      avatars.getSound('select').howl.play();

      selectGroup(groupId);
      resetLobbyGames();
    });
    liGroup.textContent = groupName;
    ulGroupList.appendChild(liGroup);
  }
  divGroupList.appendChild(ulGroupList);

  const groupIds = [ ...groups.keys() ];
  const btnScrollUp = new ScrollButton('up').render();
  btnScrollUp.addEventListener('click', async () => {
    const groupIndex = groupIds.indexOf(tabContent.selectedGroupId);
    selectGroup(groupIds[groupIndex - 1]);
    resetLobbyGames();
  });
  divGroupList.appendChild(btnScrollUp);

  const btnScrollDown = new ScrollButton('down').render();
  btnScrollDown.addEventListener('click', async () => {
    const groupIndex = groupIds.indexOf(tabContent.selectedGroupId);
    selectGroup(groupIds[groupIndex + 1]);
    resetLobbyGames();
  });
  divGroupList.appendChild(btnScrollDown);

  divGroups.addEventListener('click', event => {
    const btnScroll = event.target.closest('BUTTON.scroll');
    if (btnScroll) {
      ulGroupList.scrollBy({
        top: ulGroupList.clientHeight * (btnScroll === btnScrollUp ? -1 : 1),
        left: 0,
        behavior: 'smooth',
      });
    }
  });

  return divGroups;
}
function renderArena(index) {
  const divArena = document.createElement('DIV');
  divArena.classList.add('arena');
  divArena.classList.add('empty');
  divArena.dataset.index = index;

  const shpArena = document.createElement('DIV');
  shpArena.classList.add('arena-shape');
  shpArena.addEventListener('mouseenter', () => {
    if (divArena.classList.contains('disabled'))
      return;

    avatars.getSound('focus').howl.play();
  });
  shpArena.addEventListener('click', () => {
    avatars.getSound('select').howl.play();

    selectArena(divArena);
  });
  divArena.appendChild(shpArena);

  const imgArena = document.createElement('IMG');
  imgArena.classList.add('arena-image');
  imgArena.src = arena.src;
  shpArena.appendChild(imgArena);

  const btnJoin = document.createElement('IMG');
  btnJoin.classList.add('arena-button-bottom');
  btnJoin.src = '/arenaJoin.svg';
  shpArena.appendChild(btnJoin);

  const avatarTop = document.createElement('IMG');
  avatarTop.classList.add('unit');
  avatarTop.classList.add('top');
  shpArena.appendChild(avatarTop);

  const avatarBtm = document.createElement('IMG');
  avatarBtm.classList.add('unit');
  avatarBtm.classList.add('btm');
  shpArena.appendChild(avatarBtm);

  const nameTop = document.createElement('SPAN');
  nameTop.classList.add('name');
  nameTop.classList.add('top');
  shpArena.appendChild(nameTop);

  const nameBtm = document.createElement('SPAN');
  nameBtm.classList.add('name');
  nameBtm.classList.add('btm');
  shpArena.appendChild(nameBtm);

  const divLabel = document.createElement('DIV');
  divLabel.classList.add('label');
  shpArena.appendChild(divLabel);

  return divArena;
}
function getLobbyGames() {
  const lobbyGame = state.tabContent.yourGames.lobbyGame;
  const tabContent = state.tabContent.lobby;
  const arenas = new Array(14).fill(null);
  // Subtract 1 to reserve an arena.
  let numRemaining = arenas.length - 1;

  /*
   * Place my waiting or active lobby game.
   */
  if (lobbyGame?.collection === `lobby/${tabContent.selectedStyleId}`) {
    const index = lobbyGame.tags.arenaIndex;

    arenas[index] = lobbyGame;
    // Do not subtract from numRemaining to use the reserved arena.
  }

  /*
   * Place all waiting games with no conflicts.
   */
  const waitingGames = [ ...tabContent.games[0].values() ]
    .sort((a,b) => a.createdAt - b.createdAt);

  // Cloning the array allows us to use .splice()
  for (const game of waitingGames.slice()) {
    if (game.id === lobbyGame?.id) {
      waitingGames.splice(waitingGames.indexOf(game), 1);
      continue;
    }

    const index = game.tags.arenaIndex;
    if (arenas[index] !== null)
      continue;

    waitingGames.splice(waitingGames.indexOf(game), 1);
    arenas[index] = game;
    if (!--numRemaining) return arenas;
  }

  /*
   * Place all waiting games with conflicts.
   */
  for (const game of waitingGames) {
    const index = arenas.indexOf(null);

    arenas[index] = game;
    if (!--numRemaining) return arenas;
  }

  /*
   * Place all active games with no conflicts.
   */
  const activeGames = [ ...tabContent.games[1].values() ]
    .sort((a,b) => b.startedAt - a.startedAt);

  for (const game of activeGames) {
    const index = game.tags.arenaIndex;
    if (arenas[index] !== null)
      continue;

    arenas[index] = game;
    if (!--numRemaining) return arenas;
  }

  /*
   * Place all complete games with no conflicts.
   */
  const completeGames = [ ...tabContent.games[2].values() ]
    .sort((a,b) => b.endedAt - a.endedAt);

  for (const game of completeGames) {
    const index = game.tags.arenaIndex;
    if (arenas[index] !== null)
      continue;

    arenas[index] = game;
    if (!--numRemaining) return arenas;
  }

  return arenas;
}
async function renderLobbyGames() {
  const divArenas = document.querySelector('.lobby .arenas');
  const divArenaList = Array.from(divArenas.querySelectorAll('.arena'));
  const tabContent = state.tabContent.lobby;
  const arenas = [];

  if (!tabContent.selectedStyleId) {
    const lobbyGame = state.tabContent.yourGames.lobbyGame;
    if (lobbyGame)
      selectStyle(lobbyGame.collection.slice(6));
    else
      selectStyle('freestyle');
  }

  if (!tabContent.selectedGroupId)
    selectGroup('lobby');

  if (tabContent.selectedGroupId === 'lobby')
    arenas.push(...getLobbyGames());
  else if (tabContent.selectedGroupId === 'active')
    arenas.push(...tabContent.games[1].values());
  else if (tabContent.selectedGroupId === 'complete')
    arenas.push(...tabContent.games[2].values());

  /*
   * Cache the avatars for all the players we're about to see
   */
  const playerIdSet = new Set();
  if (!state.avatars.has(myPlayerId))
    playerIdSet.add(myPlayerId);

  for (const arena of arenas) {
    if (!arena) continue;

    for (const team of arena.teams) {
      if (!team) continue;

      if (team.playerId && !state.avatars.has(team.playerId))
        playerIdSet.add(team.playerId);
    }
  }

  if (playerIdSet.size) {
    const playerIds = [ ...playerIdSet ];
    const avatars = await gameClient.getPlayersAvatar(playerIds);
    for (let i = 0; i < playerIds.length; i++) {
      state.avatars.set(playerIds[i], { ...avatars[i], imageData:new Map() });

      if (playerIds[i] === myPlayerId)
        tabContent.setup.avatar = state.avatars.get(myPlayerId);
    }
  }

  while (divArenaList.length < arenas.length) {
    const divArena = renderArena(divArenaList.length);
    divArenas.appendChild(divArena);
    divArenaList.push(divArena);
  }

  for (let i = 0; i < divArenaList.length; i++) {
    const divArena = divArenaList[i];
    const arena = arenas[i] ?? arenas[i] === null;

    queueFillArena(divArena, arena);
  }
}
async function resetLobbyGames() {
  const divArenaList = Array.from(document.querySelectorAll('.arenas .arena'));
  await Promise.all(divArenaList.map(d => queueFillArena(d, false)));
  renderLobbyGames();
}
function hideArena(divArena) {
  if (divArena.classList.contains('hide'))
    return false;

  divArena.classList.add('hide');
  return emptyArena(divArena);
}
function queueFillArena(divArena, arena) {
  const index = divArena.dataset.index;

  if (fillArenaQueueMap.has(index))
    fillArenaQueueMap.set(index, fillArenaQueueMap.get(index).then(() => fillArena(divArena, arena)));
  else
    fillArenaQueueMap.set(index, fillArena(divArena, arena));

  return fillArenaQueueMap.get(index);
}
async function fillArena(divArena, arena = true) {
  if (arena === false)
    return hideArena(divArena);

  divArena.classList.remove('hide');
  if (arena === true)
    return emptyArena(divArena);

  const lobbyGame = state.tabContent.yourGames.lobbyGame;
  divArena.classList.toggle('disabled', !!lobbyGame?.startedAt && !arena.startedAt);

  const oldArena = JSON.parse(divArena.dataset.arena ?? 'null');
  if (JSON.stringify(arena) === JSON.stringify(oldArena))
    return false;

  divArena.dataset.arena = JSON.stringify(arena);
  divArena.classList.remove('empty');
  divArena.classList.toggle('waiting', !arena.startedAt);
  divArena.classList.toggle('active', !!arena.startedAt && !arena.endedAt);
  divArena.classList.toggle('complete', !!arena.endedAt);

  if (oldArena && oldArena.id !== arena.id) {
    divArena.classList.add('disabled');
    await Promise.all([
      fillTeam(divArena, 'top', null, oldArena),
      fillTeam(divArena, 'btm', null, oldArena),
    ]);
    await Promise.all([
      fillTeam(divArena, 'top', arena, null),
      fillTeam(divArena, 'btm', arena, null),
    ]);
    divArena.classList.toggle('disabled', !!lobbyGame?.startedAt && !arena.startedAt);
  } else {
    await Promise.all([
      fillTeam(divArena, 'top', arena, oldArena),
      fillTeam(divArena, 'btm', arena, oldArena),
    ]);
  }

  const labels = [];
  if (!arena.startedAt) {
    if (arena.randomHitChance === false)
      labels.push('No Luck');
    if (arena.turnTimeLimit === 30)
      labels.push('Blitz');
  }

  divArena.querySelector('.label').textContent = labels.join(', ');
}
async function fillTeam(divArena, slot, arena, oldArena) {
  const spnName = divArena.querySelector(`.name.${slot}`);
  const imgUnit = divArena.querySelector(`.unit.${slot}`);

  const oldTeamIndex = oldArena?.teams[0].playerId === authClient.playerId
    ? slot === 'top' ? 1 : 0
    : slot === 'top' ? 0 : 1
  const oldTeam = oldArena?.teams[oldTeamIndex];
  const teamIndex = arena?.teams[0].playerId === authClient.playerId
    ? slot === 'top' ? 1 : 0
    : slot === 'top' ? 0 : 1
  const team = arena?.teams[teamIndex];
  const isWinner = [ undefined, teamIndex ].includes(arena?.winnerId);

  if (oldTeam && team) {
    if (
      oldTeam.playerId === team.playerId &&
      oldTeam.name === team.name &&
      /*
      oldTeam.avatar === team.avatar &&
      oldTeam.color === team.color &&
      */
      imgUnit.classList.contains('loser') === !isWinner
    ) return false;
  }

  if (oldTeam) {
    await whenTransitionEnds(spnName, () => {
      spnName.classList.remove('show');
      imgUnit.classList.remove('show');
    });
  }

  if (team) {
    const avatar = getAvatar(team.playerId, slot === 'top' ? 'S' : 'N');
    spnName.textContent = team.name;
    imgUnit.classList.toggle('loser', !isWinner);
    imgUnit.style.top = `${avatar.y}px`;
    imgUnit.style.left = `${avatar.x}px`;
    imgUnit.src = avatar.src;

    await whenTransitionEnds(spnName, () => {
      spnName.classList.add('show');
      imgUnit.classList.add('show');
    });
  }
}
async function emptyArena(divArena) {
  if (divArena.classList.contains('empty')) {
    const lobbyGame = state.tabContent.yourGames.lobbyGame;
    divArena.classList.toggle('disabled', !!lobbyGame?.startedAt);
    return false;
  }

  const oldArena = JSON.parse(divArena.dataset.arena);

  delete divArena.dataset.arena;
  divArena.classList.remove('waiting');
  divArena.classList.remove('active');
  divArena.classList.remove('complete');
  divArena.classList.add('empty');

  divArena.querySelector('.label').textContent = '';

  return Promise.all([
    fillTeam(divArena, 'top', null, oldArena),
    fillTeam(divArena, 'btm', null, oldArena),
  ]);
}

function renderYourGames() {
  const tabContent = state.tabContent.yourGames;
  const divTabContent = document.querySelector('.tabContent .yourGames');
  divTabContent.innerHTML = '';

  const now = gameClient.serverNow;
  const waitingGames = [ ...tabContent.games[0].values() ];
  const activeGames = [ ...tabContent.games[1].values() ]
    .map(game => {
      game.turnTimeRemaining = game.getTurnTimeRemaining(now);

      return game;
    })
    .sort((a, b) => {
      if (a.turnTimeLimit && !b.turnTimeLimit)
        return -1;
      else if (!a.turnTimeLimit && b.turnTimeLimit)
        return 1;
      else if (!a.turnTimeLimit && !b.turnTimeLimit)
        return b.updatedAt - a.updatedAt;

      return a.turnTimeRemaining - b.turnTimeRemaining;
    });
  const completeGames = [ ...tabContent.games[2].values() ];
  const lobbyGames = [ ...tabContent.games[3].values() ]
    .map(game => {
      game.turnTimeRemaining = game.getTurnTimeRemaining(now);

      return game;
    });

  /*
   * Lobby Games
   */
  if (lobbyGames.length) {
    const header = document.createElement('HEADER');
    header.innerHTML = 'Active Lobby Game';

    divTabContent.appendChild(header);
    lobbyGames.forEach(game => divTabContent.appendChild(renderGame(game)));
  }

  /*
   * Your Turn!
   */
  const myTurnGames = [];
  for (const game of activeGames) {
    // Exclude games where it is someone else's turn
    if (game.teams[game.currentTeamId].playerId !== myPlayerId)
      continue;
    // Exclude games where it is my turn, but it ended
    if (game.turnEndedAt)
      continue;
    // Exclude practice games
    if (!game.teams.find(t => t.playerId !== myPlayerId))
      continue;

    const divGame = renderGame(game);

    myTurnGames.push(divGame);
  }

  if (myTurnGames.length) {
    const header = document.createElement('HEADER');
    header.innerHTML = 'Your Turn!';

    divTabContent.appendChild(header);
    myTurnGames.forEach(div => divTabContent.appendChild(div));
  }

  /*
   * Their Turn
   */
  const theirTurnGames = [];
  for (const game of activeGames) {
    // Exclude games where it is my turn and the turn hasn't ended
    if (game.teams[game.currentTeamId].playerId === myPlayerId && !game.turnEndedAt)
      continue;
    // Exclude practice games
    if (!game.teams.find(t => t.playerId !== myPlayerId))
      continue;

    const divGame = renderGame(game);

    theirTurnGames.push(divGame);
  }

  if (theirTurnGames.length) {
    const header = document.createElement('HEADER');
    header.innerHTML = 'Their Turn';

    divTabContent.appendChild(header);
    theirTurnGames.forEach(div => divTabContent.appendChild(div));
  }

  /*
   * Practice Games
   */
  const practiceGames = [];
  for (const game of activeGames) {
    // Exclude games that haven't started yet
    if (!game.startedAt)
      continue;
    // Exclude games that aren't practice games
    if (game.teams.find(t => t.playerId !== myPlayerId))
      continue;

    const divGame = renderGame(game);

    practiceGames.push(divGame);
  }

  if (practiceGames.length) {
    const header = document.createElement('HEADER');
    header.innerHTML = 'Practice Games';

    divTabContent.appendChild(header);
    practiceGames.forEach(div => divTabContent.appendChild(div));
  }

  /*
   * Waiting for Opponent
   */
  if (waitingGames.length) {
    const header = document.createElement('HEADER');
    header.innerHTML = 'Waiting for Opponent';

    divTabContent.appendChild(header);
    waitingGames.forEach(game => divTabContent.appendChild(renderGame(game)));
  }

  /*
   * Complete Games
   */
  if (completeGames.length) {
    const header = document.createElement('HEADER');
    header.innerHTML = 'Complete Games';

    divTabContent.appendChild(header);
    completeGames.forEach(game => divTabContent.appendChild(renderGame(game)));
  }

  tabContent.renderTimeout = setTimeout(renderYourGames, 30000);
}

async function renderPublicGames() {
  const tabContent = state.tabContent.publicGames;
  const divTabContent = document.querySelector('.tabContent .publicGames');
  divTabContent.innerHTML = '';

  const now = gameClient.serverNow;
  const waitingGames = [ ...tabContent.games[0].values() ];
  const activeGames = [ ...tabContent.games[1].values() ];
  const completeGames = [ ...tabContent.games[2].values() ];

  /*
   * Waiting for Opponent
   */
  if (waitingGames.length) {
    const header = document.createElement('HEADER');
    header.innerHTML = 'Waiting for Opponent';

    divTabContent.appendChild(header);
    waitingGames.forEach(game => divTabContent.appendChild(renderGame(game)));
  }

  /*
   * Active Games
   */
  if (activeGames.length) {
    const header = document.createElement('HEADER');
    header.innerHTML = 'Active Games';

    divTabContent.appendChild(header);
    activeGames.forEach(game => divTabContent.appendChild(renderGame(game)));
  }

  /*
   * Complete Games
   */
  if (completeGames.length) {
    const header = document.createElement('HEADER');
    header.innerHTML = 'Complete Games';

    divTabContent.appendChild(header);
    completeGames.forEach(game => divTabContent.appendChild(renderGame(game)));
  }

  tabContent.renderTimeout = setTimeout(renderPublicGames, 30000);
}

function renderGame(game) {
  const teams = game.teams;

  let left = `${game.typeName}`;
  // Completed Games
  if (game.endedAt) {
    if (game.isFork)
      left += ', <SPAN>Fork</SPAN>';
    else if (!game.rated)
      left += ', <SPAN>Unrated</SPAN>';
    else if (game.collection?.startsWith('lobby/'))
      left += ', <SPAN>Lobby</SPAN>';

    if (game.winnerId === 'truce')
      left += ', <SPAN>Truce!</SPAN>';
    else if (game.winnerId === 'draw')
      left += ', <SPAN>Draw!</SPAN>';
    else if (teams[game.winnerId].playerId === myPlayerId)
      left += ', <SPAN>You Win!</SPAN>';
    else if (teams.findIndex(t => t.playerId === myPlayerId) > -1)
      left += ', <SPAN>You Lose!</SPAN>';
  // Active Games
  } else if (game.startedAt) {
    const labels = [];

    if (!game.randomHitChance)
      labels.push('No Luck');

    if (game.isFork)
      labels.push('Fork');
    else if (!game.rated)
      labels.push('Unrated');
    else if (game.collection?.startsWith('lobby/'))
      labels.push('Lobby');

    if (labels.length)
      left += ', <SPAN>' + labels.join(',</SPAN> <SPAN>') + '</SPAN>';
  // Waiting Games
  } else {
    const labels = [];

    if (!game.randomFirstTurn) {
      if (
        (!teams[0] || teams[0].playerId === myPlayerId) &&
        (!teams[1] || teams[1].playerId !== myPlayerId)
      )
        labels.push('You 2nd');
      else
        labels.push('You 1st');
    }

    if (!game.randomHitChance)
      labels.push('No Luck');

    if (game.collection?.startsWith('lobby/')) {
      if (game.turnTimeLimit === 30)
        labels.push('Blitz');
    } else {
      if (game.turnTimeLimit === 86400)
        labels.push('1 Day');
      else if (game.turnTimeLimit === 120)
        labels.push('Standard');
      else if (game.turnTimeLimit === 30)
        labels.push('Blitz');
    }

    if (game.isFork)
      labels.push('Fork');
    else if (!game.rated)
      labels.push('Unrated');
    else if (game.collection?.startsWith('lobby/'))
      labels.push('Lobby');

    if (labels.length)
      left += ', <SPAN>' + labels.join(',</SPAN> <SPAN>') + '</SPAN>';
  }

  const gameIsEmpty = teams.filter(t => !!t?.joinedAt).length === 0;
  const gameIsPractice = teams.filter(t => t?.playerId === myPlayerId).length === teams.length;
  let middle;

  if (gameIsEmpty) {
    // Not supposed to happen, but bugs do.
    middle = '<I>Empty</I>';
  } else if (gameIsPractice) {
    if (game.startedAt)
      middle = '<I>Yourself</I>';
    else
      middle = '<I>Finish Setup</I>';
  } else if (game.startedAt || game.createdBy !== authClient.playerId) {
    const opponents = teams.map((team, teamId) => {
      if (!team?.joinedAt || team.playerId === myPlayerId)
        return false;
      if (game.endedAt && game.winnerId === teamId)
        return `<SPAN class="winner">${team.name}</SPAN>`;
      return team.name;
    }).filter(n => typeof n === 'string');
    if (opponents.length === 0)
      middle = '<I>Yourself</I>';
    else
      middle = opponents.join(' vs ');
  } else {
    if (navigator.share)
      middle = '<SPAN class="share"><SPAN class="fa fa-share"></SPAN><SPAN class="label">Share Invite Link</SPAN></SPAN>';
    else
      middle = '<SPAN class="copy"><SPAN class="fa fa-copy"></SPAN><SPAN class="label">Copy Invite Link</SPAN></SPAN>';
  }

  const now = gameClient.serverNow;
  let addClass = '';
  let elapsed;

  if (state.currentTab === 'publicGames' || !game.startedAt || game.endedAt || !game.turnTimeLimit)
    elapsed = (now - game.updatedAt) / 1000;
  else {
    elapsed = game.turnTimeRemaining / 1000;
    if (elapsed < (game.turnTimeLimit * 0.2))
      addClass = 'low';
  }

  if (elapsed <= 0)
    elapsed = '0';
  else if (elapsed < 60)
    elapsed = '<1m';
  else if (elapsed < 3600)
    elapsed = Math.floor(elapsed / 60) + 'm';
  else if (elapsed < 86400)
    elapsed = Math.floor(elapsed / 3600) + 'h';
  else if (elapsed < 604800)
    elapsed = Math.floor(elapsed / 86400) + 'd';
  else if (elapsed < 31557600)
    elapsed = Math.floor(elapsed / 604800) + 'w';
  else
    elapsed = Math.floor(elapsed / 31557600) + 'y';

  const divGame = document.createElement('DIV');
  divGame.id = game.id;
  divGame.classList.add('game');
  divGame.innerHTML = `
    <SPAN class="left">${left}</SPAN>
    <SPAN class="middle">${middle}</SPAN>
    <SPAN class="right ${addClass}">
      <SPAN class="elapsed">${elapsed}</SPAN>
      <SPAN class="fa fa-clock"></SPAN>
    </SPAN>
  `;

  return divGame;
}

async function openTab() {
  closeTab();

  state.currentTab = 'yourGames';
  if (location.hash === '#lobby')
    state.currentTab = 'lobby';
  else if (location.hash === '#publicGames')
    state.currentTab = 'publicGames';

  document.querySelector(`.tabs .${state.currentTab}`).classList.add('is-active');

  syncTab();
}
function closeTab() {
  if (!state.currentTab)
    return;

  document.querySelector(`.tabs .${state.currentTab}`).classList.remove('is-active');

  const tabContent = state.tabContent[state.currentTab];

  if (tabContent.isOpen) {
    document.querySelector(`.tabContent .${state.currentTab}`).classList.remove('is-active');
    document.querySelector(`.tabContent .enterLobby`).classList.remove('is-active');

    if (tabContent.isSynced) {
      if (state.currentTab === 'yourGames')
        clearTimeout(tabContent.renderTimeout);
      else if (state.currentTab === 'lobby') {
        gameClient.leaveCollectionGroup(`lobby/${tabContent.selectedStyleId}`);
        tabContent.isSynced = false;
        tabContent.whenSynced = Promise.resolve();
      } else if (state.currentTab === 'publicGames') {
        gameClient.leaveCollectionGroup('public');
        tabContent.isSynced = false;
        tabContent.whenSynced = Promise.resolve();
        clearTimeout(tabContent.renderTimeout);
      }
    }

    tabContent.isOpen = false;
  }
}

async function syncTab() {
  const currentTab = state.currentTab;
  const tabContent = state.tabContent[currentTab];
  if (tabContent.isOpen && tabContent.isSynced || tabContent.isLoading)
    return;
  tabContent.isLoading = true;

  const divLoading = document.querySelector(`.tabContent .loading`);

  if (!divLoading.classList.contains('is-active')) {
    divLoading.classList.add('is-active');
    divLoading.classList.add('hide');
    whenTransitionEnds(divLoading, () => {
      divLoading.classList.remove('hide');
    });
  }

  try {
    if (!tabContent.isSynced) {
      await fetchGames(currentTab);

      // If the tab was changed before fetching completed, abort.
      if (state.currentTab !== currentTab)
        throw 'abort';

      renderStats();
    }

    if (state.currentTab === 'lobby') {
      renderLobbyGames();

      // Check for a running state directly in case the state property
      // hasn't updated yet.
      await sleep();
      if (Howler.ctx.state === 'running' || state.audioEnabled)
        showLobby();
      else
        showEnterLobby();
    } else {
      if (state.currentTab === 'yourGames')
        renderYourGames();
      else
        renderPublicGames();

      document.querySelector(`.tabContent .${currentTab}`).classList.add('is-active');
    }

    tabContent.isOpen = true;
  } catch(error) {
    if (error !== 'abort') {
      if (state.currentTab === currentTab)
        popup('Oops!  Something went wrong while loading the tab.');
      console.error(error);
      reportError(error);
    }
  }

  divLoading.classList.remove('is-active');
  tabContent.isLoading = false;
}
function showEnterLobby() {
  const divEnterLobby = document.querySelector('.tabContent .enterLobby');
  divEnterLobby.classList.add('is-active');
  divEnterLobby.querySelector('BUTTON').addEventListener('click', showLobby);
}
async function showLobby() {
  const tabContent = state.tabContent.lobby;
  const divEnterLobby = document.querySelector('.tabContent .enterLobby');
  if (divEnterLobby.classList.contains('is-active')) {
    divEnterLobby.classList.remove('is-active');
    divEnterLobby.querySelector('BUTTON').removeEventListener('click', showLobby);
  }

  const divLobby = document.querySelector('.tabContent .lobby');

  if (tabContent.firstOpen) {
    divLobby.classList.add('is-active');
    divLobby.classList.add('disabled');
    divLobby.classList.add('hide');

    await whenTransitionEnds(divLobby, () => {
      divLobby.classList.remove('hide');

      avatars.getSound('login').howl.play();

      tabContent.firstOpen = false;
    });
    divLobby.classList.remove('disabled');
  } else
    divLobby.classList.add('is-active');
}

function getTabNameForElement(el) {
  if (el.classList.contains('lobby'))
    return 'lobby';
  else if (el.classList.contains('yourGames'))
    return 'yourGames';
  else if (el.classList.contains('publicGames'))
    return 'publicGames';
}

async function fetchGames(tabName) {
  const promises = [];

  const statsContent = state.tabContent.stats;
  if (!statsContent.isSynced) {
    if (statsContent.whenSynced.isFinalized) {
      statsContent.whenSynced = gameClient.joinCollectionStatsGroup().then(rsp => {
        statsContent.byCollection = rsp.stats;
        statsContent.isSynced = true;
      });
      // Suppress unhandledrejection in the event that this promise is rejected
      // before we reach Promise.all() below.  This is possible because of an
      // await before then.
      statsContent.whenSynced.catch(() => {});
    }
    promises.push(statsContent.whenSynced);
  }

  const yourContent = state.tabContent.yourGames;
  if (!yourContent.isSynced) {
    const query = [
      { // Waiting Games (except Lobby games)
        filter: {
          collection: { '!':{ '~':/^lobby\// } },
          startedAt: null,
        },
        sort: { field:'updatedAt', order:'desc' },
        limit: 50,
      },
      { // Active Games (except Lobby games)
        filter: {
          collection: { '!':{ '~':/^lobby\// } },
          startedAt: { '!':null },
          endedAt: null,
        },
        sort: { field:'updatedAt', order:'desc' },
        limit: 50,
      },
      { // Completed Games
        filter: { endedAt:{ '!':null } },
        sort: { field:'updatedAt', order:'desc' },
        limit: 50,
      },
      { // Waiting and Active Lobby games
        filter: {
          collection: { '~':/^lobby\// },
          endedAt: null,
        },
        sort: { field:'updatedAt', order:'asc' },
        limit: 50,
      },
    ];

    if (yourContent.whenSynced.isFinalized)
      yourContent.whenSynced = gameClient.joinMyGamesGroup({ query }).then(rsp => {
        yourContent.stats = rsp.stats;
        yourContent.games = rsp.results.map(r => new Map(r.hits.map(h => [ h.id, h ])));

        if (rsp.results[3].hits.length)
          setYourLobbyGame(rsp.results[3].hits[0], true);
        else if (yourContent.lobbyGame)
          unsetYourLobbyGame(yourContent.lobbyGame, true);

        yourContent.isSynced = true;
      });
    promises.push(yourContent.whenSynced);
  }

  const tabContent = state.tabContent[tabName];

  if (tabName === 'lobby') {
    const query = [
      {
        filter: {
          'teams[].playerId': { '!':myPlayerId },
          startedAt: null,
        },
        sort: { field:'createdAt', order:'asc' },
        limit: 50,
      },
      {
        filter: {
          'teams[].playerId': { '!':myPlayerId },
          startedAt: { '!':null },
          endedAt: null,
        },
        sort: { field:'startedAt', order:'desc' },
        limit: 50,
      },
      {
        filter: {
          'teams[].playerId': { '!':myPlayerId },
          endedAt: { '!':null },
        },
        sort: { field:'endedAt', order:'desc' },
        limit: 50,
      },
    ];

    const join = styleId =>
      gameClient.joinCollectionGroup(`lobby/${styleId}`, { query }).then(rsp => {
        tabContent.games = rsp.results.map(r => new Map(r.hits.map(h => [ h.id, h ])));
        tabContent.isSynced = true;
      });
    const leave = styleId =>
      gameClient.leaveCollectionGroup(`lobby/${styleId}`);
    const fetchGameType = styleId =>
      gameClient.getGameType(styleId).then(rsp => {
        tabContent.gameType = rsp;
      });
    const fetchPlayerSets = styleId =>
      gameClient.getPlayerSets(styleId).then(rsp => {
        tabContent.sets = rsp;
      });

    if (tabContent.selectedStyleId === null) {
      await Promise.all([ avatarsPromise, yourContent.whenSynced ]);
      const styleId = yourContent.lobbyGame?.collection.slice(6) ?? 'freestyle';
      selectStyle(styleId);
      selectGroup('lobby');
    }

    const styleId = tabContent.selectedStyleId;
    const promises = [
      join(styleId),
      fetchPlayerSets(styleId),
      fetchGameType(styleId),
    ];
    if (tabContent.whenSynced.styleId)
      promises.unshift(leave(tabContent.whenSynced.styleId));

    await Promise.all(promises);
    tabContent.whenSynced.styleId = styleId;

    promises.push(tabContent.whenSynced);
  } else if (tabName === 'publicGames') {
    const query = [
      {
        filter: {
          'teams[].playerId': { '!':myPlayerId },
          startedAt: null,
        },
        sort: { field:'createdAt', order:'asc' },
        limit: 50,
      },
      {
        filter: {
          'teams[].playerId': { '!':myPlayerId },
          startedAt: { '!':null },
          endedAt: null
        },
        sort: { field:'updatedAt', order:'desc' },
        limit: 50,
      },
      {
        filter: {
          'teams[].playerId': { '!':myPlayerId },
          endedAt: { '!':null },
        },
        sort: { field:'endedAt', order:'desc' },
        limit: 50,
      },
    ];

    promises.push(
      gameClient.joinCollectionGroup(`public`, { query }).then(rsp => {
        tabContent.games = rsp.results.map(r => new Map(r.hits.map(h => [ h.id, h ])));
        tabContent.isSynced = true;
      })
    );
  }

  return Promise.all(promises).catch(error => {
    if (error !== 'Connection reset')
      throw error;

    if (state.currentTab !== tabName)
      return;

    return fetchGames(tabName);
  });
}
