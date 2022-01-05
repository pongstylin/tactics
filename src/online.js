import config from 'config/client.js';
import copy from 'components/copy.js';
import share from 'components/share.js';
import ScrollButton from 'components/ScrollButton.js';
import unitDataMap from 'tactics/unitData.js';
import { colorFilterMap } from 'tactics/colorMap.js';
import unitFactory from 'tactics/unitFactory.js';
import whenTransitionEnds from 'components/whenTransitionEnds.js';

// We will be fetching the updates games list from the server on this interval
const GAMES_FETCH_INTERVAL = 5 * 1000;

const authClient = Tactics.authClient;
const gameClient = Tactics.gameClient;
const pushClient = Tactics.pushClient;
const popup = Tactics.popup;

let myPlayerId = null;
const state = {
  audioEnabled: false,
  isInitialized: false,
  isLoading: false,
  isLoaded: false,
  currentTab: null,
  selectedStyleId: 'freestyle',
  selectedGroupId: 'lobby',
  my: {},
  stats: new Map(),
  lobby: {},
  public: {},
};
window.test = state;
const fillArenaQueueMap = new Map();

setCurrentTab();

const pushPublicKey = Uint8Array.from(
  atob(
    config.pushPublicKey
      .replace(/-/g, '+').replace(/_/g, '/')
  ),
  chr => chr.charCodeAt(0),
);

const lightFilter = new PIXI.filters.ColorMatrixFilter();
lightFilter.brightness(1.25);

const avatarsById = new Map();
let avatars;
let arena;
const avatarsPromise = Tactics.load([ 'avatars' ]).then(() => {
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

  renderLobby();
  avatarsPromise.isResolved = true;
});

const renderer = new PIXI.Renderer();
const randomAvatarName = () => [ ...unitDataMap.keys() ].random();
const randomAvatarColor = () => [ ...colorFilterMap.keys() ].random();

const randomAvatars = new Map();
const getAvatar = (team, direction = 'S') => {
  if (team.avatar === undefined) {
    if (!randomAvatars.has(team.playerId))
      randomAvatars.set(team.playerId, { avatar:randomAvatarName(), color:randomAvatarColor() });
    Object.assign(team, randomAvatars.get(team.playerId));
  }

  const avatarId = [ team.avatar, team.color, direction ].join(':');
  if (avatarsById.has(avatarId))
    return avatarsById.get(avatarId);

  const unit = unitFactory(team.avatar);
  const spriteName = unit.baseSprite ?? team.avatar;
  const trim = team.avatar === 'DragonspeakerMage' ? 'PyromancerTrim' : `${spriteName}Trim`;

  const frame = avatars.renderFrame({
    spriteName,
    actionName: 'stand',
    direction,
    styles: { [ trim ]:{ rgb:colorFilterMap.get(team.color) } },
  }).container;

  if (team.avatar === 'ChaosDragon') {
    const unitContainer = unit.getContainerByName(`${spriteName}Unit`, frame);
    // This heuristic skips empty frames (while dragon flies)
    if (unitContainer.children.length === 1) return;
    const trimContainer = unit.getContainerByName(`${spriteName}Trim`, frame);
    const filter = new PIXI.filters.ColorMatrixFilter();
    filter.matrix[0] = 2;
    filter.matrix[6] = 2;
    filter.matrix[12] = 2;

    unitContainer.children[0].filters = [filter];
    trimContainer.children[0].filters = [filter];
  }
  frame.filters = [ lightFilter ];

  const bounds = frame.getLocalBounds();
  const avatarCanvas = renderer.plugins.extract.canvas(frame);
  const avatar = {
    x: bounds.x,
    y: bounds.y,
    src: avatarCanvas.toDataURL('image/png'),
  };
  avatarsById.set(avatarId, avatar);

  return avatar;
};
state.getAvatar = getAvatar;

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

