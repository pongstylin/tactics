import 'tactics/core.scss';
import config from 'config/client.js';
import clientFactory from 'client/clientFactory.js';
import popup from 'components/popup.js';
import copy from 'components/copy.js';

let authClient = clientFactory('auth');
let gameClient = clientFactory('game');
let myPlayerId = null;
let games = {
  active: new Map(),
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

  authClient.whenReady.then(() => {
    myPlayerId = authClient.playerId;

    if (myPlayerId) {
      divGreeting.textContent = `Welcome, ${authClient.playerName}!`;
      divGreeting.style.display = '';

      divNotice.textContent = 'Loading your games...';

      /*
       * Get 50 of the most recent games.  Once the player creates or plays more
       * than 50 games, the oldest ones will drop out of view.
       */
      gameClient.searchMyGames({ limit:50, sort:'updated' })
        .then(rsp => renderGames(rsp.results))
        .catch(error => {
          divNotice.textContent = 'Sorry!  There was an error while loading your games.';
          throw error;
        });
    }
    else {
      divGreeting.style.display = '';
      divNotice.textContent = 'Once you create or join some games, you\'ll see them here.';
      return;
    }
  });

  if (navigator.serviceWorker)
    navigator.serviceWorker.ready.then(reg => renderPN());

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
      alert('Game link copied to clipboard.');
      return;
    }

    let spnShare = event.target.closest('.share');
    if (spnShare) {
      navigator.share({
        title: 'Tactics',
        text: 'Want to play?',
        url: link,
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

function renderPN() {
  let divPN = document.querySelector('#pn');

  if (Notification.permission === 'denied') {
    divPN.innerHTML = `
      <DIV>Push notifications are currently <SPAN class="blocked">BLOCKED</SPAN>.</DIV>
      <DIV>You will not get notified when it is your turn.</DIV>
    `;
    return;
  }

  navigator.serviceWorker.getRegistration().then(reg => {
    if (!('pushManager' in reg)) {
      divPN.innerHTML = 'Your browser does not support push notifications.';
      return;
    }

    reg.pushManager.getSubscription().then(subscription => {
      if (subscription) {
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
        divPN.innerHTML = `
          <DIV>Enable push notifications to know when it is your turn.</DIV>
          <DIV><SPAN class="toggle">Turn on push notifications</SPAN></DIV>
        `;
        divPN.querySelector('.toggle').addEventListener('click', () => {
          subscribePN();
        });
      }
    });
  });
}
function subscribePN() {
  let divPN = document.querySelector('#pn');

  return navigator.serviceWorker.getRegistration().then(reg => {
    reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: pushPublicKey,
    }).then(subscription => {
      let pushClient = clientFactory('push');
      pushClient.setSubscription(subscription);

      renderPN();
    })
    .catch(error => {
      if (Notification.permission === 'denied')
        return renderPN();

      console.error('subscribe:', error);

      divPN.innerHTML = 'Failed to subscribe to push notifications.';
    });
  });
}
function unsubscribePN() {
  let divPN = document.querySelector('#pn');

  return navigator.serviceWorker.getRegistration().then(reg =>
    reg.pushManager.getSubscription().then(subscription =>
      subscription.unsubscribe()
    )
  ).then(() => {
    renderPN();
  })
  .catch(error => {
    console.error('unsubscribe', error);
    divPN.innerHTML = 'Failed to unsubscribe.';
  });
}

function renderGames(gms) {
  gms.forEach(g => {
    if (g.ended)
      games.complete.set(g.id, g);
    else if (g.started)
      games.active.set(g.id, g);
    else
      games.waiting.set(g.id, g);
  });

  document.querySelector('.tabs .active .badge').textContent = games.active.size;
  document.querySelector('.tabs .waiting .badge').textContent = games.waiting.size;
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

    divTabContent.append(header);
    myTurnGames.forEach(div => divTabContent.append(div));
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

    divTabContent.append(header);
    theirTurnGames.forEach(div => divTabContent.append(div));
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

    divTabContent.append(header);
    testGames.forEach(div => divTabContent.append(div));
  }
}

function renderWaitingGames() {
  let divTabContent = document.querySelector('.tabContent .waiting');
  let waitingGames = [...games.waiting.values()].sort((a, b) =>
    b.updated - a.updated // ascending
  );

  for (let game of waitingGames) {
    let divGame = renderGame(game);

    divTabContent.append(divGame);
  }
}

function renderCompleteGames() {
  let divTabContent = document.querySelector('.tabContent .complete');
  let completeGames = [...games.complete.values()].sort((a, b) =>
    b.updated - a.updated // ascending
  );

  for (let game of completeGames) {
    let divGame = renderGame(game);

    divTabContent.append(divGame);
  }
}

function renderGame(game) {
  let left;
  if (game.ended) {
    if (game.winnerId === null)
      left = 'Draw!';
    else if (game.teams[game.winnerId].playerId === myPlayerId)
      left = 'You win!';
    else
      left = 'You lose!';
  }
  else if (game.started) {
    left = 'VS';
  }
  else {
    if (navigator.share)
      left = '<SPAN class="share"><SPAN class="fa fa-share"></SPAN><SPAN class="label">Link</SPAN></SPAN>';
    else
      left = '<SPAN class="copy"><SPAN class="fa fa-copy"></SPAN><SPAN class="label">Link</SPAN></SPAN>';
  }

  let middle;
  if (game.started) {
    // Use of 'Set' was to de-dup the names.
    // Only useful for 4-player games where 2 players have the same name.
    let opponents = [...new Set(
      game.teams.filter(t => !!t && t.playerId !== myPlayerId).map(t => t.name)
    )];
    if (opponents.length === 0)
      opponents[0] = '<I>Yourself</I>';
    middle = opponents.join(', ');
  }
  else {
    if (game.randomFirstTurn)
      middle = 'Random First Turn';
    else if (game.teams[0] && game.teams[0].playerId === myPlayerId)
      middle = 'You Go First';
    else
      middle = 'They Go First';
  }

  let elapsed = (new Date() - game.updated) / 1000;
  if (elapsed < 60)
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
