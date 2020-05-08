import 'plugins/element.js';
import config from 'config/client.js';
import clientFactory from 'client/clientFactory.js';
import popup from 'components/popup.js';
import copy from 'components/copy.js';
import share from 'components/share.js';

// We will be fetching the updates games list from the server on this interval
const GAMES_FETCH_INTERVAL = 5 * 1000;

let authClient = clientFactory('auth');
let gameClient = clientFactory('game');
let myPlayerId = null;
let games = {
  active: new Map(),
  open: new Map(),
  waiting: new Map(),
  complete: new Map(),
};

let pushPublicKey = Uint8Array.from(
  atob(
    config.pushPublicKey
      .replace(/-/g, '+').replace(/_/g, '/')
  ),
  chr => chr.charCodeAt(0),
);

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

  authClient.whenReady.then(() => {
    myPlayerId = authClient.playerId;

    if (myPlayerId) {
      divGreeting.textContent = `Welcome, ${authClient.playerName}!`;

      // This kicks off the game fetching and rendering loop
      fetchAndRenderGames();
    } else {
      divGreeting.textContent = `Welcome!`;
      divNotice.textContent = 'Once you create or join some games, you\'ll see them here.';
      return;
    }
  });

  if (navigator.serviceWorker)
    navigator.serviceWorker.ready.then(renderPN);
  else
    document.querySelector('#pn').innerHTML = 'Your browser does not support push notifications.';

  document.querySelector('.tabs UL').addEventListener('click', event => {
    let liTab = event.target.closest('LI:not(.is-active)');
    if (!liTab) return;

    let tab = getTabNameForElement(liTab);
    if (!tab) return;

    location.hash = '#' + tab;
  });

  let gameClickHandler = event => {
    let divGame = event.target.closest('.game');
    if (!divGame) return;

    let link = location.origin + '/game.html?' + divGame.id;

    let spnCopy = event.target.closest('.copy');
    if (spnCopy) {
      copy(link);
      popup({
        message:'Copied the game link.  Paste the link to invite using your app of choice.',
        minWidth: '250px',
      });
      return;
    }

    let spnShare = event.target.closest('.share');
    if (spnShare) {
      share({
        title: 'Tactics',
        text: 'Want to play?',
        url: link,
      }).catch(error => {
        if (error.isInternalError)
          popup({
            message: 'App sharing failed.  You can copy the link to share it instead.',
            buttons: [
              { label:'Copy', onClick:() => copy(link) },
              { label:'Cancel' },
            ],
            minWidth: '250px',
          });
        else
          popup({
            message: 'App sharing cancelled.  You can still copy the link to share it instead.',
            buttons: [
              { label:'Copy', onClick:() => copy(link) },
              { label:'Cancel' },
            ],
            minWidth: '250px',
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
    let tab = 'active';
    if (location.hash === '#waiting')
      tab = 'waiting';
    else if (location.hash === '#complete')
      tab = 'complete';

    openTab(tab);
  });
});

function renderPN(reg) {
  let divPN = document.querySelector('#pn');

  if (!('pushManager' in reg)) {
    divPN.innerHTML = 'Your browser does not support push notifications.';
    return;
  }

  let pushClient = clientFactory('push');

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
      pushClient.setSubscription(subscription);

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
          minWidth: '250px',
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

function renderGames(gms) {
  clearGameLists();

  gms.forEach(g => {
    if (g.ended)
      games.complete.set(g.id, g);
    else if (g.started)
      games.active.set(g.id, g);
    else if (g.isPublic)
      games.open.set(g.id, g);
    else
      games.waiting.set(g.id, g);
  });

  document.querySelector('.tabs .active .badge').textContent = games.active.size;
  document.querySelector('.tabs .waiting .badge').textContent = games.open.size + games.waiting.size;
  document.querySelector('.tabs .complete .badge').textContent = games.complete.size;

  document.querySelector('#notice').textContent = '';

  renderActiveGames();
  renderWaitingGames();
  renderCompleteGames();

  let tab = 'active';
  if (location.hash === '#waiting')
    tab = 'waiting';
  else if (location.hash === '#complete')
    tab = 'complete';

  document.querySelector('.tabs').style.display = '';
  document.querySelector('.tabs .' + tab).classList.add('is-active');
  document.querySelector('.tabContent .' + tab).style.display = '';
}

function clearGameLists() {
  // Clear the global game mappings
   Object.keys(games).forEach((gameType) => {
     games[gameType].clear();
   });

  // Clear the game lists in the DOM
  document.getElementsByClassName("gameList").forEach((gameList) => {
    gameList.innerHTML = null;
  });
}

function renderActiveGames() {
  let divTabContent = document.querySelector('.tabContent .active');
  let activeGames = [...games.active.values()].sort((a, b) =>
    a.updated - b.updated // descending
  );

  let myTurnGames = [];
  for (let game of activeGames) {
    if (game.teams[game.currentTeamId].playerId !== myPlayerId)
      continue;
    if (!game.teams.find(t => t.playerId !== myPlayerId))
      continue;

    let divGame = renderGame(game);

    myTurnGames.push(divGame);
  }

  if (myTurnGames.length) {
    let header = document.createElement('HEADER');
    header.innerHTML = 'Your Turn!';

    divTabContent.appendChild(header);
    myTurnGames.forEach(div => divTabContent.appendChild(div));
  }

  let theirTurnGames = [];
  for (let game of activeGames) {
    if (game.teams[game.currentTeamId].playerId === myPlayerId)
      continue;
    if (!game.teams.find(t => t.playerId !== myPlayerId))
      continue;

    let divGame = renderGame(game);

    theirTurnGames.push(divGame);
  }

  if (theirTurnGames.length) {
    let header = document.createElement('HEADER');
    header.innerHTML = 'Their Turn!';

    divTabContent.appendChild(header);
    theirTurnGames.forEach(div => divTabContent.appendChild(div));
  }

  let testGames = [];
  for (let game of activeGames) {
    if (game.teams.find(t => t.playerId !== myPlayerId))
      continue;

    let divGame = renderGame(game);

    testGames.push(divGame);
  }

  if (testGames.length) {
    let header = document.createElement('HEADER');
    header.innerHTML = 'Practice Games!';

    divTabContent.appendChild(header);
    testGames.forEach(div => divTabContent.appendChild(div));
  }
}

async function renderWaitingGames() {
  let divTabContent = document.querySelector('.tabContent .waiting');

  if (games.open.size) {
    let header = document.createElement('HEADER');
    header.innerHTML = 'Public Games!';
    divTabContent.appendChild(header);

    let openGames = [...games.open.values()].sort((a, b) =>
      a.created - b.created // descending
    );

    for (let game of openGames) {
      let divGame = renderGame(game);

      divTabContent.appendChild(divGame);
    }
  }

  if (games.waiting.size) {
    let header = document.createElement('HEADER');
    header.innerHTML = 'Private Games!';
    divTabContent.appendChild(header);

    let waitingGames = [...games.waiting.values()].sort((a, b) =>
      b.updated - a.updated // ascending
    );

    for (let game of waitingGames) {
      let divGame = renderGame(game);

      divTabContent.appendChild(divGame);
    }
  }
}

function renderCompleteGames() {
  let divTabContent = document.querySelector('.tabContent .complete');
  let completeGames = [...games.complete.values()].sort((a, b) =>
    b.updated - a.updated // ascending
  );

  for (let game of completeGames) {
    let divGame = renderGame(game);

    divTabContent.appendChild(divGame);
  }
}

function renderGame(game) {
  let teams = game.teams;

  let left;
  // Completed Games
  if (game.ended) {
    left = `<SPAN>${game.typeName},</SPAN> `;
    if (game.winnerId === null)
      left += '<SPAN>Draw!</SPAN>';
    else if (teams[game.winnerId].playerId === myPlayerId)
      left += '<SPAN>You Win!</SPAN>';
    else
      left += '<SPAN>You Lose!</SPAN>';
  }
  // Active Games
  else if (game.started) {
    left = `<SPAN>${game.typeName}</SPAN>`;
  }
  // Waiting Games
  else {
    let labels = [game.typeName];

    if (game.turnTimeLimit === 86400)
      labels.push('1 Day');
    else if (game.turnTimeLimit === 120)
      labels.push('2 Min');
    else if (game.turnTimeLimit === 60)
      labels.push('30 sec');

    if (!game.randomFirstTurn) {
      if (
        (!teams[0] || teams[0].playerId === myPlayerId) &&
        (!teams[1] || teams[1].playerId !== myPlayerId)
      )
        labels.push('You 1st');
      else
        labels.push('You 2nd');
    }

    left = '<SPAN>' + labels.join(',</SPAN> <SPAN>') + '</SPAN>';
  }

  let middle;
  if (game.started || game.isPublic) {
    // Use of 'Set' was to de-dup the names.
    // Only useful for 4-player games where 2 players have the same name.
    let opponents = [...new Set(
      teams.filter(t => t && t.playerId !== myPlayerId).map(t => t.name)
    )];
    if (opponents.length === 0)
      opponents[0] = '<I>Yourself</I>';
    middle = opponents.join(', ');
  }
  else {
    if (navigator.share)
      middle = '<SPAN class="share"><SPAN class="fa fa-share"></SPAN><SPAN class="label">Share Invite Link</SPAN></SPAN>';
    else
      middle = '<SPAN class="copy"><SPAN class="fa fa-copy"></SPAN><SPAN class="label">Copy Invite Link</SPAN></SPAN>';
  }

  let now = Date.now();
  let elapsed;

  if (!game.started || game.ended || !game.turnTimeLimit)
    elapsed = (now - game.updated) / 1000;
  else
    elapsed = (now - (game.turnStarted.getTime() + game.turnTimeLimit*1000)) / 1000;

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

  let divGame = document.createElement('DIV');
  divGame.id = game.id;
  divGame.classList.add('game');
  divGame.innerHTML = `
    <SPAN class="left">${left}</SPAN>
    <SPAN class="middle">${middle}</SPAN>
    <SPAN class="right">
      <SPAN class="elapsed">${elapsed}</SPAN>
      <SPAN class="fa fa-clock"></SPAN>
    </SPAN>
  `;

  return divGame;
}

function openTab(tab) {
  document.querySelectorAll('.tabs LI')
    .forEach(li => li.classList.remove('is-active'));
  document.querySelectorAll('.tabContent > DIV')
    .forEach(div => div.style.display = 'none');

  document.querySelector(`.tabs .${tab}`).classList.add('is-active');
  document.querySelector(`.tabContent .${tab}`).style.display = '';
}

function getTabNameForElement(el) {
  if (el.classList.contains('active'))
    return 'active';
  else if (el.classList.contains('waiting'))
    return 'waiting';
  else if (el.classList.contains('complete'))
    return 'complete';
}

function fetchGames() {
  return new Promise((res) => {
    /*
     * Get 50 of the most recent games.  Once the player creates or plays more
     * than 50 games, the oldest ones will drop out of view.
     */
    gameClient
      .searchMyGames({
        // Exclude my public, waiting games
        filter: {
          "!": {
            isPublic: true,
            started: null,
          },
        },
        sort: { field: "updated", order: "desc" },
        limit: 50,
      })
      .then(async (result) => {
        /*
         * Due to automated game-matching, there should not be any more than 1
         * game per public configuration permutation.
         */
        let openGames = await gameClient.searchOpenGames({
          sort: "created",
          limit: 10,
        });

        const games = result.hits.concat(openGames.hits);
        res(games);
      });
  });
}

/**
 * Calling this function will kick off a loop of fetching the latest games from the server, rendering them, and then
 * repeating this process at the specified interval.
 *
 * NOTE: We purposely use recursive `setTimeout` calls instead of `setInterval` to avoid
 * making requests when the server is disconnected (i.e. when the user changes tabs).
 */
function fetchAndRenderGames() {
  fetchGames()
    .then(renderGames)
    .catch((error) => {
      const divNotice = document.querySelector("#notice");
      divNotice.textContent =
          "Sorry!  There was an error while loading your games.";
      throw error;
    })
    .then(() => {
      setTimeout(fetchAndRenderGames, GAMES_FETCH_INTERVAL);
    });
}