gameClient
  .on('event', ({ body }) => {
    if (body.group === `/myGames/${authClient.playerId}`) {
      if (body.type === 'stats') {
        state.my.stats = body.data;
        renderStats('my');
      } else if (body.type === 'add' || body.type === 'change')
        setYourGame(body.data);
      else if (body.type === 'remove')
        unsetYourGame(body.data);
    } else if (body.group === '/collections') {
      if (body.type === 'stats') {
        state.stats.set(body.data.collectionId, body.data.stats);
        renderStats('collections');
      }
    } else if (body.group === `/collections/lobby/${state.selectedStyleId}`) {
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
    if (state.isInitialized && reason !== 'resume')
      syncData()
        .then(openTab)
        .catch(error => {
          if (error === 'Connection reset')
            return;
          throw error;
        });
  })
  .on('close', ({ data:{ reopen } }) => {
    const divLoading = document.querySelector('.tabContent .loading');
    if (reopen)
      divLoading.classList.add('is-active');
    state.isLoaded = false;
  });

window.addEventListener('DOMContentLoaded', () => {
  let divGreeting = document.querySelector('.greeting');
  let divNotice = document.querySelector('#notice');

  if (authClient.token) {
    // Just in case fetching the most recent info is slow...
    divGreeting.textContent = `Welcome, ${authClient.playerName}!`;
    divGreeting.style.display = '';

    if (navigator.onLine === false)
      divNotice.textContent = 'Your games will be loaded once you are online.';
    else
      divNotice.textContent = 'Loading your games...';
  }
  else {
    divGreeting.style.display = '';
    divNotice.textContent = 'Once you create or join some games, you\'ll see them here.';
  }

  authClient.whenReady.then(async () => {
    myPlayerId = authClient.playerId;

    if (myPlayerId) {
      divGreeting.textContent = `Welcome, ${authClient.playerName}!`;
      await init();
      divNotice.textContent = '';
      document.querySelector('.tabs').style.display = '';
    } else {
      divGreeting.textContent = `Welcome!`;
      divNotice.textContent = 'Once you create or join some games, you\'ll see them here.';
      return;
    }
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

  let getShareGameMessage = async gameId => {
    let gameData = await gameClient.getGameData(gameId);
    let gameType = await gameClient.getGameType(gameData.state.type);

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
  let gameClickHandler = async event => {
    let divGame = event.target.closest('.game');
    if (!divGame) return;

    let gameId = divGame.id;
    let link = location.origin + '/game.html?' + gameId;

    let spnCopy = event.target.closest('.copy');
    if (spnCopy) {
      let message = await getShareGameMessage(gameId);

      copy(`${message} ${link}`);
      popup({
        message:'Copied the game link.  Paste the link to invite using your app of choice.',
        maxWidth: '250px',
      });
      return;
    }

    let spnShare = event.target.closest('.share');
    if (spnShare) {
      let message = await getShareGameMessage(gameId);

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

  window.addEventListener('hashchange', event => {
    if (state.currentTab === 'yourGames')
      clearTimeout(state.my.renderTimeout);
    else if (state.currentTab === 'lobby')
      gameClient.leaveCollectionGroup(`lobby/${state.selectedStyleId}`);
    else if (state.currentTab === 'publicGames') {
      gameClient.leaveCollectionGroup('public');
      clearTimeout(state.public.renderTimeout);
    }

    setCurrentTab();
    openTab();
  });

  const dynamicStyle = document.createElement('STYLE');
  document.body.appendChild(dynamicStyle);

  window.addEventListener('resize', () => resize(dynamicStyle.sheet));
  resize(dynamicStyle.sheet);
});

function init() {
  return syncData()
    .then(() => {
      if (state.my.lobbyGame) {
        const styleId = state.my.lobbyGame.collection.slice(6);
        if (avatarsPromise.isResolved)
          selectStyle(styleId, true);
        else
          state.selectedStyleId = styleId;
      }

      state.isInitialized = true;
      return openTab();
    })
    .catch(error => {
      if (error === 'Connection reset')
        return init();
      throw error;
    });
}
function setCurrentTab() {
  state.currentTab = 'yourGames';
  if (location.hash === '#lobby')
    state.currentTab = 'lobby';
  else if (location.hash === '#publicGames')
    state.currentTab = 'publicGames';
}
function setYourGame(gameSummary) {
  const isLobbyGame = gameSummary.collection?.startsWith('lobby/');
  const lobbyGame = state.my.lobbyGame;
  unsetYourGame(gameSummary, true);

  if (gameSummary.endedAt)
    state.my.games[2] = new Map([ [ gameSummary.id, gameSummary ], ...state.my.games[2] ]);
  else if (isLobbyGame)
    state.my.games[3] = new Map([ [ gameSummary.id, gameSummary ], ...state.my.games[3] ]);
  else if (gameSummary.startedAt)
    state.my.games[1] = new Map([ [ gameSummary.id, gameSummary ], ...state.my.games[1] ]);
  else
    state.my.games[0] = new Map([ [ gameSummary.id, gameSummary ], ...state.my.games[0] ]);

  if (isLobbyGame) {
    if (lobbyGame) {
      if (lobbyGame.id === gameSummary.id) {
        if (gameSummary.endedAt)
          state.my.lobbyGame = null;
        else {
          state.my.lobbyGame = gameSummary;
          if (gameSummary.startedAt && !lobbyGame.startedAt)
            return startGame();
        }
      }
    } else {
      if (!gameSummary.endedAt)
        state.my.lobbyGame = gameSummary;
    }
  }

  if (state.currentTab === 'yourGames')
    renderYourGames();
}
function unsetYourGame(gameSummary, skipRender = false) {
  state.my.games[0].delete(gameSummary.id);
  state.my.games[1].delete(gameSummary.id);
  state.my.games[2].delete(gameSummary.id);
  state.my.games[3].delete(gameSummary.id);

  if (gameSummary.id === state.my.lobbyGame?.id)
    state.my.lobbyGame = null;

  if (!skipRender && state.currentTab === 'yourGames')
    renderYourGames();
}
function setLobbyGame(gameSummary) {
  unsetLobbyGame(gameSummary, true);

  if (!gameSummary.startedAt)
    state.lobby.games[0] = new Map([ [ gameSummary.id, gameSummary ], ...state.lobby.games[0] ]);
  else if (!gameSummary.endedAt)
    state.lobby.games[1] = new Map([ [ gameSummary.id, gameSummary ], ...state.lobby.games[1] ]);
  else if (gameSummary.teams.findIndex(t => t?.playerId === authClient.playerId) === -1)
    state.lobby.games[2] = new Map([ [ gameSummary.id, gameSummary ], ...state.lobby.games[2] ]);

  renderLobbyGames();
}
function unsetLobbyGame(gameSummary, skipRender = false) {
  state.lobby.games[0].delete(gameSummary.id);
  state.lobby.games[1].delete(gameSummary.id);
  state.lobby.games[2].delete(gameSummary.id);

  if (!skipRender)
    renderLobbyGames();
}
function setPublicGame(gameSummary) {
  unsetPublicGame(gameSummary, true);

  if (!gameSummary.startedAt)
    state.public.games[0] = new Map([ [ gameSummary.id, gameSummary ], ...state.public.games[0] ]);
  else if (!gameSummary.endedAt)
    state.public.games[1] = new Map([ [ gameSummary.id, gameSummary ], ...state.public.games[1] ]);
  else
    state.public.games[2] = new Map([ [ gameSummary.id, gameSummary ], ...state.public.games[2] ]);

  renderPublicGames();
}
function unsetPublicGame(gameSummary, skipRender = false) {
  state.public.games[0].delete(gameSummary.id);
  state.public.games[1].delete(gameSummary.id);
  state.public.games[2].delete(gameSummary.id);

  if (!skipRender)
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
function selectStyle(styleId, skipFill = false) {
  if (styleId !== state.selectedStyleId && state.isInitialized)
    gameClient.leaveCollectionGroup(`lobby/${state.selectedStyleId}`);

  const spnStyle = document.querySelector('.lobby HEADER .style');
  const divArenas = document.querySelector('.lobby .arenas');
  const ulFloorList = divArenas.querySelector('.floors UL');
  const divArenaList = Array.from(divArenas.querySelectorAll('.arena'));

  ulFloorList.querySelector(`[data-style-id=${state.selectedStyleId}]`).classList.remove('selected');
  ulFloorList.querySelector(`[data-style-id=${styleId}]`).classList.add('selected');

  spnStyle.textContent = styles.get(styleId);
  state.selectedStyleId = styleId;

  if (!skipFill) {
    Promise.all(divArenaList.map(d => queueFillArena(d, state.selectedGroupId === 'lobby')))
      .then(fetchGames);
  }
}
async function selectGroup(groupId, skipFill = false) {
  const divArenas = document.querySelector('.lobby .arenas');
  const divGroups = divArenas.querySelector('.groups');
  const ulGroupList = divGroups.querySelector('UL');
  const divArenaList = Array.from(divArenas.querySelectorAll('.arena'));
  const footer = document.querySelector('.lobby FOOTER');
  const spnGroup = footer.querySelector('.group');

  divArenas.classList.toggle('active', groupId === 'active');
  divArenas.classList.toggle('complete', groupId === 'complete');

  ulGroupList.querySelector(`[data-group-id=${state.selectedGroupId}]`).classList.remove('selected');
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
  state.selectedGroupId = groupId;

  if (!skipFill) {
    await Promise.all(divArenaList.map(d => queueFillArena(d, false)));
    renderLobbyGames();
  }
}
async function selectArena(divArena) {
  if (divArena.classList.contains('empty')) {
    if (state.my.lobbyGame?.collection === `lobby/${state.selectedStyleId}`)
      moveGame(divArena);
    else
      createGame(divArena);
  } else if (divArena.classList.contains('waiting')) {
    const arena = JSON.parse(divArena.dataset.arena);

    if (arena.teams.find(t => t?.playerId === authClient.playerId))
      cancelGame();
    else
      joinGame(arena.id);
  } else {
    const arena = JSON.parse(divArena.dataset.arena);
    location.href = `/game.html?${arena.id}`;
  }
}
async function createGame(divArena) {
  if (!await cancelGame())
    return;

  try {
    await gameClient.createGame(state.selectedStyleId, {
      collection: `lobby/${state.selectedStyleId}`,
      randomFirstTurn: true,
      randomHitChance: true,
      strictUndo: true,
      autoSurrender: true,
      turnTimeLimit: 120,
      turnTimeBuffer: 0,
      teams: [
        {
          playerId: authClient.playerId,
          set: { name:'default' },
        },
        null,
      ],
      tags: {
        arenaIndex: parseInt(divArena.dataset.index),
      },
    });
  } catch (e) {
    if (e.code === 429)
      popup('Creating games too quickly.');
    else if (e.code !== 404) {
      reportError(e);
      popup('Oops!  Something went wrong.');
    }
    return false;
  }

  return true;
}
async function moveGame(divArena) {
  const myLobbyGame = state.my.lobbyGame;

  gameClient.tagGame(myLobbyGame.id, {
    arenaIndex: parseInt(divArena.dataset.index),
  });
}
async function cancelGame() {
  const myLobbyGame = state.my.lobbyGame;
  if (!myLobbyGame)
    return true;

  try {
    await gameClient.cancelGame(myLobbyGame.id);
    return true;
  } catch (e) {
    if (e.code !== 409) {
      reportError(e);
      popup('Oops!  Something went wrong.');
    }
    return false;
  }
}
async function joinGame(gameId) {
  if (!await cancelGame())
    return false;

  try {
    await gameClient.joinGame(gameId, {
      playerId: authClient.playerId,
      set: { name:'default' },
    });
    return true;
  } catch (e) {
    if (e.code !== 409) {
      reportError(e);
      popup('Oops!  Something went wrong.');
    }
    return false;
  }
}
function startGame() {
  const gameId = state.my.lobbyGame.id;

  const newGame = avatars.getSound('newgame').howl;
  newGame.once('end', () => {
    location.href = `/game.html?${gameId}`;
  });
  newGame.play();
}

function renderPN(reg) {
  let divPN = document.querySelector('#pn');

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
  let divPN = document.querySelector('#pn');

  return navigator.serviceWorker.getRegistration().then(reg =>
    reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: pushPublicKey,
    }).then(subscription => {
      // renderPN() will sync the server with the current status.
      renderPN(reg);
    })
    .catch(error => {
      if (window.Notification.permission === 'denied')
        return renderPN(reg);

      console.error('subscribe:', error);

      divPN.innerHTML = 'Failed to subscribe to push notifications.';
    })
  );
}
function unsubscribePN() {
  let divPN = document.querySelector('#pn');

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
  if (scope === 'my' || scope === 'all') {
    let numYourTurn = 0;

    for (const game of state.my.games[1].values()) {
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
    let numPublic = state.stats.get('public').waiting;
    const numLobbyByStyle = new Map();

    for (const [ collectionId, stats ] of state.stats) {
      if (!collectionId.startsWith('lobby/'))
        continue;

      const styleId = collectionId.slice(6);
      numLobby += stats.waiting;

      numLobbyByStyle.set(styleId, stats.waiting);
    }

    for (const game of state.my.games[3].values()) {
      if (game.startedAt)
        continue;

      numLobby--;

      const styleId = game.collection.slice(6);
      numLobbyByStyle.set(styleId, numLobbyByStyle.get(styleId) - 1);
    }

    for (const game of state.my.games[0].values()) {
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
function renderGames() {
  renderStats();

  if (state.currentTab === 'yourGames')
    renderYourGames();
  else if (state.currentTab === 'lobby')
    renderLobbyGames();
  else if (state.currentTab === 'publicGames')
    renderPublicGames();

  return true;
}

function renderLobby() {
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
  btnSetup.addEventListener('click', event => {
    popup('Sorry!  Setup is not yet available.');
  });
  divControls.appendChild(btnSetup);

  const btnSettings = document.createElement('BUTTON');
  btnSettings.classList.add('fa');
  btnSettings.classList.add('fa-cog');
  btnSettings.name = 'settings';
  btnSettings.title = 'Settings';
  btnSettings.addEventListener('click', event => {
    popup('Sorry!  Settings are not yet available.');
  });
  divControls.appendChild(btnSettings);

  /*****************************************************************************
   * Arenas
   */
  const divContent = document.createElement('DIV');
  divContent.classList.add('content');
  liLobby.appendChild(divContent);

  const divArenas = document.createElement('DIV');
  divArenas.classList.add('arenas');
  divContent.appendChild(divArenas);

  divArenas.appendChild(renderFloors());
  divArenas.appendChild(renderGroups());

  for (let i = 0; i < 14; i++) {
    divArenas.appendChild(renderArena(i));
  }

  /*
   * Lobby Selection
   */
  const footer = document.createElement('FOOTER');
  const groupIds = [ ...groups.keys() ];

  const btnScrollLeft = new ScrollButton('left').render();
  btnScrollLeft.addEventListener('click', () => {
    const groupIndex = groupIds.indexOf(state.selectedGroupId);
    selectGroup(groupIds[groupIndex - 1]);
  });
  footer.appendChild(btnScrollLeft);

  const spnGroup = document.createElement('SPAN');
  spnGroup.classList.add('group');
  spnGroup.textContent = 'Lobby';
  footer.appendChild(spnGroup);

  const btnScrollRight = new ScrollButton('right').render();
  btnScrollRight.addEventListener('click', () => {
    const groupIndex = groupIds.indexOf(state.selectedGroupId);
    selectGroup(groupIds[groupIndex + 1]);
  });
  footer.appendChild(btnScrollRight);

  liLobby.appendChild(footer);

  selectStyle(state.selectedStyleId, true);
  selectGroup(state.selectedGroupId, true);
}
function renderFloors() {
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
    liFloor.addEventListener('click', () => {
      if (liFloor.classList.contains('selected'))
        return;

      avatars.getSound('select').howl.play();

      selectStyle(styleId);
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
  const divGroups = document.createElement('DIV');
  divGroups.classList.add('groups');

  const divGroupList = document.createElement('DIV');
  divGroupList.classList.add('list');
  divGroups.appendChild(divGroupList);

  const ulGroupList = document.createElement('UL');
  for (const [ groupId, groupName ] of groups) {
    const liGroup = document.createElement('LI');
    liGroup.classList.toggle('selected', groupId === state.selectedGroupId);
    liGroup.dataset.groupId = groupId;
    liGroup.addEventListener('mouseenter', () => {
      if (liGroup.classList.contains('selected'))
        return;

      avatars.getSound('focus').howl.play();
    });
    liGroup.addEventListener('click', () => {
      if (liGroup.classList.contains('selected'))
        return;

      avatars.getSound('select').howl.play();

      selectGroup(groupId);
    });
    liGroup.textContent = groupName;
    ulGroupList.appendChild(liGroup);
  }
  divGroupList.appendChild(ulGroupList);

  const groupIds = [ ...groups.keys() ];
  const btnScrollUp = new ScrollButton('up').render();
  btnScrollUp.addEventListener('click', () => {
    const groupIndex = groupIds.indexOf(state.selectedGroupId);
    selectGroup(groupIds[groupIndex - 1]);
  });
  divGroupList.appendChild(btnScrollUp);

  const btnScrollDown = new ScrollButton('down').render();
  btnScrollDown.addEventListener('click', () => {
    const groupIndex = groupIds.indexOf(state.selectedGroupId);
    selectGroup(groupIds[groupIndex + 1]);
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

  return divArena;
}
function getLobbyGames() {
  const arenas = new Array(14).fill(null);
  // Subtract 1 to reserve an arena.
  let numRemaining = arenas.length - 1;

  /*
   * Place my waiting or active lobby game.
   */
  if (state.my.lobbyGame?.collection === `lobby/${state.selectedStyleId}`) {
    const index = state.my.lobbyGame.tags.arenaIndex;

    arenas[index] = state.my.lobbyGame;
    // Do not subtract from numRemaining to use the reserved arena.
  }

  /*
   * Place all waiting games with no conflicts.
   */
  const waitingGames = [ ...state.lobby.games[0].values() ]
    .sort((a,b) => a.createdAt - b.createdAt);

  // Cloning the array allows us to use .splice()
  for (const game of waitingGames.slice()) {
    if (game.id === state.my.lobbyGame?.id) {
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
  const activeGames = [ ...state.lobby.games[1].values() ]
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
  const completeGames = [ ...state.lobby.games[2].values() ]
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
  const arenas = [];

  if (state.selectedGroupId === 'lobby')
    arenas.push(...getLobbyGames());
  else if (state.selectedGroupId === 'active')
    arenas.push(...state.lobby.games[1].values());
  else if (state.selectedGroupId === 'complete')
    arenas.push(...state.lobby.games[2].values());

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

  divArena.classList.toggle('disabled', !!state.my.lobbyGame?.startedAt && !arena.startedAt);

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
    divArena.classList.toggle('disabled', !!state.my.lobbyGame?.startedAt && !arena.startedAt);
  } else {
    await Promise.all([
      fillTeam(divArena, 'top', arena, oldArena),
      fillTeam(divArena, 'btm', arena, oldArena),
    ]);
  }
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
    const avatar = getAvatar(team, slot === 'top' ? 'S' : 'N');
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
    divArena.classList.toggle('disabled', !!state.my.lobbyGame?.startedAt);
    return false;
  }

  const oldArena = JSON.parse(divArena.dataset.arena);

  delete divArena.dataset.arena;
  divArena.classList.remove('waiting');
  divArena.classList.remove('active');
  divArena.classList.remove('complete');
  divArena.classList.add('empty');

  return Promise.all([
    fillTeam(divArena, 'top', null, oldArena),
    fillTeam(divArena, 'btm', null, oldArena),
  ]);
}

function renderYourGames() {
  const divTabContent = document.querySelector('.tabContent .yourGames');
  divTabContent.innerHTML = '';

  const now = gameClient.serverNow;
  const waitingGames = [ ...state.my.games[0].values() ];
  const activeGames = [ ...state.my.games[1].values() ]
    .map(game => {
      if (game.turnTimeLimit)
        game.turnTimeRemaining = game.turnTimeLimit*1000 - (now - game.turnStartedAt.getTime());

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
  const completeGames = [ ...state.my.games[2].values() ];
  const lobbyGames = [ ...state.my.games[3].values() ]
    .map(game => {
      if (game.turnStartedAt && game.turnTimeLimit)
        game.turnTimeRemaining = game.turnTimeLimit*1000 - (now - game.turnStartedAt.getTime());

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
    // Exclude games where it is my turn
    if (game.teams[game.currentTeamId].playerId === myPlayerId)
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

  state.my.renderTimeout = setTimeout(renderYourGames, 30000);
}

async function renderPublicGames() {
  const divTabContent = document.querySelector('.tabContent .publicGames');
  divTabContent.innerHTML = '';

  const now = gameClient.serverNow;
  const waitingGames = [ ...state.public.games[0].values() ];
  const activeGames = [ ...state.public.games[1].values() ];
  const completeGames = [ ...state.public.games[2].values() ];

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

  state.public.renderTimeout = setTimeout(renderPublicGames, 30000);
}

function renderGame(game) {
  const teams = game.teams;

  let left = `${game.typeName}`;
  // Completed Games
  if (game.endedAt) {
    if (game.isFork)
      left += ', <SPAN>Fork</SPAN>';
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
    else if (game.collection?.startsWith('lobby/'))
      labels.push('Lobby');

    if (labels.length)
      left += ', <SPAN>' + labels.join(',</SPAN> <SPAN>') + '</SPAN>';
  // Waiting Games
  } else {
    const labels = [];

    if (game.turnTimeLimit === 86400)
      labels.push('1 Day');
    else if (game.turnTimeLimit === 120)
      labels.push('2 Min');
    else if (game.turnTimeLimit === 30)
      labels.push('30 sec');

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

    if (game.isFork)
      labels.push('Fork');
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

12345678901234567890123456789012345678901234567890123456789012345678901234567890
/*
 * This is complicated because this method is called under 3 circumstances:
 *   1) When the page first loads.
 *   2) When the tab changes.
 *   3) When we lose connection and must reconnect.
 *
 * The 1st two cases are detected by the fact that the desired tab is not active
 * yet.  In these cases, we must abort a previous tab load request, if any, and
 * start loading the current tab.
 *
 * The 3rd case must be skipped if we are already reloading or reloaded the tab.
 * This is tracked using the state.isLoading and state.isLoaded properties.
 * Otherwise, we must refetch the games and hide the loading spinner.
 *
 * The loading spinner is displayed any time we lost connection or a tab is
 * being loaded.
 */
async function openTab() {
  const tab = document.querySelector(`.tabs .${state.currentTab}`);
  const tabContent = document.querySelector(`.tabContent .${state.currentTab}`);
  const divLoading = document.querySelector(`.tabContent .loading`);

  if (tab.classList.contains('is-active')) {
    if (state.isLoading || state.isLoaded)
      return;
  } else if (!tab.classList.contains('is-active')) {
    document.querySelectorAll('.tabs LI')
      .forEach(li => li.classList.remove('is-active'));
    document.querySelectorAll('.tabContent > DIV')
      .forEach(div => div.classList.remove('is-active'));

    tab.classList.add('is-active');
  }

  divLoading.classList.add('is-active');
  divLoading.classList.add('hide');
  whenTransitionEnds(divLoading, () => {
    divLoading.classList.remove('hide');
  });
  state.isLoading = true;

  // If fetch games aborts, bail.
  if (!await fetchGames())
    return;

  if (state.currentTab === 'lobby') {
    setTimeout(() => {
      divLoading.classList.remove('is-active');
      state.isLoading = false;
      state.isLoaded = true;

      // Check for a running state directly in case the state property
      // hasn't updated yet.
      if (Howler.ctx.state === 'running' || state.audioEnabled)
        showLobby();
      else
        showEnterLobby();
    });
  } else {
    divLoading.classList.remove('is-active');
    state.isLoading = false;
    state.isLoaded = true;
    tabContent.classList.add('is-active');
  }
}
function showEnterLobby() {
  const divEnterLobby = document.querySelector('.tabContent .enterLobby');
  divEnterLobby.classList.add('is-active');
  divEnterLobby.querySelector('BUTTON').addEventListener('click', showLobby);
}
function showLobby() {
  const divEnterLobby = document.querySelector('.tabContent .enterLobby');
  if (divEnterLobby.classList.contains('is-active')) {
    divEnterLobby.classList.remove('is-active');
    divEnterLobby.querySelector('BUTTON').removeEventListener('click', showLobby);
  }

  const divLobby = document.querySelector('.tabContent .lobby');

  if (state.lobby.isOpen)
    divLobby.classList.add('is-active');
  else {
    divLobby.classList.add('is-active');
    divLobby.classList.add('disabled');
    divLobby.classList.add('hide');

    whenTransitionEnds(divLobby, () => {
      divLobby.classList.remove('hide');

      const login = avatars.getSound('login').howl;
      login.once('end', () => {
        divLobby.classList.remove('disabled');
      });
      login.play();

      state.lobby.isOpen = true;
    });
  }
}

function getTabNameForElement(el) {
  if (el.classList.contains('lobby'))
    return 'lobby';
  else if (el.classList.contains('yourGames'))
    return 'yourGames';
  else if (el.classList.contains('publicGames'))
    return 'publicGames';
}

async function syncData() {
  const query = [
    {
      filter: {
        collection: { '!':{ '~':/^lobby\// } },
        startedAt: null,
      },
      sort: { field:'updatedAt', order:'desc' },
      limit: 50,
    },
    {
      filter: {
        collection: { '!':{ '~':/^lobby\// } },
        startedAt: { '!':null },
        endedAt: null,
      },
      sort: { field:'updatedAt', order:'desc' },
      limit: 50,
    },
    {
      filter: { endedAt:{ '!':null } },
      sort: { field:'updatedAt', order:'desc' },
      limit: 50,
    },
    {
      filter: {
        collection: { '~':/^lobby\// },
        endedAt: null,
      },
      sort: { field:'updatedAt', order:'asc' },
      limit: 50,
    },
  ];

  return Promise.all([
    gameClient.joinCollectionStatsGroup().then(rsp => state.stats = rsp.stats),
    gameClient.joinMyGamesGroup({ query }).then(rsp => {
      state.my = {
        stats: rsp.stats,
        games: rsp.results.map(r => new Map(r.hits.map(h => [ h.id, h ]))),
      };

      if (rsp.results[3].hits.length)
        state.my.lobbyGame = rsp.results[3].hits[0];
      else
        state.my.lobbyGame = null;

      // TODO: Search for active lobby game and prompt to play it
      // (Make sure DOM is loaded, though)
      // Perhaps upgrade popups to auto wait for DOM load
    }),
  ]);
}
async function fetchGames() {
  if (state.fetcher)
    state.fetcher.abort = true;
  const fetcherState = state.fetcher = { abort:false };

  try {
    if (state.currentTab === 'lobby') {
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

      await gameClient.joinCollectionGroup(`lobby/${state.selectedStyleId}`, { query }).then(rsp => avatarsPromise.then(() => {
        state.lobby.games = rsp.results.map(r => new Map(r.hits.map(h => [ h.id, h ])));
      }));
    } else if (state.currentTab === 'publicGames') {
      const query = [
        {
          filter: {
            'teams[].playerId': { '!':myPlayerId },
            startedAt: null,
          },
          sort: { field:'createdAt', order:'desc' },
          limit: 50,
        },
        {
          filter: {
            'teams[].playerId': { '!':myPlayerId },
            startedAt: { '!':null },
            endedAt: null
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

      await gameClient.joinCollectionGroup(`public`, { query }).then(rsp => {
        state.public.games = rsp.results.map(r => new Map(r.hits.map(h => [ h.id, h ])));
      });
    }
  } catch(error) {
    if (error === 'Connection reset')
      return fetcherState.abort ? false : fetchGames();
    throw error;
  }

  return fetcherState.abort ? false : renderGames();
}
