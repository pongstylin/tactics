import config from 'config/client.js';
import copy from 'components/copy.js';
import ConfigureGameModal from 'components/Modal/ConfigureGame.js';
import Setup from 'components/Setup.js';
import ScrollButton from 'components/ScrollButton.js';
import share from 'components/share.js';
import whenDOMReady from 'components/whenDOMReady.js';
import whenTransitionEnds from 'components/whenTransitionEnds.js';
import sleep from 'utils/sleep.js';

const authClient = Tactics.authClient;
const gameClient = Tactics.gameClient;
const pushClient = Tactics.pushClient;
const popup = Tactics.popup;

const arenaGameSummary = new WeakMap();
const groups = new Map([
  [ 'lobby',    'Lobby' ],
  [ 'active',   'Active Games' ],
  [ 'complete', 'Completed Games' ],
]);

let myPlayerId = null;
let configureGame = null;

const state = {
  /*
   * Set to false at first, it means we won't wait for audio to be enabled
   * before showing the lobby.  Rather, we'll display an "Enter Lobby" button so
   * that audio may be enabled with a click.  Once clicked, either the value
   * will be set to true or a promise that will resolve once audio is enabled.
   */
  whenAudioEnabled: false,
  styles: null,
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
    },
    lobby: {
      // This is set to your active lobby game ID, if any.
      activeGameId: null,
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
      view: { gameTypeId:null, arenas:new Array(14).fill(null) },
    },
    publicGames: {
      isOpen: false,
      isSynced: false,
      whenSynced: Promise.resolve(),
      isLoading: false,
    },
    rankings: {
    },
  },
  avatars: new Map(),
};
const routes = new Map([
  [ '#rankings', p => ({
    route: renderRankings,
    data: Promise.all([
      authClient.getActiveRelationships().then(async relationships => {
        const favorites = config.getItem('favoritePlayers', {});
        const friendIds = Array.from(relationships).filter(r => r[1].type === 'friended').map(r => r[0]);
        const playerIds = new Set([ ...Object.keys(favorites), ...friendIds ]);
        const ratedPlayers = await authClient.getRatedPlayers([ ...playerIds ]);
        const favoritePlayers = new Map();

        for (const [ favoriteId, include ] of Object.entries(favorites)) {
          // A favorite can disappear if the player went inactive for 30 days.
          if (!ratedPlayers.has(favoriteId)) {
            delete favorites[favoriteId];
            continue;
          }

          const newIdentityId = ratedPlayers.get(favoriteId).identityId;
          if (favoriteId !== newIdentityId) {
            // Just in case the new identity id is already present, give `true` precedence.
            favorites[newIdentityId] ||= favorites[favoriteId];
            delete favorites[favoriteId];
          }
        }

        for (const [ favoriteId, player ] of ratedPlayers) {
          // New friends can be new favorites.
          favorites[player.identityId] ??= true;

          const type = friendIds.includes(player.identityId) ? 'friend' : 'favorite';
          if (type === 'friend')
            player.nickname = relationships.get(player.identityId).name;

          favoritePlayers.set(player.identityId, { ...player, type, active:favorites[player.identityId] });
        }

        config.setItem('favoritePlayers', favorites);

        return Array.from(favoritePlayers.values()).sort((a,b) => a.name.localeCompare(b.name));
      }),
      authClient.getRankings(),
    ]),
  }) ],
  [ '#rankings/topranks', p => ({
    route: renderTopRanks,
    data: authClient.getTopRanks(),
  }) ],
  [ '#rankings/:rankingId', p => ({
    route: () => renderRankingSummary(p.rankingId),
    data: Promise.all([
      authClient.getTopRanks(p.rankingId).then(tr => tr.get(p.rankingId) ?? []),
      gameClient.getRatedGames(p.rankingId),
    ]),
  }) ],
  [ '#rankings/:rankingId/all', p => ({
    route: () => renderRanking(p.rankingId),
    data: authClient.getRanks(p.rankingId),
  }) ],
  [ '#rankings/:playerId/:rankingId', p => ({
    route: () => renderPlayerRankingSummary(p.rankingId, p.playerId),
    data: Promise.all([
      authClient.getRatedPlayers([ p.playerId ]).then(pm => pm.get(p.playerId)),
      authClient.getPlayerRanks(p.playerId),
      gameClient.getRatedGames(p.rankingId, p.playerId),
    ]),
  }) ],
  [ '#rankings/**', p => ({
    route: () => renderRankingPageNotFound(),
    data: Promise.resolve(),
  }) ],
]);
const routeMatcher = Array.from(routes.keys()).map(path => {
  const parts = path.split('/');
  const names = [];
  const pattern = [];

  for (const part of parts) {
    if (part.startsWith(':')) {
      names.push(part.slice(1));
      pattern.push(`([^\\/]+)`);
    } else if (part === '**') {
      pattern.push('.+');
    } else if (part === '*') {
      pattern.push('[^/]+');
    } else {
      pattern.push(RegExp.escape(part));
    }
  }

  const re = new RegExp('^' + pattern.join('/') + '\/?$');

  return r => {
    const match = r.match(re);
    if (match) {
      const routeGetter = routes.get(path);
      const p = match.slice(1).reduce((p,v,i) => {
        p[names[i]] = v;
        return p;
      }, {});

      // Validate rankingId
      if (p.rankingId && p.rankingId !== 'FORTE' && !state.styles.some(s => s.id === p.rankingId))
        return false;

      // Validate playerId
      if (p.playerId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(p.playerId))
        return false;

      return routeGetter(p);
    }
  };
});


const onceClick = () => {
  if (Howler.ctx.state === 'running')
    state.whenAudioEnabled = true;
  else
    state.whenAudioEnabled = new Promise(resolve => {
      const stateChangeListener = () => {
        if (Howler.ctx.state !== 'running')
          return;

        Howler.ctx.removeEventListener('statechange', stateChangeListener);
        resolve(true);
      };
      Howler.ctx.addEventListener('statechange', stateChangeListener);
    });
  window.removeEventListener('click', onceClick, { passive:true, capture:true });
};
window.addEventListener('click', onceClick, { passive:true, capture:true });

const fillArenaQueueMap = new Map();

const pushPublicKey = Uint8Array.from(
  atob(
    config.pushPublicKey
      .replace(/-/g, '+').replace(/_/g, '/')
  ),
  chr => chr.charCodeAt(0),
);

let avatars;
let arena;
const handleAvatarsData = () => {
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
}

const getDataFromService = Tactics.load(['avatars']).then(async () => {
  state.styles = await gameClient.getGameTypes();
  handleAvatarsData();
  await Tactics.makeAvatarRenderer();
  await whenDOMReady;
  renderLobby();
});

const fetchAvatars = async playerIds => {
  const newPlayerIds = Array.from(new Set(playerIds.filter(pId => !state.avatars.has(pId))));

  if (newPlayerIds.length) {
    const avatars = await gameClient.getPlayersAvatar(newPlayerIds);
    for (let i = 0; i < newPlayerIds.length; i++)
      state.avatars.set(newPlayerIds[i], avatars[i]);
  }
}
const getAvatar = (playerId, options = {}) => {
  const avatar = state.avatars.get(playerId);

  return Tactics.drawAvatar(avatar, { direction:'S', withShadow:true, ...options });
};

whenDOMReady.then(() => {
  const divLoading = document.querySelector(`.tabContent .loading`);
  divLoading.classList.add('is-active');
  divLoading.classList.add('hide');
  whenTransitionEnds(divLoading, () => {
    divLoading.classList.remove('hide');
  });

  authClient.whenReady.then(async () => {
    divLoading.classList.remove('is-active');

    if (await authClient.requireAuth())
      history.replaceState(null, null, '#lobby');

    configureGame = new ConfigureGameModal({
      autoShow: false,
      hideOnCancel: true,
    });
    await configureGame.setGameType();
  });

  document.querySelector('.page > HEADER A').addEventListener('click', async event => {
    await configureGame.setGameType(null);
    configureGame.show('createGame');
  });

  const page = document.querySelector('.page');
  const divPN = page.querySelector('#pn');
  const btnAccount = page.querySelector('HEADER .account BUTTON');

  btnAccount.addEventListener('click', () => popup({
    className: 'account',
    title: 'Account',
    buttons: [
      {
        label: 'Profile',
        onClick: () => location.href = '/profile.html',
      },
      {
        label: '<SPAN class="warning">!!</SPAN>Security',
        onClick: () => location.href = '/security.html',
      },
      {
        label: 'Logout',
        onClick: async () => {
          if (document.body.classList.contains('account-is-at-risk')) {
            const answer = await popup({
              message: 'You are at risk of losing your account.  Are you sure you want to logout?',
              buttons: [ 'Yes', 'No' ],
              maxWidth: '250px',
            }).whenClosed;
            if (answer !== 'Yes')
              return;
          }
          await authClient.logout();
        },
      },
    ],
  }));

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
    divPN.innerHTML = 'Your browser does not support push notifications.';

  document.querySelector('.tabs UL').addEventListener('click', event => {
    const liTab = event.target.closest('LI:not(.is-active)');
    if (!liTab) return;

    if (liTab.classList.contains('rankings'))
      location.hash = config.getItem('rankingsBookmark', liTab.dataset.route);
    else
      location.hash = liTab.dataset.route;
  });

  const getShareGameMessage = async gameId => {
    const gameData = await gameClient.getGameData(gameId);
    const gameType = await gameClient.getGameType(gameData.state.type);

    let message = `Want to play a ${gameType.name} game`;
    if (gameData.state.timeLimit.base === 120)
      message += ' at 2min per turn';
    else if (gameData.state.timeLimit.base === 30)
      message += ' at 30sec per turn';
    if (!gameData.state.randomHitChance)
      message += ' without luck';
    message += '?';

    return message;
  };
  const gameClickHandler = async event => {
    const divArenaShape = event.target.closest('.arena-shape');
    if (divArenaShape && !divArenaShape.parentNode.classList.contains('disabled')) {
      avatars.getSound('select').howl.play();

      selectArena(event);
      return;
    }

    const divGame = event.target.closest('.game');
    if (!divGame) return;

    const gameId = divGame.id;

    const divTeam = event.target.closest('.team');
    if (divTeam) {
      const playerId = divTeam.dataset.playerId;
      location.href = `#rankings/${playerId}/FORTE`;
      return;
    }

    const link = `game.html?${gameId}`;

    const aDecline = event.target.closest('.decline A');
    if (aDecline) {
      popup({
        message: 'Please confirm that you want to decline this game.',
        buttons: [
          {
            label:'Yes',
            onClick: () => declineGame(gameId),
          },
          {
            label: 'No',
          },
        ],
        maxWidth: '250px',
      });
    }

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

  authClient
    .on('login', () => showTabs())
    .on('name-change', () => setMyName())
    .on('logout', () => hideTabs());
  if (authClient.isAuthorized)
    showTabs();

  gameClient
    .on('event', ({ body }) => {
      const statsContent = state.tabContent.stats;
      const yourContent = state.tabContent.yourGames;
      const lobbyContent = state.tabContent.lobby;
      const publicContent = state.tabContent.publicGames;

      if (body.group === `/myGames/${myPlayerId}`) {
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
        else if (body.type === 'remove') {
          // A game can be removed from the lobby list when you join it.
          // This is because the lobby excludes your games from the list.
          // But our own active lobby games should remain visible.
          if (body.data.teams.some(t => t?.playerId === authClient.playerId))
            return;

          unsetLobbyGame(body.data);
        }
      } else if (body.group === '/collections/public') {
        if (body.type === 'add' || body.type === 'change')
          setPublicGame(body.data);
        else if (body.type === 'remove')
          unsetPublicGame(body.data);
      }
    })
    .on('open', async ({ data:{ reason } }) => {
      if (state.currentTab === null || reason === 'resume')
        document.querySelector('.tabContent .loading').classList.remove('is-active');
      else {
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
      }
    })
    .on('close', ({ data:{ reopen } }) => {
      if (reopen)
        document.querySelector('.tabContent .loading').classList.add('is-active');
    });
});

async function showTabs() {
  const page = document.querySelector('.page');
  const header = page.querySelector('HEADER');
  const divPN = page.querySelector('#pn');
  const isAccountAtRisk = !authClient.isVerified;

  myPlayerId = authClient.playerId;
  setMyName();

  const avatar = (await gameClient.getPlayersAvatar([ myPlayerId ]))[0]; 

  document.body.classList.toggle('account-is-at-risk', isAccountAtRisk);

  await getDataFromService;
  setMyAvatar(avatar);
  state.tabContent.lobby.setup.avatar = avatar;

  header.style.display = '';
  divPN.style.display = '';

  await openTab();
  document.querySelector('.tabs').style.display = '';
}
function hideTabs() {
  const page = document.querySelector('.page');
  const header = page.querySelector('HEADER');
  const divPN = page.querySelector('#pn');

  closeTab();

  header.style.display = 'none';
  divPN.style.display = 'none';

  document.querySelector('.tabs').style.display = 'none';
  document.querySelector('.tabContent .loading').classList.remove('is-active');
}

function setMyName() {
  const spnName = document.querySelector('.page HEADER .account BUTTON .name');

  spnName.textContent = authClient.playerName;
}
function setMyAvatar(avatar) {
  const divAvatar = document.querySelector('.page HEADER .account .avatar-badge .image');

  state.avatars.set(myPlayerId, avatar);

  const imgAvatar = Tactics.getAvatarImage(avatar, { withFocus:false });
  const avatarData = JSON.parse(imgAvatar.dataset.avatar);
  const originY = avatarData.y > -80
    ? avatarData.y / 2
    : avatarData.y + Math.min(32, -avatarData.y / 2);
  imgAvatar.style.top = `${originY}px`;
  imgAvatar.style.left = `${avatarData.x}px`;
  imgAvatar.style.transformOrigin = `${-avatarData.x}px ${-originY}px`;

  divAvatar.innerHTML = '';
  divAvatar.appendChild(imgAvatar);
}
function setYourLobbyGame(gameSummary, skipRender = false) {
  const tabContent = state.tabContent.lobby;
  const isVisible = (
    state.currentTab === 'lobby' &&
    gameSummary.collection === `lobby/${tabContent.selectedStyleId}`
  );

  if (tabContent.activeGameId !== gameSummary.id && gameSummary.startedAt) {
    if (isVisible && tabContent.selectedGroupId === 'lobby') {
      const newGame = avatars.getSound('newgame').howl;
      newGame.once('end', () => {
        location.href = `game.html?${gameSummary.id}`;
      });
      newGame.play();
    } else {
      tabContent.activeGameId = gameSummary.id;
      popup({
        message: 'You have an active lobby game!',
        buttons: [
          {
            label: 'Play Now',
            onClick: () => location.href = `game.html?${gameSummary.id}`,
          },
          {
            label: 'Ignore',
            onClick: () => {},
          },
        ],
      });
    }
  }

  if (isVisible && !skipRender)
    placeLobbyGame(gameSummary);
}
function unsetYourLobbyGame(gameSummary, skipRender = false) {
  const tabContent = state.tabContent.lobby;
  const styleId = gameSummary.collection.slice(6);
  const isVisible = state.currentTab === 'lobby' && tabContent.selectedStyleId === styleId;

  if (!skipRender && isVisible)
    displaceLobbyGame(gameSummary);
}
function setYourGame(gameSummary) {
  const yourGames = state.tabContent.yourGames.games;
  const isVisibleLobbyGame = !gameSummary.endedAt && gameSummary.collection?.startsWith('lobby/') && !gameSummary.isChallenge;
  let oldSummary = null;

  for (let i = 0; i < yourGames.length; i++) {
    if (yourGames[i].has(gameSummary.id)) {
      oldSummary = yourGames[i].get(gameSummary.id);
      yourGames[i].delete(gameSummary.id);
    }
  }

  if (isVisibleLobbyGame)
    yourGames[4] = new Map([ [ gameSummary.id, gameSummary ], ...yourGames[4] ]);
  else if (gameSummary.endedAt)
    yourGames[3] = new Map([ [ gameSummary.id, gameSummary ], ...yourGames[3] ]);
  else if (gameSummary.startedAt)
    yourGames[2] = new Map([ [ gameSummary.id, gameSummary ], ...yourGames[2] ]);
  else if (gameSummary.createdBy === authClient.playerId)
    yourGames[1] = new Map([ [ gameSummary.id, gameSummary ], ...yourGames[1] ]);
  else
    yourGames[0] = new Map([ ...yourGames[0], [ gameSummary.id, gameSummary ] ]);

  if (isVisibleLobbyGame)
    setYourLobbyGame(gameSummary);
  else if (
    gameSummary.createdBy !== authClient.playerId &&
    !gameSummary.isSimulation &&
    !oldSummary?.startedAt && gameSummary.startedAt &&
    !gameSummary.endedAt &&
    gameSummary.currentTeam.playerId === authClient.playerId
  ) {
    const newGame = avatars.getSound('newgame').howl;
    newGame.once('end', () => {
      location.href = `game.html?${gameSummary.id}`;
    });
    newGame.play();
  } else if (!oldSummary?.endedAt && gameSummary.endedAt && gameSummary.collection?.startsWith('lobby/'))
    unsetYourLobbyGame(gameSummary);

  if (state.currentTab === 'yourGames')
    renderYourGames();
}
function unsetYourGame(gameSummary) {
  const yourGames = state.tabContent.yourGames.games;
  const isVisibleLobbyGame = !gameSummary.endedAt && gameSummary.collection?.startsWith('lobby/') && !gameSummary.isChallenge;
  let isDirty = false;

  for (let i = 0; i < yourGames.length; i++)
    if (yourGames[i].delete(gameSummary.id))
      isDirty = true;

  if (isDirty) {
    if (state.currentTab === 'yourGames')
      renderYourGames();
    else if (isVisibleLobbyGame)
      unsetYourLobbyGame(gameSummary);
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
  else if (gameSummary.teams.findIndex(t => t?.playerId === myPlayerId) === -1)
    lobbyGames[2] = new Map([ [ gameSummary.id, gameSummary ], ...lobbyGames[2] ]);

  placeLobbyGame(gameSummary);
}
function unsetLobbyGame(gameSummary) {
  const lobbyGames = state.tabContent.lobby.games;
  let isDirty = false;

  for (let i = 0; i < lobbyGames.length; i++) {
    if (lobbyGames[i].delete(gameSummary.id))
      isDirty = true;
  }

  if (isDirty)
    displaceLobbyGame(gameSummary);
}
function placeLobbyGame(gameSummary, skipRender = false) {
  const tabContent = state.tabContent.lobby;
  const isVisible = state.currentTab === 'lobby' && gameSummary.collection === `lobby/${tabContent.view.gameTypeId}`;
  if (!isVisible)
    return;

  const getNextIndex = a => a.indexOf(a.slice().sort((a,b) => {
    // Use empty arenas first
    if (!a) return -1;
    if (!b) return 1;
    // Use my game last
    if (a.createdBy === authClient.playerId) return 1;
    if (b.createdBy === authClient.playerId) return -1;
    // Use the oldest completed game
    if (a.endedAt && b.endedAt) return a.endedAt - b.endedAt;
    // Use a completed game over a pending game
    if (a.endedAt) return -1;
    if (b.endedAt) return 1;
    // Use the oldest started game
    if (a.startedAt && b.startedAt) return a.startedAt - b.startedAt;
    // Use a started game over a waiting game
    if (a.startedAt) return -1;
    if (b.startedAt) return 1;
    // Use the NEWEST waiting game
    return b.createdAt - a.createdAt;
  })[0]);

  const arenas = tabContent.view.arenas;
  const nextIndex = getNextIndex(arenas);
  const oldIndex = arenas.findIndex(a => a?.id === gameSummary.id);
  const newIndex = gameSummary.tags.arenaIndex ?? -1;
  const hasPrecedence = (a,b) => {
    // Take empty slots
    if (!b) return true;
    // Displace ended games with pending games.
    if (b.endedAt && !a.endedAt) return true;
    // Displace started games with open games.
    if (b.startedAt && !a.startedAt) return true;
    // Displace newer waiting games with older waiting games.
    if (b.createdAt < a.createdAt) return true;
    // Do not displace.
    return false;
  };

  if (oldIndex === -1) {
    if (newIndex === -1) {
      arenas[nextIndex] = gameSummary;
    } else {
      if (hasPrecedence(gameSummary, arenas[newIndex]))
        arenas[newIndex] = gameSummary;
      else
        arenas[nextIndex] = gameSummary;
    }
  } else {
    if (newIndex === -1) {
      arenas[oldIndex] = gameSummary;
    } else if (oldIndex === newIndex) {
      arenas[oldIndex] = gameSummary;
    } else if (!gameSummary.startedAt) {
      if (hasPrecedence(gameSummary, arenas[newIndex])) {
        arenas[oldIndex] = null;
        arenas[newIndex] = gameSummary;
      } else
        arenas[oldIndex] = gameSummary;
    } else {
      arenas[oldIndex] = gameSummary;
    }
  }

  const usingSlot = arenas.some(a => a?.createdBy === authClient.playerId);

  if (!usingSlot && !arenas.some(a => a === null)) {
    const clearIndex = getNextIndex(arenas);
    arenas[clearIndex] = null;
  }

  if (!skipRender)
    renderLobbyGames();
}
function displaceLobbyGame(gameSummary) {
  const tabContent = state.tabContent.lobby;
  const arenas = tabContent.view.arenas;
  const oldIndex = arenas.findIndex(a => a?.id === gameSummary.id);
  if (oldIndex === -1)
    return;

  arenas[oldIndex] = null;

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
      .lobby .arena {
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

  const styles = state.styles;
  spnStyle.textContent = styles.find(style => style.id === styleId).name;
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
async function selectArena(event) {
  const divArena = event.target.closest('.arena');

  if (divArena.classList.contains('empty')) {
    const tabContent = state.tabContent.lobby;
    const myLobbyGames = Array.from(state.tabContent.yourGames.games[4].values());
    const lobbyGame = myLobbyGames.find(gs => gs.collection === `lobby/${tabContent.selectedStyleId}`);
    if (lobbyGame)
      moveGame(lobbyGame, divArena);
    else
      createGame(divArena);
  } else if (divArena.classList.contains('waiting')) {
    const arena = arenaGameSummary.get(divArena);

    if (arena.createdBy === myPlayerId) {
      if (state.currentTab !== 'lobby') {
        const doCancel = await popup({
          message: 'Are you sure you want to cancel the game?',
          buttons: [
            { label:'Yes' },
            { label:'No' },
          ],
        }).whenClosed;
        if (doCancel !== 'Yes')
          return;
      }

      cancelGame(arena);
    } else
      joinGame(arena);
  } else {
    const arena = arenaGameSummary.get(divArena);
    const link = `/game.html?${arena.id}`;

    // Support common open-new-tab semantics
    if (event.ctrlKey || event.metaKey || event.button === 1)
      open(link, '_blank');
    else
      location.href = link;
  }
}
async function createGame(divArena) {
  const tabContent = state.tabContent.lobby;

  await configureGame.setGameType(tabContent.selectedStyleId);

  if (configureGame.confirmBeforeCreate) {
    await configureGame.show('confirmBeforeCreate', {
      arenaIndex: parseInt(divArena.dataset.index),
    });
    return;
  }

  try {
    await gameClient.createGame(tabContent.selectedStyleId, {
      ...configureGame.createGameOptions('confirmBeforeCreate'),
      tags: {
        arenaIndex: parseInt(divArena.dataset.index),
      },
    });
  } catch (e) {
    if (e.code === 429)
      popup('Creating games too quickly.');
    // Ignore cases where we attempted to create multiple open games
    else if (e.code !== 409) {
      popup('Oops!  Something went wrong.');
      reportError(e);
    }
    return false;
  }

  return true;
}
async function moveGame(lobbyGame, divArena) {
  gameClient.tagGame(lobbyGame.id, {
    arenaIndex: parseInt(divArena.dataset.index),
  });
}
async function cancelGame(arena) {
  if (!arena)
    return true;

  try {
    await gameClient.cancelGame(arena.id);
    return true;
  } catch (e) {
    if (e.code !== 404 && e.code !== 409) {
      reportError(e);
      popup('Oops!  Something went wrong.');
    }
    return false;
  }
}
async function declineGame(gameId) {
  try {
    await gameClient.declineGame(gameId);
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
  const tabContent = state.tabContent.lobby;

  const creatorTeam = arena.teams.find(t => t?.playerId === arena.createdBy);
  if (arena.meta.creator.relationship?.blockedByRule) {
    let message;
    if (arena.meta.creator.relationship.blockedByRule === 'guest')
      message = `
        Sorry!  <I>${creatorTeam.name}</I> blocked guests from joining their public and lobby games.
        You can verify your account on your <A href="security.html">Account Security</A> page.
      `;
    else if (arena.meta.creator.relationship.blockedByRule === 'new')
      message = `
        Sorry!  <I>${creatorTeam.name}</I> blocked new players from joining their public and lobby games.
        You can try again later or create your own game.
      `;
    else
      message = `You are blocked for unknown reasons.`;

    return popup({
      message,
      buttons: [
        { label:'Ok', value:false },
      ],
      maxWidth: '300px',
    });
  }

  if (arena.rated && !arena.meta.rated) {
    const reason =
      arena.meta.unratedReason === 'not verified' ? 'You have not verified your account yet' :
      arena.meta.unratedReason === 'same identity' ? `You can't play yourself in a rated game` :
      arena.meta.unratedReason === 'in game' ? `You are already playing a rated game against this player in this style` :
      arena.meta.unratedReason === 'too many games' ? `You already played this player in this style twice in the past week` :
      'Unknown.  Report this bug';

    popup({ maxWidth:'325px', message:`
      Sorry!  You cannot join this rated game.<BR>
      <BR>
      Reason: ${reason}.
    ` });
    return false;
  }

  await configureGame.setGameType(arena.type);

  if (
    configureGame.confirmBeforeJoin ||
    arena.mode === 'fork' ||
    arena.meta.creator.relationship?.type === 'blocked' ||
    (arena.meta.creator.relationship?.name ?? creatorTeam.name) !== creatorTeam.name
  ) {
    await configureGame.show('confirmBeforeJoin', { gameSummary:arena });
    return;
  }

  try {
    await gameClient.joinGame(arena.id, configureGame.joinGameOptions('confirmBeforeJoin', { gameSummary:arena }));
    return true;
  } catch (e) {
    // A 403 for a rated game means rated rules weren't met
    if (arena.rated && e.code === 403) {
      popup({ maxWidth:'325px', message:`
        Sorry!  You cannot join this rated game.<BR>
        <BR>
        Reason: ${e.message}.
      ` });
    // A 404 means the game was cancelled right before we tried to join
    // A 409 means someone else joined the game first.
    } else if (e.code !== 404 && e.code !== 409) {
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
          const divCopy = bravePopup.root.querySelector('.copy.brave');

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

    for (const game of yourGames[0].values())
      numYourTurn++;

    for (const game of yourGames[2].values()) {
      // Exclude games where it is someone else's turn
      if (game.teams[game.currentTeamId].playerId !== myPlayerId)
        continue;
      // Exclude games where it is my turn, but it ended
      if (game.turnEndedAt)
        continue;
      // Exclude practice games
      if (!game.teams.find(t => t.playerId !== myPlayerId))
        continue;

      numYourTurn++;
    }

    if (Array.from(yourGames[4].values()).some(gs => gs.startedAt))
      numYourTurn++;

    document.querySelector('.tabs .yourGames .badge').textContent = numYourTurn || '';
  }

  if (scope === 'collections' || scope === 'all') {
    let numLobby = 0;
    const numPublic = statsByCollection.get('public').waiting;
    const numLobbyByStyle = new Map();

    for (const [ collectionId, stats ] of statsByCollection) {
      if (!collectionId.startsWith('lobby/'))
        continue;

      const styleId = collectionId.slice(6);
      numLobby += stats.waiting;

      numLobbyByStyle.set(styleId, stats.waiting);
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
  btnSettings.addEventListener('click', async event => {
    await configureGame.setGameType(lobbyState.selectedStyleId);
    configureGame.show('configureLobby');
  });
  divControls.appendChild(btnSettings);

  /*****************************************************************************
   * Content
   */
  const divContent = document.createElement('DIV');
  divContent.classList.add('content');
  liLobby.appendChild(divContent);

  lobbyState.setup = new Setup();
  lobbyState.setup
    .on('change:avatar', async ({ data:avatar }) => {
      setMyAvatar(avatar);

      gameClient.saveMyAvatar(avatar);
    })
    .on('change:sets', ({ data:sets }) => {
      lobbyState.sets = sets;
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

  const styles = state.styles;
  for (const { id: styleId, name: styleName } of styles) {
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
      const divArenaList = Array.from(document.querySelectorAll('.arenas .arena:not(.hide)'));
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
  divLabel.classList.add('labels');
  shpArena.appendChild(divLabel);

  return divArena;
}
async function renderLobbyGames() {
  const divArenas = document.querySelector('.lobby .arenas');
  const divArenaList = Array.from(divArenas.querySelectorAll('.arena'));
  const tabContent = state.tabContent.lobby;
  const arenas = [];

  // Just in case the lobby games haven't loaded yet
  // ... possible if "myGames" was joined first and a lobby game has changed
  if (!tabContent.games)
    return;

  if (!tabContent.selectedStyleId) {
    const lobbyGame = Array.from(state.tabContent.yourGames.games[4].values()).find(gs => !!gs.startedAt);
    if (lobbyGame)
      selectStyle(lobbyGame.collection.slice(6));
    else
      selectStyle(configureGame.gameTypeId);
  }

  if (!tabContent.selectedGroupId)
    selectGroup('lobby');

  if (tabContent.selectedGroupId === 'lobby')
    arenas.push(...tabContent.view.arenas);
  else if (tabContent.selectedGroupId === 'active')
    arenas.push(...Array.from(tabContent.games[1].values()).sort((a,b) => b.startedAt - a.startedAt));
  else if (tabContent.selectedGroupId === 'complete')
    arenas.push(...Array.from(tabContent.games[2].values()).sort((a,b) => b.endedAt - a.endedAt));

  /*
   * Cache the avatars for all the players we're about to see
   */
  await fetchAvatars(arenas.filter(a => !!a).map(a => a.teams.filter(t => !!t).map(t => t.playerId)).flat());

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

  const lobbyGame = Array.from(state.tabContent.yourGames.games[4].values()).find(gs => !!gs.startedAt);
  divArena.classList.toggle('disabled', !!lobbyGame && !arena.startedAt && arena.collection?.startsWith('lobby/'));

  const oldArena = arenaGameSummary.get(divArena) ?? null;
  if (arena === oldArena)
    return false;

  arenaGameSummary.set(divArena, arena);
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
    if (arena.rated === true)
      labels.push('Rated');
    else if (arena.rated === false && authClient.isVerified && arena.mode !== 'practice')
      labels.push('Unrated');
    if (arena.mode)
      labels.push(arena.mode.toUpperCase('first'));
    if (arena.timeLimitName && arena.timeLimitName !== 'standard')
      labels.push(arena.timeLimitName.toUpperCase('first'));
  }

  const divLabels = divArena.querySelector('.labels');
  divLabels.innerHTML = '';

  for (const label of labels) {
    const divLabel = document.createElement('DIV');
    divLabel.classList.add('label');
    divLabel.textContent = label;
    divLabels.append(divLabel);
  }
}
async function fillTeam(divArena, slot, arena, oldArena) {
  const spnName = divArena.querySelector(`.name.${slot}`);
  const imgUnit = divArena.querySelector(`.unit.${slot}`);

  /*
   * My team, if present, must be on bottom else the creator team must be on top.
   */
  const oldTeam = oldArena && (() => {
    const myIndex = oldArena.teams.findIndex(t => t?.playerId === myPlayerId);
    const creatorIndex = oldArena.teams.findIndex(t => t?.playerId === oldArena.createdBy);
    const topIndex = myIndex > -1 ? (myIndex + oldArena.teams.length/2) % oldArena.teams.length : creatorIndex;
    const indexMap = new Map([ [ 'top',0 ], [ 'btm',1 ] ]);
    const teamIndex = (topIndex + indexMap.get(slot)) % oldArena.teams.length;

    return oldArena.teams[teamIndex];
  })();
  const newTeam = arena && (() => {
    const myIndex = arena.teams.findIndex(t => t?.playerId === myPlayerId);
    const creatorIndex = arena.teams.findIndex(t => t?.playerId === arena.createdBy);
    const topIndex = myIndex > -1 ? (myIndex + arena.teams.length/2) % arena.teams.length : creatorIndex;
    const indexMap = new Map([ [ 'top',0 ], [ 'btm',1 ] ]);
    const teamIndex = (topIndex + indexMap.get(slot)) % arena.teams.length;

    const team = arena.teams[teamIndex];
    if (team?.joinedAt)
      team.isLoser = ![ undefined, teamIndex ].includes(arena.winnerId);
    else
      return null;
    return team;
  })();

  if (oldTeam && newTeam) {
    if (
      oldTeam.playerId === newTeam.playerId &&
      oldTeam.name === newTeam.name &&
      /*
      oldTeam.avatar === newTeam.avatar &&
      oldTeam.color === newTeam.color &&
      */
      imgUnit.classList.contains('loser') === newTeam.isLoser
    ) return false;
  }

  if (oldTeam) {
    await whenTransitionEnds(spnName, () => {
      spnName.classList.remove('show');
      imgUnit.classList.remove('show');
    });
  }

  if (newTeam) {
    const avatar = getAvatar(newTeam.playerId, { direction:slot === 'top' ? 'S' : 'N' });
    spnName.textContent = newTeam.name;
    imgUnit.classList.toggle('loser', newTeam.isLoser);
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
    const lobbyGame = Array.from(state.tabContent.yourGames.games[4].values()).find(gs => !!gs.startedAt);
    divArena.classList.toggle('disabled', !!lobbyGame);
    return false;
  }

  const oldArena = arenaGameSummary.get(divArena);

  arenaGameSummary.delete(divArena);
  divArena.classList.remove('waiting');
  divArena.classList.remove('active');
  divArena.classList.remove('complete');
  divArena.classList.add('empty');

  divArena.querySelector('.labels').innerHTML = '';

  return Promise.all([
    fillTeam(divArena, 'top', null, oldArena),
    fillTeam(divArena, 'btm', null, oldArena),
  ]);
}

async function renderYourGames() {
  const tabContent = state.tabContent.yourGames;
  const divTabContent = document.querySelector('.tabContent .yourGames');
  const childNodes = [];

  const now = gameClient.serverNow;
  const challenges = Array.from(tabContent.games[0].values());
  const waitingGames = Array.from(tabContent.games[1].values());
  const activeGames = Array.from(tabContent.games[2].values())
    .map(gs => {
      gs.turnTimeRemaining = gs.getTurnTimeRemaining(now);

      return gs;
    })
    .sort((a, b) => {
      if (a.timeLimitName && !b.timeLimitName)
        return -1;
      else if (!a.timeLimitName && b.timeLimitName)
        return 1;
      else if (!a.timeLimitName && !b.timeLimitName)
        return b.updatedAt - a.updatedAt;

      return a.turnTimeRemaining - b.turnTimeRemaining;
    });
  const completeGames = Array.from(tabContent.games[3].values());
  const lobbyGames = Array.from(tabContent.games[4].values())
    .map(gs => {
      if (gs.startedAt)
        gs.turnTimeRemaining = gs.getTurnTimeRemaining(now);

      return gs;
    });

  await fetchAvatars(
    tabContent.games
      .map(gsm => Array.from(gsm.values())
        .map(g => g.teams.filter(t => t && t.playerId)
          .map(t => t.playerId))).flat(3)
  );

  const header = document.createElement('HEADER');
  header.addEventListener('mouseenter', event => {
    if (event.target.tagName === 'BUTTON')
      avatars.getSound('focus').howl.play();
  }, true);
  header.addEventListener('click', event => {
    if (event.target.tagName === 'BUTTON')
      avatars.getSound('select').howl.play();
  }, true);
  childNodes.push(header);

  const spnLabel = document.createElement('SPAN');
  spnLabel.textContent = 'Your Games';
  header.appendChild(spnLabel);

  /*
   * Active Lobby Game
   */
  const activeLobbyGame = lobbyGames.find(gs => !!gs.startedAt);
  if (activeLobbyGame) {
    const secLobbyGames = document.createElement('SECTION');
    secLobbyGames.classList.add('game-list');
    childNodes.push(secLobbyGames);

    const header = document.createElement('HEADER');
    header.innerHTML = '<SPAN class="left">Active Lobby Game</SPAN>';
    secLobbyGames.append(header);

    secLobbyGames.appendChild(renderGame(activeLobbyGame, authClient.playerId));
  }

  /*
   * Your Turn!
   */
  const divMyTurnGames = [];
  for (const game of activeGames) {
    // Exclude games where it is someone else's turn
    if (game.currentTeam.playerId !== myPlayerId)
      continue;
    // Exclude games where it is my turn, but it ended
    if (game.turnEndedAt)
      continue;
    // Exclude single player games
    if (game.isSimulation)
      continue;

    const divGame = renderGame(game, authClient.playerId);

    divMyTurnGames.push(divGame);
  }

  if (divMyTurnGames.length) {
    const secMyTurnGames = document.createElement('SECTION');
    secMyTurnGames.classList.add('game-list');
    childNodes.push(secMyTurnGames);

    const header = document.createElement('HEADER');
    header.innerHTML = '<SPAN class="left">Your Turn!</SPAN>';
    secMyTurnGames.append(header);

    divMyTurnGames.forEach(div => secMyTurnGames.appendChild(div));
  }

  /*
   * Challenges
   */
  const divChallenges = [];
  for (const game of challenges) {
    const divGame = renderGame(game, authClient.playerId);

    divChallenges.push(divGame);
  }

  if (divChallenges.length) {
    const secChallengeGames = document.createElement('SECTION');
    secChallengeGames.classList.add('game-list');
    childNodes.push(secChallengeGames);

    const header = document.createElement('HEADER');
    header.innerHTML = '<SPAN class="left">Challenges</SPAN>';
    secChallengeGames.append(header);

    divChallenges.forEach(div => secChallengeGames.appendChild(div));
  }

  /*
   * Their Turn
   */
  const divTheirTurnGames = [];
  for (const game of activeGames) {
    // Exclude games where it is my turn and the turn hasn't ended
    if (game.currentTeam.playerId === myPlayerId && !game.turnEndedAt)
      continue;
    // Exclude single player games
    if (game.isSimulation)
      continue;

    const divGame = renderGame(game, authClient.playerId);

    divTheirTurnGames.push(divGame);
  }

  if (divTheirTurnGames.length) {
    const secTheirTurnGames = document.createElement('SECTION');
    secTheirTurnGames.classList.add('game-list');
    childNodes.push(secTheirTurnGames);

    const header = document.createElement('HEADER');
    header.innerHTML = '<SPAN class="left">Their Turn</SPAN>';
    secTheirTurnGames.append(header);

    divTheirTurnGames.forEach(div => secTheirTurnGames.appendChild(div));
  }

  /*
   * Single Player Games
   */
  const divSinglePlayerGames = [];
  for (const game of [ ...waitingGames, ...activeGames ]) {
    if (!game.isSimulation)
      continue;

    const divGame = renderGame(game, authClient.playerId);

    divSinglePlayerGames.push(divGame);
  }

  if (divSinglePlayerGames.length) {
    const secSinglePlayerGames = document.createElement('SECTION');
    secSinglePlayerGames.classList.add('game-list');
    childNodes.push(secSinglePlayerGames);

    const header = document.createElement('HEADER');
    header.innerHTML = '<SPAN class="left">Single Player Games</SPAN>';
    secSinglePlayerGames.append(header);

    divSinglePlayerGames.forEach(div => secSinglePlayerGames.appendChild(div));
  }

  /*
   * Waiting for Opponent
   */
  const divWaitingGames = [];
  for (const game of [ ...lobbyGames, ...waitingGames ]) {
    if (game.isSimulation)
      continue;
    if (game.startedAt)
      continue;

    const divGame = renderGame(game, authClient.playerId);

    divWaitingGames.push(divGame);
  }

  if (divWaitingGames.length) {
    const secWaitingGames = document.createElement('SECTION');
    secWaitingGames.classList.add('game-list');
    childNodes.push(secWaitingGames);

    const header = document.createElement('HEADER');
    header.innerHTML = '<SPAN class="left">Waiting for Opponent</SPAN>';
    secWaitingGames.append(header);

    divWaitingGames.forEach(div => secWaitingGames.appendChild(div));
  }

  /*
   * Complete Games
   */
  if (completeGames.length) {
    const secCompleteGames = document.createElement('SECTION');
    secCompleteGames.classList.add('game-list');
    secCompleteGames.classList.add('show-results');
    childNodes.push(secCompleteGames);

    const header = document.createElement('HEADER');
    header.innerHTML = '<SPAN class="left">Complete Games</SPAN>';
    secCompleteGames.append(header);

    completeGames.forEach(game => secCompleteGames.appendChild(renderGame(game, authClient.playerId)));
  }

  divTabContent.replaceChildren(...childNodes);
}

async function renderPublicGames() {
  const tabContent = state.tabContent.publicGames;
  const divTabContent = document.querySelector('.tabContent .publicGames');
  divTabContent.innerHTML = '';

  await fetchAvatars(
    tabContent.games
      .map(gsm => Array.from(gsm.values())
        .map(g => g.teams.filter(t => t && t.playerId)
          .map(t => t.playerId))).flat(3)
  );

  const waitingGames = [ ...tabContent.games[0].values() ];
  const activeGames = [ ...tabContent.games[1].values() ];
  const completeGames = [ ...tabContent.games[2].values() ];

  const header = document.createElement('HEADER');
  header.addEventListener('mouseenter', event => {
    if (event.target.tagName === 'BUTTON')
      avatars.getSound('focus').howl.play();
  }, true);
  header.addEventListener('click', event => {
    if (event.target.tagName === 'BUTTON')
      avatars.getSound('select').howl.play();
  }, true);
  divTabContent.append(header);

  const spnLabel = document.createElement('SPAN');
  spnLabel.textContent = 'Public Games';
  header.appendChild(spnLabel);

  const divControls = document.createElement('DIV');
  divControls.classList.add('controls');
  header.appendChild(divControls);

  const btnSettings = document.createElement('BUTTON');
  btnSettings.classList.add('fa');
  btnSettings.classList.add('fa-cog');
  btnSettings.name = 'settings';
  btnSettings.title = 'Settings';
  btnSettings.addEventListener('click', async event => {
    await configureGame.setGameType(null);
    configureGame.show('configurePublic');
  });
  divControls.appendChild(btnSettings);

  /*
   * Waiting for Opponent
   */
  if (waitingGames.length) {
    const secWaitingGames = document.createElement('SECTION');
    secWaitingGames.classList.add('game-list');
    divTabContent.appendChild(secWaitingGames);

    const header = document.createElement('HEADER');
    header.innerHTML = '<SPAN class="left">Waiting for Opponent</SPAN>';
    secWaitingGames.append(header);

    waitingGames.forEach(game => secWaitingGames.appendChild(renderGame(game)));
  }

  /*
   * Active Games
   */
  if (activeGames.length) {
    const secActiveGames = document.createElement('SECTION');
    secActiveGames.classList.add('game-list');
    divTabContent.appendChild(secActiveGames);

    const header = document.createElement('HEADER');
    header.innerHTML = '<SPAN class="left">Active Games</SPAN>';
    secActiveGames.append(header);

    activeGames.forEach(game => secActiveGames.appendChild(renderGame(game)));
  }

  /*
   * Complete Games
   */
  if (completeGames.length) {
    const secCompleteGames = document.createElement('SECTION');
    secCompleteGames.classList.add('game-list');
    divTabContent.appendChild(secCompleteGames);

    const header = document.createElement('HEADER');
    header.innerHTML = [
      `<SPAN class="left">Complete Games</SPAN>`,
      `<SPAN class="right"></SPAN>`,
    ].join('');
    header.querySelector('.right').append(renderShowResults());
    secCompleteGames.append(header);

    completeGames.forEach(game => secCompleteGames.appendChild(renderGame(game)));
  }
}

function initializeRankingsPage(className, crumbs) {
  const header = document.querySelector('.tabContent .rankings HEADER');
  header.innerHTML = '';

  const spnLeft = document.createElement('SPAN');
  spnLeft.classList.add('left');
  spnLeft.innerHTML = crumbs.join('');
  header.append(spnLeft);

  const spnRight = document.createElement('SPAN');
  spnRight.classList.add('right');
  header.append(spnRight);

  const defaultBookmark = '#rankings/FORTE';
  const btnBookmark = document.createElement('BUTTON');
  btnBookmark.classList.add('bookmark');
  btnBookmark.classList.add('fa');
  btnBookmark.classList.toggle('selected', location.hash === config.getItem('rankingsBookmark', defaultBookmark));
  btnBookmark.disabled = location.hash === defaultBookmark && btnBookmark.classList.contains('selected');
  btnBookmark.title = 'Bookmark';
  btnBookmark.addEventListener('click', event => {
    if (btnBookmark.classList.toggle('selected'))
      config.setItem('rankingsBookmark', location.hash);
    else
      config.removeItem('rankingsBookmark');
    btnBookmark.disabled = location.hash === defaultBookmark && btnBookmark.classList.contains('selected');
  });
  spnRight.append(btnBookmark);

  const divContent = document.querySelector('.tabContent .rankings .content');
  divContent.className = `content ${className}`;
  divContent.innerHTML = '';

  return divContent;
}
async function renderRankingPageNotFound() {
  const divContent = initializeRankingsPage('rankings', [
    `<SPAN>Rankings</SPAN>`,
  ]);

  divContent.innerHTML = 'Page does not exist!';
}
async function renderRankings() {
  const tabState = state.tabContent.rankings;
  const [ favoritePlayers, rankings ] = tabState.data;
  const divContent = initializeRankingsPage('rankings', [
    `<SPAN>Rankings</SPAN>`,
  ]);

  const secFavorites = document.createElement('SECTION');
  divContent.append(secFavorites);

  const hdrSearch = document.createElement('HEADER');
  hdrSearch.innerHTML = `
    <SPAN class="left">Player Favorites</SPAN>
    <SPAN class="right">
      <A href="#rankings/${authClient.playerId}/FORTE">Show My Ranks</A>
    </SPAN>
  `;
  secFavorites.append(hdrSearch);

  const divSearch = document.createElement('DIV');
  divSearch.classList.add('search');
  secFavorites.append(divSearch);

  const spnSearch = document.createElement('SPAN');
  spnSearch.classList.add('label');
  spnSearch.textContent = 'Player Search:';
  divSearch.append(spnSearch);

  const txtSearch = document.createElement('INPUT');
  txtSearch.setAttribute('type', 'text');
  txtSearch.setAttribute('autocapitalize', 'none');
  txtSearch.setAttribute('autocomplete', 'off');
  txtSearch.setAttribute('autocorrect', 'off');
  txtSearch.setAttribute('spellcheck', 'false');
  txtSearch.setAttribute('maxLength', '20');
  txtSearch.setAttribute('placeholder', 'Enter name...');
  txtSearch.addEventListener('focus', event => event.target.select());
  divSearch.append(txtSearch);

  const divMatches = document.createElement('DIV');
  divMatches.classList.add('matches');
  secFavorites.append(divMatches);

  txtSearch.addEventListener('input', event => {
    clearTimeout(tabState.searchTimeout);

    if (txtSearch.value === '') {
      divMatches.innerHTML = '';
      return;
    }

    tabState.searchTimeout = setTimeout(async () => {
      const value = txtSearch.value;
      const matches = await authClient.queryRatedPlayers(value);
      if (txtSearch.value !== value)
        return;
      if (matches.length === 0) {
        divMatches.innerHTML = 'No matches.';
        return;
      }

      divMatches.innerHTML = '';

      for (const match of matches) {
        const favorite = favoritePlayers.find(fp => fp.identityId === match.identityId) ?? {
          ...match,
          type: 'favorite',
          active: false,
        };

        const divMatch = document.createElement('DIV');
        divMatch.classList.add('match');
        divMatch.classList.toggle('selected', favorite.active);
        divMatch.dataset.identityId = favorite.identityId;
        divMatch.dataset.json = JSON.stringify(favorite);
        divMatches.append(divMatch);

        const showText = match.text !== undefined && match.text.toLowerCase() !== match.name.toLowerCase();

        const spnIdentity = document.createElement('SPAN');
        spnIdentity.classList.add('identity');
        spnIdentity.classList.toggle('friend', favorite.type === 'friend');
        spnIdentity.title = 'View Player Ranking';
        spnIdentity.innerHTML = [
          `<SPAN class="name">${match.name}</SPAN>`,
          !showText ? '' : `<SPAN class="text">${match.text}</SPAN>`,
        ].join('');
        divMatch.append(spnIdentity);

        const spnAdd = document.createElement('SPAN');
        spnAdd.classList.add('add');
        spnAdd.title = favorite.active ? 'Saved to List' : 'Save to List';
        divMatch.append(spnAdd);
      }
    }, 300);
  });

  const divFavorites = document.createElement('DIV');
  divFavorites.classList.add('favorites');
  secFavorites.append(divFavorites);

  for (const favorite of favoritePlayers.filter(fp => fp.active))
    divFavorites.append(renderRankingsFavorite(favorite));

  secFavorites.addEventListener('click', event => {
    const favorites = config.getItem('favoritePlayers', {});
    const divPlayer = event.target.closest('.match, .favorite');
    if (!divPlayer)
      return;

    const data = JSON.parse(divPlayer.dataset.json);

    if (event.target.closest('.identity'))
      location.href = `#rankings/${data.playerId}/FORTE`;
    else if (event.target.closest('.add:not(.selected)')) {
      favorites[data.identityId] = data.active = true;
      const favoriteIndex = favoritePlayers.findIndex(fp => fp.identityId === data.identityId);
      if (favoriteIndex > -1)
        favoritePlayers[favoriteIndex] = data;
      else
        favoritePlayers.push(data);
      config.setItem('favoritePlayers', favorites);

      divPlayer.classList.add('selected');
      divFavorites.append(renderRankingsFavorite(data));
    } else if (event.target.closest('.remove')) {
      const favoriteIndex = favoritePlayers.findIndex(fp => fp.identityId === data.identityId);
      if (data.type === 'friend') {
        favorites[data.identityId] = false;
        favoritePlayers[favoriteIndex].active = false;
      } else {
        delete favorites[data.identityId];
        favoritePlayers.splice(favoriteIndex, 1, 0);
      }
      config.setItem('favoritePlayers', favorites);

      divMatches.querySelector(`.match[data-identity-id="${data.identityId}"]`)?.classList.remove('selected');
      divPlayer.remove();
    }
  });

  const secRankings = document.createElement('SECTION');
  secRankings.classList.add('rankings-list');
  divContent.append(secRankings);

  const hdrRankings = document.createElement('HEADER');
  if (rankings.length > 1) {
    hdrRankings.innerHTML = `
      <DIV class="caption"><A href="#rankings/topranks">Show All Top Ranks</A></DIV>
      <DIV class="playerCount">Player Count</DIV>
    `;
  } else {
    hdrRankings.innerHTML = `
      <DIV class="caption">Rankings</DIV>
      <DIV class="playerCount">Player Count</DIV>
    `;
  }
  secRankings.append(hdrRankings);

  const divBody = document.createElement('DIV');
  divBody.classList.add('body');
  divBody.addEventListener('click', event => {
    const divRanking = event.target.closest('.ranking');
    if (!divRanking) return;
    location.hash = `#rankings/${divRanking.dataset.rankingId}`;
  });

  for (const rankingId of [ 'FORTE', ...state.styles.map(s => s.id) ]) {
    const ranking = rankings.find(r => r.id === rankingId);
    if (!ranking)
      continue;

    const name = rankingId === 'FORTE' ? 'Forte' : state.styles.find(s => s.id === rankingId).name;
    const divRanking = document.createElement('DIV');
    divRanking.classList.add('ranking');
    divRanking.dataset.rankingId = rankingId;
    divRanking.innerHTML = [
      `<DIV class="name">${name}</DIV>`,
      `<DIV class="playerCount">${ranking.numPlayers}</DIV>`,
    ].join('');
    divBody.append(divRanking);
  }

  secRankings.append(divBody);
}
function renderRankingsFavorite(favorite) {
  const divFavorite = document.createElement('DIV');
  divFavorite.classList.add('favorite');
  divFavorite.dataset.json = JSON.stringify(favorite);

  const showNickname = favorite.nickname !== undefined && favorite.nickname.toLowerCase() !== favorite.name.toLowerCase();

  const spnIdentity = document.createElement('SPAN');
  spnIdentity.classList.add('identity');
  spnIdentity.classList.toggle('friend', favorite.type === 'friend');
  spnIdentity.title = 'View Player Ranking';
  spnIdentity.innerHTML = [
    `<SPAN class="name">${favorite.name}</SPAN>`,
    !showNickname ? '' : `<SPAN class="nickname">${favorite.nickname}</SPAN>`,
  ].join('');
  divFavorite.append(spnIdentity);

  const spnRemove = document.createElement('SPAN');
  spnRemove.classList.add('remove');
  spnRemove.title = 'Remove from List';
  divFavorite.append(spnRemove);

  return divFavorite;
}
async function renderTopRanks() {
  const topranks = state.tabContent.rankings.data;
  const divContent = initializeRankingsPage('topranks', [
    `<SPAN><A href="#rankings">Rankings</A></SPAN>`,
    '<SPAN class="sep"></SPAN>',
    `<SPAN>All Top Ranks</SPAN>`,
  ]);

  await fetchAvatars(Array.from(topranks.values()).map(rs => rs.map(r => r.playerId)).flat());

  for (const rankingId of [ 'FORTE', ...state.styles.map(s => s.id) ]) {
    if (!topranks.has(rankingId))
      continue;

    const divRanks = renderRanks(rankingId, topranks.get(rankingId));
    divContent.append(divRanks);
  }
}
async function renderRankingSummary(rankingId) {
  const [ topranks, games ] = state.tabContent.rankings.data;
  const name = rankingId === 'FORTE' ? 'Forte' : state.styles.find(s => s.id === rankingId).name;
  const divNotice = document.querySelector('.tabContent .rankings .notice');
  const divContent = initializeRankingsPage('ranking-summary', [
    `<SPAN><A href="#rankings">Rankings</A></SPAN>`,
    '<SPAN class="sep"></SPAN>',
    `<SPAN>${name}</SPAN>`,
  ]);

  if (!authClient.isVerified)
    divNotice.style.display = '';

  await fetchAvatars([
    ...topranks.map(r => r.playerId),
    ...games.map(g => g.teams.map(t => t.playerId)).flat(),
  ]);

  const secRanks = renderRanks(rankingId, topranks);
  divContent.append(secRanks);

  const divCaption = secRanks.querySelector('HEADER .caption');
  if (topranks.length > 2) {
    divCaption.innerHTML = `<A href="#rankings/${rankingId}/all">Show All Ranks</A>`;
  } else {
    divCaption.innerHTML = `Ranks`;
  }

  const secRatedGames = renderRatedGames(games, rankingId);
  divContent.append(secRatedGames);
}
async function renderRanking(rankingId) {
  const ranks = state.tabContent.rankings.data;
  const name = rankingId === 'FORTE' ? 'Forte' : state.styles.find(s => s.id === rankingId).name;
  const divContent = initializeRankingsPage('ranking', [
    `<SPAN><A href="#rankings">Rankings</A></SPAN>`,
    '<SPAN class="sep"></SPAN>',
    `<SPAN><A href="#rankings/${rankingId}">${name}</A></SPAN>`,
    '<SPAN class="sep"></SPAN>',
    '<SPAN>All Ranks</SPAN>',
  ]);

  await fetchAvatars(ranks.map(r => r.playerId));

  const divRanks = renderRanks(rankingId, ranks);
  const divCaption = divRanks.querySelector('HEADER .caption');

  const yourRank = ranks.findIndex(r => r.playerId === authClient.playerId);
  if (yourRank > -1)
    divCaption.innerHTML = `Your Rank: <SPAN class="rankNum">#${ yourRank + 1 }</SPAN>`;
  else
    divCaption.innerHTML = `Your Rank: None`;

  divContent.append(divRanks);
}
async function renderPlayerRankingSummary(rankingId, playerId) {
  const [ player, ranks, games ] = state.tabContent.rankings.data;
  const name = rankingId === 'FORTE' ? 'Forte' : state.styles.find(s => s.id === rankingId)?.name ?? rankingId;
  const divContent = initializeRankingsPage('player-summary', [
    `<SPAN><A href="#rankings">Rankings</A></SPAN>`,
    '<SPAN class="sep"></SPAN>',
    `<SPAN><A href="#rankings/${rankingId}">${name}</A></SPAN>`,
  ]);

  if (!ranks) {
    divContent.innerHTML = 'Either the player is not rated, inactive, or does not exist.';
    return;
  }

  await fetchAvatars([ playerId, ...games.map(g => g.teams.map(t => t.playerId)).flat() ]);

  const divPlayer = document.createElement('DIV');
  divPlayer.classList.add('player');
  divContent.append(divPlayer);

  const divAvatarBadge = document.createElement('DIV');
  divAvatarBadge.classList.add('avatar-badge');
  divPlayer.append(divAvatarBadge);

  if (playerId !== authClient.playerId) {
    const aChallenge = document.createElement('A');
    aChallenge.href = 'javascript:void(0)';
    aChallenge.classList.add('button');
    aChallenge.textContent = 'Challenge!';
    aChallenge.addEventListener('click', async event => {
      await configureGame.setGameType(rankingId === 'FORTE' ? null : rankingId);
      configureGame.show('challenge', { challengee:playerId });
    });

    const divChallenge = document.createElement('DIV');
    divChallenge.classList.add('challenge');
    divChallenge.append(aChallenge);
    divPlayer.append(divChallenge);
  }

  const divAvatarImage = document.createElement('DIV');
  divAvatarImage.classList.add('image');
  divAvatarBadge.append(divAvatarImage);

  const avatar = getAvatar(playerId);
  const translateX = 40 + avatar.x - 4;
  const translateY = avatar.y < -60 ? avatar.y + 60 : Math.max(0, avatar.y + 52);
  const imgAvatar = document.createElement('IMG');
  imgAvatar.style.transformOrigin = `${-avatar.x}px ${-avatar.y}px`;
  imgAvatar.style.transform = `translate(${translateX}px, ${translateY}px)`;
  imgAvatar.src = avatar.src;
  divAvatarImage.append(imgAvatar);

  const divPlayerName = document.createElement('DIV');
  divPlayerName.classList.add('name');
  divPlayerName.textContent = player.name;
  divPlayer.append(divPlayerName);

  const divRanks = document.createElement('DIV');
  divRanks.classList.add('ranks');
  divPlayer.append(divRanks);

  if (!ranks.some(r => r.rankingId === rankingId))
    ranks.push({
      rankingId,
      num: null,
      rating: null,
      gameCount: rankingId !== 'FORTE' ? 0 : ranks.reduce((s,r) => s + r.gameCount, 0),
    });

  let divisor = 1;
  for (const rank of ranks) {
    const rankName = rank.rankingId === 'FORTE' ? 'Forte' : state.styles.find(s => s.id === rank.rankingId)?.name ?? rank.rankingId;
    if (rank.rankingId !== 'FORTE' && rank.gameCount >= 10)
      divisor *= 2;

    const divRank = document.createElement('DIV');
    divRank.classList.add('rank');
    divRank.classList.toggle('show', rank.rankingId === rankingId);

    const html = [];
    if (rank.rankingId === rankingId)
      html.push(`<SPAN class="name">${rankName}</SPAN>`);
    else
      html.push(`<A href="#rankings/${playerId}/${rank.rankingId}" class="name">${rankName}</A>`);

    if (rank.num !== null)
      html.push(
        `<SPAN class="num">#${rank.num}</SPAN>`,
        `<SPAN class="rating">(${rank.rating})</SPAN>`,
      );
    else
      html.push(`<SPAN class="unrated">Unrated</SPAN>`);

    html.push(`<SPAN class="gameCount">${rank.gameCount} Game(s)</SPAN>`);

    if (
      rankingId === 'FORTE' &&
      rank.rankingId !== 'FORTE' &&
      rank.gameCount > 9 &&
      Math.round(rank.rating / divisor) > 0
    )
      html.push(`<SPAN class="forte">+ ${Math.round(rank.rating / divisor)}</SPAN>`);

    divRank.innerHTML = html.join(' ');
    divRanks.append(divRank);
  }

  if (ranks.length > 1) {
    const divShowAll = document.createElement('DIV');
    divShowAll.classList.add('show-all');
    divShowAll.innerHTML = `<A href="javascript:void(0)">Show All Ranks</A>`;
    divShowAll.addEventListener('click', event => {
      if (event.target.tagName === 'A')
        divRanks.classList.add('show-all');
    });
    divRanks.append(divShowAll);
  }

  if (games.length) {
    const secStats = document.createElement('SECTION');
    secStats.classList.add('stats');
    divContent.append(secStats);

    const hdrStats = document.createElement('HEADER');
    hdrStats.innerHTML = `
      <DIV class="left">Statistics</DIV>
    `;
    secStats.append(hdrStats);

    const statsMap = new Map();
    for (const game of games) {
      for (const team of game.teams) {
        if (team.playerId === playerId)
          continue;

        if (!statsMap.has(team.playerId))
          statsMap.set(team.playerId, { playerId:team.playerId, name:team.name, numGames:0, gain:0, loss:0 });

        const myTeam = game.teams.find(t => t.playerId === playerId);
        const result = game.winnerId === myTeam.id ? 'Win' : game.winnerId === team.id ? 'Lose' : 'Draw';
        const teamStats = statsMap.get(team.playerId);
        const myRating = myTeam.ratings.get(game.type);
        const vsRating = team.ratings.get(game.type);
        // Always true unless there is bad data
        if (myRating && vsRating) {
          const ratingChange = Math.abs(myRating[1] - myRating[0]);
          const ratingDiff = myRating[0] - vsRating[0];
          if (myRating[1] > myRating[0])
            teamStats.gain += ratingChange;
          else
            teamStats.loss += ratingChange;
          if (result === 'Win' && (!teamStats.win || ratingDiff < teamStats.win.diff))
            teamStats.win = { game, name:team.name, gain:ratingChange, diff:ratingDiff };
          else if (result === 'Lose' && (!teamStats.lose || ratingDiff > teamStats.lose.diff))
            teamStats.lose = { game, name:team.name, loss:ratingChange, diff:ratingDiff };
        }
        teamStats.numGames++;
      }
    }

    const stats = Array.from(statsMap.values());
    const gf = stats.sort((a,b) => (a.gain - a.loss) - (b.gain - b.loss) || b.numGames - a.numGames)[0];
    const ff = stats.sort((a,b) => (b.gain - b.loss) - (a.gain - a.loss) || b.numGames - a.numGames)[0];
    const wd = stats.filter(s => !!s.lose).sort((a,b) => b.lose.diff - a.lose.diff)[0];
    const bv = stats.filter(s => !!s.win).sort((a,b) => a.win.diff - b.win.diff)[0];

    const divStats = document.createElement('DIV');
    secStats.append(divStats);

    if (gf.loss > gf.gain) {
      const divGF = document.createElement('DIV');
      const playerLink = `<A href="#rankings/${gf.playerId}/${rankingId}">${gf.name}</A>`;
      const info = [
        `${gf.numGames} game(s)`,
        `+${Math.round(gf.gain)} rating`,
        `−${Math.round(gf.loss)} rating`,
      ].join(', ');
      divGF.innerHTML = `
        <DIV>Greatest Fear:</DIV>
        <DIV>
          <DIV>${playerLink}</DIV>
          <DIV>${info}</DIV>
        </DIV>
      `;
      divStats.append(divGF);
    }

    if (ff.gain > ff.loss) {
      const divFF = document.createElement('DIV');
      const playerLink = `<A href="#rankings/${ff.playerId}/${rankingId}">${ff.name}</A>`;
      const info = [
        `${ff.numGames} game(s)`,
        `+${Math.round(ff.gain)} rating`,
        `−${Math.round(ff.loss)} rating`,
      ].join(', ');
      divFF.innerHTML = `
        <DIV>Favorite Food:</DIV>
        <DIV>
          <DIV>${playerLink}</DIV>
          <DIV>${info}</DIV>
        </DIV>
      `;
      divStats.append(divFF);
    }

    if (wd && wd.lose.diff >= 0 && wd.lose.loss > 0) {
      const divWD = document.createElement('DIV');
      const playerLink = `<A href="#rankings/${wd.playerId}/${rankingId}">${wd.name}</A>`;
      const gameLink = `<A href="/game.html?${wd.lose.game.id}" target="_blank">Watch!</A>`;
      const info = [
        `−${Math.round(wd.lose.loss)} rating`,
        `had +${Math.round(wd.lose.diff)} rating`,
      ].join(', ');
      divWD.innerHTML = `
        <DIV>Worst Defeat:</DIV>
        <DIV>
          <DIV class="links">${playerLink} • ${gameLink} • </DIV>
          <DIV class="info">${info}</DIV>
        </DIV>
      `;
      divWD.querySelector('.links').append(renderDuration(wd.lose.game.currentTurnId));
      divWD.querySelector('.links').append(renderClock(wd.lose.game.endedAt, 'Ended At'));
      divStats.append(divWD);
    }

    if (bv && bv.win.diff <= 0 && bv.win.gain > 0) {
      const divBV = document.createElement('DIV');
      const playerLink = `<A href="#rankings/${bv.playerId}/${rankingId}">${bv.name}</A>`;
      const gameLink = `<A href="/game.html?${bv.win.game.id}" target="_blank">Watch!</A>`;
      const info = [
        `+${Math.round(bv.win.gain)} rating`,
        `had −${Math.abs(Math.round(bv.win.diff))} rating`,
      ].join(', ');
      divBV.innerHTML = `
        <DIV>Best Victory:</DIV>
        <DIV>
          <DIV class="links">${playerLink} • ${gameLink} • </DIV>
          <DIV class="info">${info}</DIV>
        </DIV>
      `;
      divBV.querySelector('.links').append(renderDuration(bv.win.game.currentTurnId));
      divBV.querySelector('.links').append(renderClock(bv.win.game.endedAt, 'Ended At'));
      divStats.append(divBV);
    }
  }

  const secRatedGames = await renderRatedGames(games, rankingId, playerId);
  divContent.append(secRatedGames);
}
function renderRanks(rankingId, ranks) {
  const rankingName = rankingId === 'FORTE' ? 'Forte' : state.styles.find(s => s.id === rankingId).name;

  const secRanks = document.createElement('SECTION');
  secRanks.classList.add('ranks');

  const hdrRanks = document.createElement('HEADER');
  hdrRanks.innerHTML = `
    <DIV class="caption"><A href="#rankings/${rankingId}/all">${rankingName}</A></DIV>
    <DIV class="gameCount">Game Count</DIV>
    <DIV class="rank">Rank</DIV>
  `;
  secRanks.append(hdrRanks);

  const divBody = document.createElement('DIV');
  divBody.classList.add('body');
  divBody.addEventListener('click', event => {
    const divRank = event.target.closest('.rank');
    if (!divRank) return;
    location.hash = `#rankings/${divRank.dataset.playerId}/${rankingId}`;
  });

  for (const [ r, rank ] of ranks.entries()) {
    rank.num ??= r + 1;

    if (r > 0 && ranks[r-1].num < (rank.num - 1)) {
      const divBreak = document.createElement('DIV');
      divBreak.classList.add('break');
      divBody.append(divBreak);
    }

    divBody.append(renderRank(rankingId, rank));
  }

  secRanks.append(divBody);

  return secRanks;
}
function renderRank(rankingId, rank) {
  const divRank = document.createElement('DIV');
  divRank.classList.add('rank');
  divRank.dataset.playerId = rank.playerId;

  const divAvatarContainer = document.createElement('DIV');
  divAvatarContainer.classList.add('avatar');
  divRank.append(divAvatarContainer);

  const divAvatarWrapper = document.createElement('DIV');
  divAvatarContainer.append(divAvatarWrapper);

  const avatar = getAvatar(rank.playerId, { withFocus:true });
  const imgAvatar = document.createElement('IMG');
  const originY = avatar.y - 22;
  imgAvatar.style.transformOrigin = `${-avatar.x}px ${-originY}px`;
  imgAvatar.style.transform = `translate(${avatar.x}px, ${originY}px) scale(0.6)`;
  imgAvatar.style.top = (avatar.y > -72 ? -(avatar.y + 72) * 0.6 / 2 : 0) + 'px';
  imgAvatar.src = avatar.src;
  divAvatarWrapper.append(imgAvatar);

  const divName = document.createElement('DIV');
  divName.classList.add('name');
  divName.innerHTML = `
    <DIV>${rank.name}</DIV>
    <DIV>(${rank.rating})</DIV>
  `;
  divRank.append(divName);

  const divGameCount = document.createElement('DIV');
  divGameCount.classList.add('gameCount');
  divGameCount.textContent = rank.gameCount;
  divRank.append(divGameCount);

  const divRankNum = document.createElement('DIV');
  divRankNum.classList.add('rankNum');
  divRankNum.textContent = `#${ rank.num }`;
  divRank.append(divRankNum);

  return divRank;
}
function renderRatedGames(games, rankingId, playerId = null) {
  const rankingName = rankingId === 'FORTE' ? 'Forte' : state.styles.find(s => s.id === rankingId).name;

  const secRatedGames = document.createElement('SECTION');
  secRatedGames.classList.add('game-list');

  const hdrRatedGames = document.createElement('HEADER');
  hdrRatedGames.innerHTML = `
    <DIV class="left">
      ${rankingName} Games
    </DIV>
    <DIV class="right">
    </DIV>
  `;
  hdrRatedGames.querySelector('.right').append(renderShowResults());
  secRatedGames.append(hdrRatedGames);

  const divBody = document.createElement('DIV');
  divBody.classList.add('body');

  for (const game of games)
    divBody.append(renderGame(game, playerId, rankingId));

  secRatedGames.append(divBody);

  return secRatedGames;
}
function renderShowResults() {
  const label = document.createElement('LABEL');
  label.classList.add('show-results');
  label.innerHTML = `
    Show Results
    <INPUT type="checkbox" />
  `;
  label.addEventListener('change', event => {
    avatars.getSound('select').howl.play();

    const divGameList = event.target.closest('.game-list');
    divGameList.classList.toggle('show-results', event.target.checked);
  });

  return label;
}
function renderGame(game, playerId = null, rankingId = null) {
  const team1 = game.teams.find(t => t?.playerId === (playerId ?? game.createdBy));
  const ranks1 = game.meta.ranks[team1.id];
  const team2 = game.teams.find(t => t !== team1);
  const ranks2 = team2 && game.meta.ranks[team2.id];

  rankingId ??= game.type;

  const divGame = document.createElement('DIV');
  divGame.id = game.id;
  divGame.classList.add('game');

  const divVS = document.createElement('DIV');
  divVS.classList.add('vs');

  const divArenaWrapper = document.createElement('DIV');
  divArenaWrapper.classList.add('arena-wrapper');

  const divArena = renderArena(0);
  divArenaWrapper.append(divArena);
  fillArena(divArena, game);

  divVS.append(divArenaWrapper);
  if (game.isChallenge && !team1.joinedAt)
    divVS.append(renderGameDecline(game));
  else
    divVS.append(renderGameTeam(game, team1, ranks1, rankingId, team1.playerId !== playerId));
  divVS.append(renderGameResult(game, team1.playerId));
  if (game.isSimulation && !game.startedAt)
    divVS.append(renderGameFinishSetup(game));
  else if (team2?.playerId)
    divVS.append(renderGameTeam(game, team2, ranks2, rankingId, team2.playerId !== playerId));
  else if (game.createdBy === authClient.playerId)
    divVS.append(renderGameInvite(game))
  divGame.append(divVS);

  divGame.append(renderGameInfo(game));

  return divGame;
}
function renderGameTeam(game, team, ranks, rankingId, linkable = true) {
  const divTeam = document.createElement('DIV');
  divTeam.classList.add('team');
  divTeam.classList.toggle('linkable', linkable && !!ranks);
  divTeam.dataset.playerId = team.playerId;

  const rank = ranks && (ranks.find(r => r.rankingId === rankingId) ?? null);
  const defaultRating = rankingId === 'FORTE' ? 0 : 750;
  const rating = [];

  if (game.rated) {
    const vsRatings = team.ratings.get(rankingId) ?? [ defaultRating, defaultRating ];
    const change = vsRatings[1] - vsRatings[0];
    const label = Math.abs(vsRatings[1] - vsRatings[0]) || '';

    rating.push(`<SPAN class="initial">${vsRatings[0]}</SPAN>`);
    rating.push(`<SPAN class="${label ? change > 0 ? 'up' : 'down' : ''}">${label}</SPAN> `);
  }

  if (ranks === null)
    rating.push(`<SPAN class="current">(Inactive)</SPAN>`);
  else if (ranks === false)
    rating.push(`<SPAN class="current">(Guest)</SPAN>`);
  else if (rank)
    rating.push(`<SPAN class="current">(${rank.rating})</SPAN>`);
  else
    rating.push(`<SPAN class="current">(${defaultRating})</SPAN>`);

  divTeam.innerHTML = `
    <DIV class="name">${team.name}</DIV>
    <DIV class="rating">${rating.join('')}</DIV>
  `;

  return divTeam;
}
function renderGameDecline() {
  const divDecline = document.createElement('DIV');
  divDecline.classList.add('decline');
  divDecline.innerHTML = `<A href="javascript:void(0)">Decline Game</A>`;

  return divDecline;
}
function renderGameFinishSetup(game) {
  const divFinishSetup = document.createElement('DIV');
  divFinishSetup.innerHTML = `<A href="game.html?${game.id}">Finish Setup</A>`;

  return divFinishSetup;
}
function renderGameInvite(game) {
  const divInvite = document.createElement('DIV');
  divInvite.classList.add('invite');
  if (navigator.share) {
    divInvite.classList.add('share');
    divInvite.innerHTML = `<SPAN class="fa fa-share"></SPAN><SPAN class="label">Share Invite Link</SPAN>`;
  } else {
    divInvite.classList.add('copy');
    divInvite.innerHTML = `<SPAN class="fa fa-copy"></SPAN><SPAN class="label">Copy Invite Link</SPAN>`;
  }

  return divInvite;
}
function renderGameResult(game, playerId) {
  const divResult = document.createElement('DIV');
  divResult.classList.add('result');

  const spnResult = document.createElement('SPAN');
  divResult.append(spnResult);

  if (game.endedAt)
    spnResult.textContent = (
      game.winnerId === 'draw' ? 'Draw!' :
      game.winnerId === 'truce' ? 'Truce!' :
      game.winner?.playerId === playerId ? 'Win!' : 'Lose!'
    );
  else
    spnResult.textContent = 'VS';

  return divResult;
}
function renderGameInfo(game) {
  const divInfo = document.createElement('DIV');
  divInfo.classList.add('info');

  const labels = [];
  labels.push(game.typeName);
  if (!game.randomHitChance)
    labels.push('No Luck');
  if (game.timeLimitName && game.timeLimitName !== 'standard')
    labels.push(game.timeLimitName.toUpperCase('first'));

  if (game.isSimulation) {
    if (game.mode === 'fork')
      labels.push(game.mode.toUpperCase('first'));
  } else {
    if (game.mode)
      labels.push(game.mode.toUpperCase('first'));

    const isGuestGame = game.meta.ranks.some(r => r === false);

    if (!game.collection && game.mode !== 'fork')
      labels.push('Private');
    else if (!game.startedAt && game.rated === true)
      labels.push('Rated');
    else if (![ 'fork', 'practice' ].includes(game.mode) && game.rated === false && !isGuestGame)
      labels.push('Unrated');

    if (!game.startedAt && state.currentTab === 'yourGames') {
      const opponent = game.teams.find(t => t?.playerId !== game.createdBy);
      if (!opponent)
        labels.push('Anybody');
      else if (!opponent.playerId)
        labels.push('Share Link');
      else
        labels.push('Challenge');
    }
  }

  const spnLeft = document.createElement('SPAN');
  spnLeft.classList.add('left');
  spnLeft.textContent = labels.join(', ');
  divInfo.append(spnLeft);

  const spnRight = document.createElement('SPAN');
  spnRight.classList.add('right');
  if (game.startedAt)
    spnRight.append(renderDuration(game.currentTurnId));
  divInfo.append(spnRight);

  if (game.endedAt)
    spnRight.append(renderClock(game.endedAt, 'Ended At'));
  else if (game.startedAt && !game.isSimulation) {
    const isParticipant = game.teams.some(t => t.playerId === authClient.playerId);
    if (isParticipant)
      spnRight.append(renderClock(spnClock => {
        const remaining = game.getTurnTimeRemaining();
        if (remaining < (game.currentTurnTimeLimit * 0.2))
          spnClock.classList.add('low');
        return remaining;
      }, 'Time Remaining'));
    else
      spnRight.append(renderClock(game.updatedAt, 'Updated At'));
  } else
    spnRight.append(renderClock(game.createdAt, 'Created At'));

  return divInfo;
}

function renderDuration(numTurns) {
  const spnTurns = document.createElement('SPAN');
  spnTurns.classList.add('duration');
  spnTurns.title = 'Turn Count';

  spnTurns.innerHTML = `
    <SPAN class="numTurns">${numTurns}</SPAN>
    <SPAN class="fa fa-hourglass"></SPAN>
  `;

  return spnTurns;
}
// updator can be a Function or a Date
function renderClock(updator, title = 'Since') {
  const spnClock = document.createElement('SPAN');
  spnClock.classList.add('clock');
  spnClock.title = title;
  spnClock.innerHTML = `
    <SPAN class="elapsed"></SPAN>
    <SPAN class="fa fa-clock"></SPAN>
  `;
  spnClock.update = function () {
    let elapsed = (updator instanceof Function ? updator(spnClock) : gameClient.serverNow - updator) / 1000;
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

    this.querySelector('.elapsed').textContent = elapsed;
    return this;
  };

  return spnClock.update();
}
setInterval(() => {
  for (const spnClock of document.querySelectorAll('.clock'))
    spnClock.update();
}, 30000);

async function openTab() {
  closeTab();

  const tab = location.hash.split('/')[0];

  state.currentTab = 'yourGames';
  if (tab === '#lobby')
    state.currentTab = 'lobby';
  else if (tab === '#publicGames')
    state.currentTab = 'publicGames';
  else if (tab === '#rankings')
    state.currentTab = 'rankings';

  document.querySelector(`.tabs .${state.currentTab}`).classList.add('is-active');

  return syncTab();
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
      if (state.currentTab === 'lobby') {
        gameClient.leaveCollectionGroup(`lobby/${tabContent.selectedStyleId}`);
        tabContent.isSynced = false;
        tabContent.whenSynced = Promise.resolve();
      } else if (state.currentTab === 'publicGames') {
        gameClient.leaveCollectionGroup('public');
        tabContent.isSynced = false;
        tabContent.whenSynced = Promise.resolve();
      }
    }

    tabContent.isOpen = false;
  }

  state.currentTab = null;
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
      await fetchTabData(currentTab);

      // If the tab was changed before fetching completed, abort.
      if (state.currentTab !== currentTab)
        throw 'abort';

      renderStats();
    }

    if (state.currentTab === 'lobby') {
      await renderLobbyGames();

      // If audio isn't enabled, make it enabled with a click.
      if (await state.whenAudioEnabled)
        showLobby();
      else
        showEnterLobby();
    } else {
      if (state.currentTab === 'yourGames')
        await renderYourGames();
      else if (state.currentTab === 'publicGames')
        await renderPublicGames();
      else
        await tabContent.route();

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

async function fetchTabData(tabName) {
  const promises = [];

  const statsContent = state.tabContent.stats;
  if (!statsContent.isSynced) {
    if (statsContent.whenSynced.isFinalized) {
      statsContent.whenSynced = gameClient.joinCollectionStatsGroup({
        filter: { '$.teams[*].playerId': { not:{ includes:myPlayerId } } },
      }).then(rsp => {
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
      { // Incoming Challenges
        filter: {
          createdBy: { not:authClient.playerId },
          startedAt: null,
        },
        sort: { field:'createdAt', order:'asc' },
        limit: 50,
      },
      { // Waiting Games (except Open Lobby Games)
        filter: {
          $: { nested:[
            { collection:{ not:{ startsWith:'lobby/' } } },
            { isChallenge:true },
          ] },
          createdBy: authClient.playerId,
          startedAt: null,
        },
        sort: { field:'updatedAt', order:'desc' },
        limit: 50,
      },
      { // Active Games (except Lobby games)
        filter: {
          collection: { not:{ startsWith:'lobby/' } },
          startedAt: { not:null },
          endedAt: null,
        },
        sort: { field:'updatedAt', order:'desc' },
        limit: 50,
      },
      { // Completed Games
        filter: { endedAt:{ not:null } },
        sort: { field:'updatedAt', order:'desc' },
        limit: 50,
      },
      { // Open and Active Lobby Games
        filter: {
          collection: { startsWith:'lobby/' },
          isChallenge: false,
          endedAt: null,
        },
        sort: { field:'updatedAt', order:'desc' },
        limit: 50,
      },
    ];

    if (yourContent.whenSynced.isFinalized)
      yourContent.whenSynced = gameClient.joinMyGamesGroup({ query }).then(rsp => {
        yourContent.stats = rsp.stats;
        yourContent.games = rsp.results.map(r => new Map(r.hits.map(h => [ h.id, h ])));

        const lobbyGame = rsp.results[4].hits.find(gs => !!gs.startedAt);
        if (lobbyGame)
          setYourLobbyGame(lobbyGame, true);

        yourContent.isSynced = true;
      });
    promises.push(yourContent.whenSynced);
  }

  const tabContent = state.tabContent[tabName];

  if (tabName === 'lobby') {
    const query = [
      {
        filter: {
          '$.teams[*].playerId': { not:{ includes:myPlayerId } },
          startedAt: null,
        },
        sort: { field:'createdAt', order:'asc' },
        limit: 50,
      },
      {
        filter: {
          '$.teams[*].playerId': { not:{ includes:myPlayerId } },
          startedAt: { not:null },
          endedAt: null,
        },
        sort: { field:'startedAt', order:'desc' },
        limit: 50,
      },
      {
        filter: {
          '$.teams[*].playerId': { not:{ includes:myPlayerId } },
          endedAt: { not:null },
        },
        sort: { field:'endedAt', order:'desc' },
        limit: 50,
      },
    ];

    const join = styleId =>
      gameClient.joinCollectionGroup(`lobby/${styleId}`, { query }).then(rsp => {
        tabContent.games = rsp.results.map(r => new Map(r.hits.map(h => [ h.id, h ])));
        tabContent.isSynced = true;

        tabContent.view.gameTypeId = styleId;
        tabContent.view.arenas.fill(null);

        const yourLobbyGames = Array.from(state.tabContent.yourGames.games[4].values());
        const yourLobbyGame = yourLobbyGames.find(gs => gs.collection === `lobby/${styleId}`);
        const games = rsp.results.map(r => r.hits).flat();
        if (yourLobbyGame)
          games.push(yourLobbyGame);

        games.sort((a,b) => a.createdAt - b.createdAt).forEach(gs => placeLobbyGame(gs, true));
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

    // Make sure your lobby games are known before joining lobby collection group
    await yourContent.whenSynced;

    if (tabContent.selectedStyleId === null) {
      const lobbyGame = Array.from(yourContent.games[4].values()).find(gs => !!gs.startedAt);
      const styleId = lobbyGame?.collection.slice(6) ?? configureGame.gameTypeId;
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
          '$.teams[*].playerId': { not:{ includes:myPlayerId } },
          startedAt: null,
        },
        sort: { field:'createdAt', order:'asc' },
        limit: 50,
      },
      {
        filter: {
          '$.teams[*].playerId': { not:{ includes:myPlayerId } },
          startedAt: { not:null },
          endedAt: null
        },
        sort: { field:'updatedAt', order:'desc' },
        limit: 50,
      },
      {
        filter: {
          '$.teams[*].playerId': { not:{ includes:myPlayerId } },
          endedAt: { not:null },
        },
        sort: { field:'endedAt', order:'desc' },
        limit: 50,
      },
    ];

    promises.push(
      gameClient.joinCollectionGroup(`public`, { query }).then(rsp => {
        tabContent.games = rsp.results.map(r => new Map(r.hits.map(h => [ h.id, h ])));
        tabContent.isSynced = true;
      }),
    );
  } else {
    const routePath = location.hash;

    for (const matcher of routeMatcher) {
      const route = matcher(routePath);
      if (route) {
        promises.push(route.data.then(data => {
          tabContent.route = route.route;
          tabContent.data = data;
        }));
        break;
      }
    }
  }

  return Promise.all(promises).catch(error => {
    if (error !== 'Connection reset')
      throw error;

    if (state.currentTab !== tabName)
      return;

    return fetchTabData(tabName);
  });
}

