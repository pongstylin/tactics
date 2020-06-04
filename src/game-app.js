import popup from 'components/popup.js';
import copy from 'components/copy.js';
import share from 'components/share.js';
import GameSettings from 'components/Modal/GameSettings.js';

const ServerError = Tactics.ServerError;
const authClient = Tactics.authClient;
const gameClient = Tactics.gameClient;
const chatClient = Tactics.chatClient;

var settings;
var progress;
var gameId = location.search.slice(1).replace(/[&=].*$/, '');
var gameType;
var game;
var lastSeenEventId;
var chatMessages = [];
var undoPopup;
var timeoutPopup;
var pointer;
var readySpecial;
var turnTimeout;

var buttons = {
  home: () => {
    location.href = '/online.html';
  },
  settings: () => {
    settings.show();
  },
  replay: async () => {
    let turnId = 0;
    let nextActionId = 0;

    let hash = location.hash;
    let skipPassedTurns = 'back';
    if (hash) {
      let params = new URLSearchParams(hash.slice(1));

      if (params.has('c')) {
        let cursor = params.get('c').split(',');

        turnId = (parseInt(cursor[0]) || 1) - 1;
        nextActionId = parseInt(cursor[1]) || 0;
        skipPassedTurns = false;
      }
    }

    $('#game-play').removeClass('active');
    $('#game-settings').removeClass('active').hide();
    $('#game-replay').addClass('active');

    $('#game').toggleClass('is-busy');
    await game.showTurn(turnId, nextActionId, skipPassedTurns);
    $('#game').toggleClass('is-busy');
  },
  share: () => {
    let players = new Set([...game.teams.map(t => t.playerId)]);
    let myTeam = game.teams.find(t => t.playerId === authClient.playerId);
    let message;

    if (game.inReplay) {
      let turnPart = `Turn ${game.turnId + 1}/${game.nextActionId}`;

      if (players.size === 1) {
        message = `${gameType.name} Practice Game ${turnPart}.`;
      }
      else {
        let opponents = game.teams
          .map(t => t.name)
          .join(' vs ');

        message = `${opponents} @ ${gameType.name}, ${turnPart}`;
      }
    }
    else {
      if (players.size === 1) {
        if (myTeam) {
          message = `Watch my ${gameType.name} practice game.`;
        }
        else {
          myTeam = game.teams[0];

          message = `Watch ${gameType.name} practice game by ${myTeam.name}.`;
        }
      }
      else {
        if (myTeam) {
          let opponents = game.teams
            .filter(t => t.playerId !== myTeam.playerId)
            .map(t => t.name)
            .join(' and ');

          message = `Watch my ${gameType.name} game against ${opponents}.`;
        }
        else {
          let opponents = game.teams
            .map(t => t.name)
            .join(' vs ');

          message = `Watch ${opponents} @ ${gameType.name}.`;
        }
      }
    }

    let link = location.href;

    if (navigator.share)
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
            minWidth: '250px',
          });
        else
          popup({
            message: 'App sharing cancelled.  You can still copy the link to share it instead.',
            buttons: [
              { label:'Copy', onClick:() => copy(`${message} ${link}`) },
              { label:'Cancel' },
            ],
            minWidth: '250px',
          });
      });
    else {
      copy(`${message} ${link}`);
      popup({ message:'Copied the game link.  Paste the link to share using your app of choice.' });
    }
  },
  rotate: $button => {
    let classesToToggle;

    if ($button.hasClass('fa-rotate-90'))
      classesToToggle = 'fa-rotate-90 fa-rotate-180';
    else if ($button.hasClass('fa-rotate-180'))
      classesToToggle = 'fa-rotate-180 fa-rotate-270';
    else if ($button.hasClass('fa-rotate-270'))
      classesToToggle = 'fa-rotate-270';
    else
      classesToToggle = 'fa-rotate-90';

    $button.toggleClass(classesToToggle);
    game.rotateBoard(90);

    resetPlayerBanners();
  },
  undo: () => {
    let sendingPopup = popup({
      message: 'Waiting for server to respond...',
      buttons: [],
      closeOnCancel: false,
      autoOpen: 300,
    });

    game.undo()
      .then(() => sendingPopup.close())
      .catch(error => {
        sendingPopup.close();
        $('BUTTON[name=undo]').prop('disabled', true);

        let message = "Sorry! Can't undo right now.";

        if (error instanceof ServerError) {
          if (error.code === 403)
            message += ` Reason: ${error.message}`;
          else if (error.code === 500)
            message += ` Reason: ${error.message}`;
        }

        popup(message);
      });
  },
  select: $button => {
    let $app = $('#app');
    if ($app.hasClass('chat-open'))
      buttons.chat();

    let mode = $button.val();

    if (mode == 'turn' && $button.hasClass('ready')) {
      $('BUTTON[name=select][value=turn]').removeClass('ready');
      return game.zoomToTurnOptions();
    }

    game.selectMode = mode;
  },
  pass: () => {
    game.pass();
  },
  surrender: () => {
    popup({
      message: 'Do you surrender?',
      buttons: [
        {
          label: 'Yes',
          onClick: () => game.surrender(),
        },
        {
          label: 'No',
        },
      ],
    });
  },
  chat: () => {
    let $app = $('#app');
    if ($app.hasClass('chat-opening') || $app.hasClass('chat-closing'))
      return;

    let $chat = $('#chat');
    let $messages = $('#messages');
    // Microsoft Edge does not support using 'calc()' css with transition.
    let isEdge = /Edge/.test(navigator.userAgent);

    if ($app.hasClass('chat-open')) {
      // Keep chat scrolled to bottom while reducing height.
      let tickRequest;
      let tick = () => {
        $messages.scrollTop($messages.prop('scrollHeight'));
        tickRequest = requestAnimationFrame(tick);
      };

      let finish = () => {
        cancelAnimationFrame(tickRequest);
        $app.toggleClass('chat-open chat-closing');
        updateChatButton();

        $app.off('transitionend transitioncancel', finish);
      };

      // Sometimes this bubbles up from the #chat
      $app.on('transitionend transitioncancel', finish);

      if (isEdge && $app.hasClass('with-inlineChat')) {
        $chat.css({ height:'' });
        $app.addClass('chat-closing');
      }
      else {
        $app.addClass('chat-closing');
      }

      tick();
    }
    else {
      let finish = () => {
        $app.toggleClass('chat-open chat-opening');
        updateChatButton();

        $app.off('transitionend transitioncancel', finish);
      };

      // Sometimes this bubbles up from the #chat
      $app.on('transitionend transitioncancel', finish);

      if (isEdge && $app.hasClass('with-inlineChat')) {
        $chat.css({ height:$chat.css('height') });
        $app.addClass('chat-opening');
        $chat.css({ height:($app.height() - 20 - 52)+'px' });
      }
      else {
        $app.addClass('chat-opening');
      }

      // Keep chat scrolled to bottom after displaying input box
      $messages.scrollTop($messages.prop('scrollHeight'));
    }
  },
  swapbar: async () => {
    let $active = $('#game > .buttons.active').removeClass('active');
    if ($active.is('#game-play'))
      $('#game-settings').addClass('active');
    else
      $('#game-play').addClass('active');
  },
  start: async () => {
    $('#game').toggleClass('is-busy');
    await game.showTurn(0, 0, 'back');
    $('#game').toggleClass('is-busy');
    return false;
  },
  back: async () => {
    $('#game').toggleClass('is-busy');
    if (game.actions.length)
      await game.showTurn(game.turnId, 0, 'back');
    else
      await game.showTurn(game.turnId - 1, 0, 'back');
    $('#game').toggleClass('is-busy');
    return false;
  },
  play: async () => {
    $('#game').toggleClass('is-busy');
    if (game.cursor.atCurrent)
      game.play(0);
    else
      game.play();
    $('#game').toggleClass('is-busy');
  },
  pause: async () => {
    $('#game').toggleClass('is-busy');
    await game.pause();
    $('#game').toggleClass('is-busy');
  },
  forward: async () => {
    $('#game').toggleClass('is-busy');
    await game.showTurn(game.turnId + 1, 0, 'forward');
    $('#game').toggleClass('is-busy');
    return false;
  },
  end: async () => {
    $('#game').toggleClass('is-busy');
    await game.showTurn(-1, -1, 'forward');
    $('#game').toggleClass('is-busy');
    return false;
  },
  resume: async () => {
    $('#game').toggleClass('is-busy');
    await game.resume();
    $('#game').toggleClass('is-busy');

    $('#game-replay').removeClass('active');
    $('#game-settings').addClass('active').show();
  },
};

$(() => {
  progress = new Tactics.Progress();
  progress.message = 'Loading game...';
  progress.show();

  settings = new GameSettings({
    autoShow: false,
    hideOnCancel: true,
  });

  if ('ontouchstart' in window)
    $('body').addClass(pointer = 'touch');
  else
    $('body').addClass(pointer = 'mouse');

  if (pointer === 'touch')
    $('.new-message').attr('placeholder', 'Touch to chat!');
  else
    $('.new-message').attr('placeholder', 'Type to chat!');

  $('BODY')
    /*
     * Under these conditions a special attack can be triggered:
     *   1) The unit is enraged and selected in attack mode. (selector)
     *   2) The attack button is pressed for 2 seconds and released.
     */
    .on('mousedown touchstart', '#app BUTTON:enabled[name=select][value=attack].ready', event => {
      // Ignore mouse events on touch devices
      if (pointer === 'touch' && event.type === 'mousedown')
        return;
      // Ignore repeated mousedown/touchstart before mouseup/touchend
      if (readySpecial)
        return;
      readySpecial = game.readySpecial();

      let button = event.target;
      let eventType = event.type === 'touchstart' ? 'touchend' : 'mouseup';

      $(document).one(eventType, event => {
        if (event.target === button)
          readySpecial.release();
        else
          readySpecial.cancel();

        readySpecial = null;
      });
    })
    .on('mouseover', '#app BUTTON:enabled', event => {
      let $button = $(event.target);

      // Ignore disabled buttons
      if (window.getComputedStyle(event.target).cursor !== 'pointer')
        return;

      Tactics.playSound('focus');
    })
    .on('click', '#app BUTTON:enabled', async event => {
      let $button = $(event.target);
      let handler = $button.data('handler') || buttons[$button.attr('name')];
      if (!handler) return;

      // Ignore disabled buttons
      if (window.getComputedStyle(event.target).cursor !== 'pointer')
        return;

      Tactics.playSound('select');

      $button.prop('disabled', true);
      if (await handler($button) !== false)
        $button.prop('disabled', false);
    })
    .on('keydown', event => {
      let $app = $('#app');
      let $chat = $('#chat');
      let $messages = $chat.find('#messages');
      let $newMessage = $chat.find('.new-message');
      let keyChar = event.key;

      if (keyChar === undefined) {
        let keyCode = event.which || event.keyCode;
        if (keyCode === 13)
          keyChar = 'Enter';
        else
          keyChar = String.fromCharCode(keyCode);
      }

      if (keyChar === 'Control' || keyChar === 'Alt' || keyChar === 'Shift')
        return;

      // Open chat, but otherwise ignore input until input box is ready.
      if ($app.is('.chat-opening'))
        return;
      else if ($app.is('.with-popupChat:not(.chat-open)')) {
        let openers = ['Enter','ArrowUp','ArrowDown','PageUp','PageDown'];
        if (openers.includes(keyChar) || keyChar.length === 1)
          buttons.chat();

        return;
      }

      if (!$newMessage.is(':focus')) {
        if (keyChar === 'ArrowUp') {
          event.preventDefault();
          $messages.scrollTop($messages.scrollTop() - 18);
        }
        else if (keyChar === 'ArrowDown') {
          event.preventDefault();
          $messages.scrollTop($messages.scrollTop() + 18);
        }
        else if (keyChar === 'PageUp') {
          event.preventDefault();
          $messages.scrollTop($messages.scrollTop() - 90);
        }
        else if (keyChar === 'PageDown') {
          event.preventDefault();
          $messages.scrollTop($messages.scrollTop() + 90);
        }
      }

      if (keyChar === 'Enter') {
        // Disallow line breaks.
        event.preventDefault();

        if (!$newMessage.is(':focus'))
          return $newMessage[0].focus({ preventScroll:true });

        let message = $newMessage.val().trim();
        if (!message.length)
          if ($newMessage.is(':focus'))
            return $newMessage.blur();

        /*
         * Wait until the 'input' event fires to submit the message since there
         * is an apparent bug in Android Chrome that truncates the input value
         * at the cursor location where Enter is submitted IF an edit occurred
         * in the middle of the text.  The text is only truncated briefly.
         */
        if (!event.shiftKey && !event.metaKey) {
          $newMessage.data('submit', true);

          setTimeout(() => $newMessage.trigger('input'));
        }
      }
      else if (keyChar === 'Escape') {
        if ($app.hasClass('chat-open')) {
          $newMessage.blur();
          buttons.chat();
        }
      }
      else if (keyChar.length === 1 && !$newMessage.is(':focus')) {
        $newMessage[0].focus({ preventScroll:true });
      }
    })
    .on('focus', '#chat .new-message', () => {
      $('#app').addClass('chat-input-mode');
    })
    .on('blur', '#chat .new-message', () => {
      $('#app').removeClass('chat-input-mode');
    });

  $('#chat').on('transitionend', ({ originalEvent:event }) => {
    let $messages = $('#messages');

    if (event.propertyName === 'height')
      $messages.scrollTop($messages.prop('scrollHeight'));
  });

  // It takes some JS-work to base a TEXTAREA's height on its content.
  $('TEXTAREA')
    .on('input', async event => {
      let $chat = $('#chat');
      let $messages = $chat.find('#messages');
      let $newMessage = $chat.find('.new-message');

      if ($newMessage.data('submit')) {
        $newMessage.removeData('submit');

        await chatClient.postMessage(gameId, $newMessage.val().trim());
        $newMessage.val('');
      }

      let newMessage = $newMessage.get(0);
      newMessage.style.height = 'auto';
      let style = window.getComputedStyle(newMessage);
      let paddingHeight = parseInt(style.paddingTop) + parseInt(style.paddingBottom);

      let height = newMessage.scrollHeight;
      if (style.boxSizing === 'content-box') {
        height -= paddingHeight;
        // The initial height can be computed as zero in some cases (flexbox?)
        height = Math.max(height, 18);
      }
      else {
        // The initial height can be computed as zero in some cases (flexbox?)
        height = Math.max(height, 18 + paddingHeight);
      }

      newMessage.style.height = `${height}px`;

      // As the height of the textarea increases, the height of the messages
      // decreases.  As it does so, make sure it remains scrolled to bottom.
      if (style.position === 'relative')
        $messages.scrollTop($('#messages').prop('scrollHeight'));
    })
    .each(() => {
      $(this).trigger('input');
    });

  initGame();
});

$(window).on('resize', () => {
  if (!game || !game.canvas.parentNode) return;

  // Temporarily remove chat-open and inlineChat so that the game can
  // calculate the biggest board size it can.
  let chatMode = $('#app').hasClass('chat-open');
  $('#app').removeClass('chat-open with-inlineChat');

  game.resize();

  let bodyHeight = $('BODY').prop('clientHeight');
  let appHeight = $('#board').prop('clientHeight') + 106;
  $('#app').toggleClass('with-inlineChat', appHeight <= bodyHeight);
  $('#app').toggleClass('with-popupChat', appHeight > bodyHeight);
  if (chatMode) $('#app').addClass('chat-open');

  // Useful for orientation changes
  $('#messages').scrollTop($('#messages').prop('scrollHeight'));
  $('#chat .new-message').trigger('input');

  setTimeout(updateChatButton);
});

async function initGame() {
  return getGameData(gameId)
    .then(async gameData => {
      gameType = await gameClient.getGameType(gameData.state.type);

      // An account is not required to view an ended game.
      if (gameData.state.ended)
        return loadTransportAndGame(gameId, gameData);

      // No account?  Provide a name before joining/watching!
      if (!authClient.token)
        return showJoinIntro(gameData);

      // Account exists and game started?  Immediately start watching!
      if (gameData.state.started)
        return loadTransportAndGame(gameId, gameData);

      let teams = gameData.state.teams;
      let hasJoined = teams.filter(t => t && t.playerId === authClient.playerId);
      if (hasJoined.length === teams.length)
        return showPracticeIntro(gameData);
      else if (hasJoined.length)
        if (gameData.isPublic)
          return showPublicIntro(gameData);
        else
          return showPrivateIntro(gameData);
      else
        return showJoinIntro(gameData);
    })
    .then(g => {
      game = g;
      game.state.on('playerStatus', resetPlayerBanners);

      if (game.isViewOnly)
        $('#app').addClass('for-viewing');
      else if (game.hasOneLocalTeam()) {
        $('#app').addClass('for-playing');

        let groupId = `/rooms/${gameId}`;
        let playerId = authClient.playerId;

        chatClient.on('open', ({ data }) => {
          if (data.reason === 'resume') return;

          let resume = chatMessages.last ? chatMessages.last.id : null;

          chatClient.joinChat(gameId, { id:resume }).then(({ events }) => {
            appendMessages(events.filter(e => e.type === 'message'));
          });
        });

        chatClient.on('event', event => {
          if (event.body.group !== groupId) return;
          if (event.body.type !== 'message') return;

          let message = event.body.data;
          appendMessages(message);
        });

        return chatClient.joinChat(gameId).then(({ players, events }) => {
          lastSeenEventId = players
            .find(p => p.id === playerId).lastSeenEventId;

          initMessages(events.filter(e => e.type === 'message'));

          startGame();
        });
      }
      else
        $('#app').addClass('for-practice');

      startGame();
    })
    .catch(error => {
      if (error === 'Connection reset')
        return initGame();

      if (error.code === 403 || error.code === 409)
        $('#error').text(error.message);
      else if (error.code === 404)
        $('#error').text("The game doesn't exist");
      else if (error.code === 429)
        $('#error').text("Loading games too quickly");

      progress.hide();
      $('#join').hide();
      $('#error').show();

      // Log client-side errors
      if (!(error instanceof ServerError))
        throw error;
    });
}

async function getGameData(gameId) {
  return gameClient.getGameData(gameId);
}
async function joinGame(playerName, gameId, set) {
  return authClient.setAccountName(playerName)
    .then(() => gameClient.joinGame(gameId, { set }));
}
async function loadTransportAndGame(gameId, gameData) {
  return loadGame(await loadTransport(gameId, gameData));
}
// Must be authorized first or the game already ended
async function loadTransport(gameId, gameData) {
  let transport = new Tactics.RemoteTransport(gameId, gameData);
  await transport.whenReady;

  return transport;
}
async function loadGame(transport) {
  await loadResources(transport);

  let localTeamIds = transport.teams
    .filter(t => t && t.playerId === authClient.playerId)
    .map(t => t.originalId);

  return new Tactics.Game(transport, localTeamIds);
}
async function loadResources(gameState) {
  let unitTypes = gameType.getUnitTypes();

  // If the user will see the game immediately after the resources are loaded,
  // then require a tap to make sure sound effects work.
  let requireTap = gameState.ended || authClient.token && gameState.started;

  return new Promise(resolve => {
    progress
      .on('complete', () => {
        if (!requireTap) return resolve();

        let tapHandler = () => {
          progress.disableButtonMode(tapHandler);
          progress.message = 'One moment...';
          resolve();
        };
        progress.enableButtonMode(tapHandler);

        let action = pointer === 'mouse' ? 'Click' : 'Tap';
        if (gameState.ended)
          progress.message = `${action} here to view!`;
        else if (gameState.teams.find(t => t.playerId === authClient.playerId))
          progress.message = `${action} here to play!`;
        else
          progress.message = `${action} here to watch!`;
      })
      .show();

    return Tactics.load(unitTypes, (percent, label) => {
      progress.message = label;
      progress.percent = percent;
    });
  });
}

function initMessages(messages) {
  $('#messages').empty();

  chatMessages = messages;
  messages.forEach(m => renderMessage(m));

  let $messages = $('#messages');
  $messages.scrollTop($messages.prop('scrollHeight'));
}
function appendMessages(messages) {
  if (!Array.isArray(messages))
    messages = [messages];

  chatMessages.push(...messages);
  messages.forEach(m => renderMessage(m));

  let $messages = $('#messages');
  $messages.scrollTop($messages.prop('scrollHeight'));

  updateChatButton();
}
function renderMessage(message) {
  let playerId = message.player.id;
  let playerName = message.player.name;
  if (game.teams.filter(t => t.name === playerName).length > 1) {
    let team = game.teams.find(t => t.playerId === playerId);
    if (game.isMyTeam(team))
      playerName = '<I>You</I> ';
  }

  $('#messages').append(`
    <DIV class="message">
      <SPAN class="player">${playerName}</SPAN>
      <SPAN class="content">${message.content}</SPAN>
    </DIV>
  `);
}

async function showPublicIntro(gameData) {
  renderShareLink(gameData, document.querySelector('#public .shareLink'));
  renderCancelButton(gameData.id, document.querySelector('#public .cancelButton'));

  let $greeting = $('#public .greeting');
  let myTeam = gameData.state.teams.find(t => t && t.playerId === authClient.playerId);
  $greeting.text($greeting.text().replace('{teamName}', myTeam.name));

  let transport = await loadTransport(gameData.id);

  progress.hide();
  $('#public').show();
  await transport.whenStarted;
  $('#public').hide();
  progress.show();

  return loadGame(transport);
}
async function showPrivateIntro(gameData) {
  renderShareLink(gameData, document.querySelector('#private .shareLink'));
  renderCancelButton(gameData.id, document.querySelector('#private .cancelButton'));

  let $greeting = $('#private .greeting');
  let myTeam = gameData.state.teams.find(t => t && t.playerId === authClient.playerId);
  $greeting.text($greeting.text().replace('{teamName}', myTeam.name));

  let transport = await loadTransport(gameData.id);

  progress.hide();
  $('#private').show();
  await transport.whenStarted;
  $('#private').hide();
  progress.show();

  return loadGame(transport);
}

function renderCancelButton(gameId, container) {
  let cancelButton = '<SPAN class="cancel"><SPAN class="fa fa-trash"></SPAN><SPAN class="label">Cancel Game</SPAN></SPAN>';
  container.innerHTML = cancelButton;
  container.addEventListener('click', event => {
    popup({
      title: "Cancel the game?",
      message: 'Please confirm that you want to cancel this game',
      buttons: [
        {
          label:'Yes',
          onClick: () => {
            gameClient.cancelGame(gameId)
              .then(() => {
                location.href = '/online.html';
              });
          }
        },
        {
          label: 'No'
        },
      ],
      minWidth: '250px',
      zIndex: 10,
    });
  })
}

function renderShareLink(gameData, container) {
  let message = `Want to play a ${gameType.name} game`;
  if (gameData.state.turnTimeLimit === 120)
    message += ' at 2min per turn';
  else if (gameData.state.turnTimeLimit === 30)
    message += ' at 30sec per turn';
  message += '?';

  let link = location.origin + '/game.html?' + gameId;

  let shareLink;
  if (navigator.share)
    shareLink = '<SPAN class="share"><SPAN class="fa fa-share"></SPAN><SPAN class="label">Share Game Link</SPAN></SPAN>';
  else
    shareLink = '<SPAN class="copy"><SPAN class="fa fa-copy"></SPAN><SPAN class="label">Copy Game Link</SPAN></SPAN>';

  container.innerHTML = shareLink;
  container.addEventListener('click', event => {
    if (navigator.share)
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
            minWidth: '250px',
          });
        else
          popup({
            message: 'App sharing cancelled.  You can still copy the link to share it instead.',
            buttons: [
              { label:'Copy', onClick:() => copy(`${message} ${link}`) },
              { label:'Cancel' },
            ],
            minWidth: '250px',
          });
      });
    else {
      copy(`${message} ${link}`);
      popup({ message:'Copied the game link.  Paste the link to invite using your app of choice.' });
    }
  });
}

async function showPracticeIntro(gameData) {
  let root = document.body.querySelector('#practice');

  root.addEventListener('focus', event => {
    let target = event.target;
    if (target.matches('INPUT[name=playerName]'))
      target.select();
  }, true);
  root.addEventListener('blur', event => {
    let target = event.target;
    if (target.matches('INPUT[name=playerName]'))
      // Clear selection
      target.value = target.value;
  }, true);
  root.addEventListener('keydown', event => {
    let target = event.target;
    if (target.matches('INPUT[name=playerName]'))
      if (event.keyCode === 13)
        event.target.blur();
  }, true);

  let divPlayerAutoSave = root.querySelector('.playerName');
  let txtPlayerName = divPlayerAutoSave.querySelector('INPUT[name=playerName]');
  txtPlayerName.value = authClient.playerName;

  let details = root.querySelector('.details');
  let challenge = root.querySelector('.challenge');
  let btnStart = root.querySelector('BUTTON[name=start]');

  let teams = gameData.state.teams;
  let creatorTeam = teams.find(t => !!t.set);

  challenge.innerHTML = `Configure your opponent in the practice game.`;

  let person;
  if (gameData.state.randomFirstTurn)
    person = 'random';
  else if (creatorTeam.originalId === 0)
    person = creatorTeam.name;
  else
    person = 'this one';

  details.innerHTML = `
    <DIV>This is a <I>${gameType.name}</I> game.</DIV>
    <DIV>The first team to move is ${person}.</DIV>
  `;

  $('#practice .set').show();
  $('#practice .mirror').toggle(!gameType.hasFixedPositions);

  let hasCustomSet = authClient.token && await gameClient.hasCustomPlayerSet(gameType.id, 'practice');
  if (hasCustomSet)
    $('#practice INPUT[name=set][value=practice]').prop('checked', true);
  else
    $('#practice INPUT[name=set][value=same]').prop('checked', true);

  $('#practice .set A').on('click', async () => {
    $('#practice').hide();

    if (!authClient.token)
      await authClient.register({ name:'Noob' })
        .catch(error => popup({
          message: 'There was an error while loading your set.',
          buttons: [],
          closeOnCancel: false,
        }));

    if (await Tactics.setup(gameType, 'practice'))
      $('#practice INPUT[name=set][value=practice]').prop('checked', true);
    $('#practice').show();
  });

  return new Promise((resolve, reject) => {
    btnStart.addEventListener('click', async event => {
      let set = $('#practice INPUT[name=set]:checked').val();
      if (set === 'practice')
        set = { name:set };

      $('#practice').hide();
      progress.message = 'Starting game...';
      progress.show();

      try {
        await gameClient.joinGame(gameData.id, {
          slot: teams.findIndex(t => !t.set),
          name: txtPlayerName.value,
          set,
        });
        progress.message = 'Loading game...';
        resolve(
          await loadTransportAndGame(gameData.id, gameData)
        );
      }
      catch (error) {
        root.querySelector('.error').textContent = error.message;
        progress.hide();
        $('#practice').show();
      }
    });

    progress.hide();
    $('#practice').show();
  });
}
async function showJoinIntro(gameData) {
  let root = document.body.querySelector('#join');

  root.addEventListener('focus', event => {
    let target = event.target;
    if (target.matches('INPUT[name=playerName]'))
      target.select();
  }, true);
  root.addEventListener('blur', event => {
    let target = event.target;
    if (target.matches('INPUT[name=playerName]'))
      // Clear selection
      target.value = target.value;
  }, true);
  root.addEventListener('keydown', event => {
    let target = event.target;
    if (target.matches('INPUT[name=playerName]'))
      if (event.keyCode === 13)
        event.target.blur();
  }, true);
  root.addEventListener('input', event => {
    let target = event.target;
    if (target.matches('INPUT[name=playerName]')) {
      let inputTextAutosave = event.target.parentElement;
      inputTextAutosave.classList.remove('is-saved');
      inputTextAutosave.classList.remove('is-saving');
    }
  }, true);

  let divPlayerAutoSave = root.querySelector('.playerName');
  let divPlayerError = divPlayerAutoSave.nextElementSibling;
  let txtPlayerName = divPlayerAutoSave.querySelector('INPUT[name=playerName]');
  txtPlayerName.addEventListener('blur', event => {
    let newPlayerName = txtPlayerName.value.trim().length
      ? txtPlayerName.value.trim() : null;

    if (newPlayerName === null)
      newPlayerName = authClient.playerName;

    // Just in case spaces were trimmed or the name unset.
    txtPlayerName.value = newPlayerName;

    divPlayerError.textContent = '';

    if (newPlayerName === authClient.playerName)
      divPlayerAutoSave.classList.add('is-saved');
    else {
      divPlayerAutoSave.classList.remove('is-saved');
      divPlayerAutoSave.classList.add('is-saving');

      authClient.setAccountName(newPlayerName)
        .then(() => {
          divPlayerAutoSave.classList.remove('is-saving');
          divPlayerAutoSave.classList.add('is-saved');
        })
        .catch(error => {
          divPlayerAutoSave.classList.remove('is-saving');
          divPlayerError.textContent = error.toString();
        });
    }
  });

  let details = root.querySelector('.details');
  let challenge = root.querySelector('.challenge');
  let btnJoin = root.querySelector('BUTTON[name=join]');

  if (authClient.token)
    txtPlayerName.value = authClient.playerName;
  else
    txtPlayerName.value = 'Noob';

  if (gameData.state.started) {
    btnJoin.textContent = 'Watch Game';

    return new Promise((resolve, reject) => {
      btnJoin.addEventListener('click', async event => {
        $('#join').hide();
        progress.message = 'Loading game...';
        progress.show();

        try {
          await authClient.setAccountName(txtPlayerName.value);
          resolve(
            await loadTransportAndGame(gameData.id, gameData)
          );
        }
        catch (error) {
          reject(error);
        }
      });

      progress.hide();
      $('#join').show();
    });
  }
  else {
    let creatorTeam = gameData.state.teams.find(t => !!t);

    challenge.innerHTML = `<I>${creatorTeam.name}</I> is waiting for an opponent.  Want to play?`;

    let turnLimit;
    switch (gameData.state.turnTimeLimit) {
      case 604800:
        turnLimit = '1 week';
        break;
      case 86400:
        turnLimit = '1 day';
        break;
      case 120:
        turnLimit = '2 minutes';
        break;
      default:
        turnLimit = `${gameData.state.turnTimeLimit} seconds`;
    }

    let person;
    if (gameData.state.randomFirstTurn)
      person = 'random';
    else if (creatorTeam.originalId === 0)
      person = creatorTeam.name;
    else
      person = 'you';

    details.innerHTML = `
      <DIV>This is a <I>${gameType.name}</I> game.</DIV>
      <DIV>The turn time limit is set to ${turnLimit}.</DIV>
      <DIV>The first person to move is ${person}.</DIV>
    `;

    if (gameType.isCustomizable) {
      $('#join .set').show();
      $('#join .mirror').toggle(!gameType.hasFixedPositions);

      let hasCustomSet = authClient.token && await gameClient.hasCustomPlayerSet(gameType.id, 'default');
      if (hasCustomSet)
        $('#join INPUT[name=set][value=default]').prop('checked', true);
      else
        $('#join INPUT[name=set][value=same]').prop('checked', true);

      $('#join .set A').on('click', async () => {
        $('#join').hide();

        if (!authClient.token)
          await authClient.register({ name:'Noob' })
            .catch(error => popup({
              message: 'There was an error while loading your set.',
              buttons: [],
              closeOnCancel: false,
            }));

        if (await Tactics.setup(gameType, 'default'))
          $('#join INPUT[name=set][value=default]').prop('checked', true);
        $('#join').show();
      });
    }

    return new Promise((resolve, reject) => {
      btnJoin.addEventListener('click', async event => {
        let set = $('#join INPUT[name=set]:checked').val();
        if (set === 'default')
          set = { name:set };

        $('#join').hide();
        progress.message = 'Joining game...';
        progress.show();

        try {
          await joinGame(txtPlayerName.value, gameData.id, set);
          progress.message = 'Loading game...';
          resolve(
            await loadTransportAndGame(gameData.id, gameData)
          );
        }
        catch (error) {
          reject(error);
        }
      });

      progress.hide();
      $('#join').show();
    });
  }
}

function updateChatButton() {
  if (!chatMessages.length) return;

  let playerId = authClient.playerId;
  let $button = $('BUTTON[name=chat]');

  if ($('#app').is('.show.with-inlineChat, .chat-open')) {
    $button.removeClass('ready').attr('badge', '');

    if (lastSeenEventId < chatMessages.last.id) {
      lastSeenEventId = chatMessages.last.id;

      chatClient.seen(gameId, lastSeenEventId);
    }
  }
  else {
    if (chatMessages.last.player.id !== playerId)
      $button.attr('badge', '+');
    else
      $button.attr('badge', '');

    $button.toggleClass('ready', chatMessages.last.id > lastSeenEventId);
  }
}
function resetPlayerBanners() {
  let board = game.board;
  let degree = board.getDegree('N', board.rotation);

  $('.player').removeClass('active bronze');

  game.state.teams.forEach(team => {
    let position = board.getRotation(team.position, degree);
    let ePlayerId = 'player-'+position.toLowerCase();
    let $player = $('#'+ePlayerId);

    $player
      .addClass('active bronze')
      .removeClass('offline online ingame unavailable')
      .addClass(game.state.playerStatus.get(team.playerId))
      .find('.name').text(team.name);
  });

  setTurnTimeoutClock();
}
function setTurnTimeoutClock() {
  clearTimeout(turnTimeout);
  turnTimeout = null;

  let timeout = game.turnTimeRemaining;
  if (game.inReplay || timeout === undefined) {
    $('.clock').css({ display:'none' });
    return;
  }
  else
    $('.clock').css({ display:'' });

  let state = game.state;
  let timeoutClass;
  let removeClass;
  let timeoutText;
  if (timeout > 0) {
    let timeLimit = state.turnTimeLimit;
    timeoutClass = timeout < timeLimit*1000 * 0.2 ? 'short' : 'long';
    removeClass = timeout < timeLimit*1000 * 0.2 ? 'long' : 'short';
    removeClass += ' expired';

    let tick;
    // If greater than 23 hours, show days
    if (timeout > 82800000) {
      timeoutText = `&lt; ${Math.ceil(timeout / 86400000)}d`;
      tick = (timeout % 86400000) + 250;
    }
    // If greater than 1 hour, show hours
    else if (timeout > 3600000) {
      timeoutText = `&lt; ${Math.ceil(timeout / 3600000)}h`;
      tick = (timeout % 3600000) + 250;
    }
    // If greater than 2 minutes, show minutes
    else if (timeout > 120000) {
      timeoutText = `&lt; ${Math.ceil(timeout / 60000)}m`;
      tick = (timeout % 60000) + 250;
    }
    // Show clock
    else {
      let min = Math.floor(timeout / 60000);
      let sec = Math.floor((timeout % 60000) / 1000).toString().padStart(2, '0');
      timeoutText = `${min}:${sec}`;
      tick = (timeout % 1000) + 250;
    }

    if (tick < 0x80000000)
      turnTimeout = setTimeout(setTurnTimeoutClock, tick);
  }
  else {
    timeoutClass = 'expired';
    removeClass = 'short long';
    timeoutText = '0:00';
  }

  timeoutText += ' <SPAN class="fa fa-clock"></SPAN>';

  let board = game.board;
  let degree = board.getDegree('N', board.rotation);

  game.teams.forEach(team => {
    let position = board.getRotation(team.position, degree);
    let ePlayerId = 'player-'+position.toLowerCase();
    let $clock = $(`#${ePlayerId} .clock`);

    if (team === game.currentTeam)
      $clock
        .removeClass(removeClass)
        .addClass(timeoutClass)
        .html(timeoutText);
    else
      $clock
        .removeClass('expired short long')
        .empty();
  });
}

async function startGame() {
  let $card = $(game.card.canvas)
    .attr('id', 'card')
    .on('transitionend', event => {
      // An invisible overlapping card should not intercept the pointer.
      let opacity = $card.css('opacity');
      let pointerEvents = opacity === '0' ? 'none' : '';

      $card.css({ pointerEvents:pointerEvents });
    })
    .appendTo('#field');

  $(game.canvas)
    .attr('id', 'board')
    .appendTo('#field');

  $(window).trigger('resize');

  game
    .on('state-change', event => {
      $('BUTTON[name=pass]').prop('disabled', !game.isMyTurn);
      if (game.state.ended)
        $('BUTTON[name=undo]').hide();
      else
        $('BUTTON[name=undo]').prop('disabled', !game.canUndo());
      toggleReplayButtons();
    })
    .on('selectMode-change', event => {
      let panzoom     = game.panzoom;
      let old_mode    = event.ovalue;
      let new_mode    = event.nvalue;
      let can_move    = game.canSelectMove();
      let can_attack  = game.canSelectAttack();
      let can_turn    = game.canSelectTurn();
      let can_special = game.canSelectSpecial();

      $('BUTTON[name=select]').removeClass('selected');
      $('BUTTON[name=select][value='+new_mode+']').addClass('selected');

      if (new_mode === 'target')
        $('BUTTON[name=select][value=attack]').addClass('selected targeting');
      else if (old_mode === 'target')
        $('BUTTON[name=select][value=attack]').removeClass('targeting');

      if ($('#game-settings').hasClass('active') && game.isMyTurn) {
        $('#game-settings').removeClass('active');
        $('#game-play').addClass('active');
      }

      $('BUTTON[name=select][value=move]').prop('disabled', !can_move);
      $('BUTTON[name=select][value=attack]').prop('disabled', !can_attack);
      $('BUTTON[name=select][value=turn]').prop('disabled', !can_turn);

      if (new_mode === 'attack' && can_special)
        $('BUTTON[name=select][value=attack]').addClass('ready');
      else
        $('BUTTON[name=select][value=attack]').removeClass('ready');

      if (new_mode === 'turn' && panzoom.canZoom() && game.selected && !game.viewed)
        $('BUTTON[name=select][value=turn]').addClass('ready');
      else
        $('BUTTON[name=select][value=turn]').removeClass('ready');

      if (new_mode === 'ready')
        $('BUTTON[name=pass]').addClass('ready');
      else
        $('BUTTON[name=pass]').removeClass('ready');
    })
    .on('card-change', event => {
      // Update the pointer once the card finishes (dis)appearing.
      $card.one('transitionend', event => {
        game.card.updatePointer();
      });

      if (event.nvalue && event.ovalue === null)
        $card.addClass('show');
      else if (event.nvalue === null)
        $card.removeClass('show');
    })
    .on('lock-change', event => {
      if (event.nvalue === 'gameover')
        $('BUTTON[name=undo]').hide();

      $('#app').removeClass('readonly gameover');
      if (event.nvalue === 'readonly' || event.nvalue === 'gameover')
        $('#app').addClass(event.nvalue);

      if (event.nvalue)
        $('#app').addClass('locked');
      else
        $('#app').removeClass('locked');
    })
    .on('timeout', () => {
      timeoutPopup = popup({
        title: "Time's up!",
        message: 'The turn time limit has been reached.  You can continue to wait or force surrender.',
        onClose: () => {
          timeoutPopup = null;
        },
        buttons: [
          { label:'Wait' },
          {
            label: 'Force Surrender',
            onClick: () => game.forceSurrender(),
          },
        ],
        minWidth: '250px',
        zIndex: 10,
      });
    })
    .on('cancelTimeout', () => {
      if (timeoutPopup)
        timeoutPopup.close();
    })
    .on('resetTimeout', () => setTurnTimeoutClock())
    .on('undoRequest', ({ data:request }) => updateUndoDialog(request.status === 'pending'))
    .on('undoAccept', () => updateUndoDialog())
    .on('undoReject', () => updateUndoDialog())
    .on('undoCancel', () => updateUndoDialog())
    .on('undoComplete', hideUndoDialog)
    .on('startSync', () => {
      $('BUTTON[name=play]').hide();
      $('BUTTON[name=pause]').show();
      setHistoryState();
      toggleReplayButtons();
      setCursorAlert();
    })
    .on('endSync', () => {
      $('BUTTON[name=play]').show();
      $('BUTTON[name=pause]').hide();
      setHistoryState();
      toggleReplayButtons();
      setCursorAlert();
    })
    .on('startReplay', () => {
      setCursorAlert();
      setTurnTimeoutClock();
    })
    .on('endReplay', () => {
      setCursorAlert();
      setTurnTimeoutClock();
    })
    .on('cursor-change', () => {
      setHistoryState();
      setCursorAlert();
      toggleReplayButtons();
    });

  await game.start();

  resetPlayerBanners();
  updateChatButton();
  progress.hide();
  $('#app').addClass('show');

  // Just in case a smart user changes the URL manually
  window.addEventListener('hashchange', () => buttons.replay());

  if (location.hash)
    await buttons.replay();
  else if (game.isMyTurn)
    game.play(-game.teams.length);
  else
    game.play(-1);
}

function updateUndoDialog(createIfNeeded = false) {
  if (game.isViewOnly)
    return;

  if (!undoPopup && !createIfNeeded) {
    // When a request is rejected, the undo button becomes disabled.
    $('BUTTON[name=undo]').prop('disabled', !game.canUndo());
    return;
  }

  let undoRequest = game.state.undoRequest;
  // Was undo cancelled before we got an update?
  if (!undoRequest)
    return hideUndoDialog();

  let teams = game.teams;
  let myTeam = game.myTeam;
  let requestor = teams[undoRequest.teamId];
  let popupData = {
    buttons: [],
    onClose: () => {
      // When a request is rejected, the undo button becomes disabled.
      $('BUTTON[name=undo]').prop('disabled', !game.canUndo());

      undoPopup = null;
    },
  };

  if (game.hasOneLocalTeam(undoRequest.teamId))
    popupData.title = `Your Undo Request`;
  else if (teams.filter(t => t.name === requestor.name).length > 1)
    popupData.title = `Undo Request By ${requestor.color}`;
  else
    popupData.title = `Undo Request By ${requestor.name}`;

  if (undoRequest.status !== 'pending') {
    if (undoRequest.status === 'rejected') {
      let rejector = teams.find(t => t.playerId === undoRequest.rejectedBy);

      popupData.message = `Request rejected by ${rejector.name}.`;
    }
    else if (undoRequest.status === 'cancelled')
      popupData.message = `The request was cancelled.`;

    popupData.buttons.push({ label:'Ok' });
  }
  else {
    popupData.closeOnCancel = false;

    if (game.isMyTeam(undoRequest.teamId)) {
      popupData.message = `Waiting for approval.`;
      popupData.buttons.push({
        label: 'Cancel',
        onClick: () => game.cancelUndo(),
      });
    }
    else if (undoRequest.accepts.has(myTeam.id)) {
      popupData.message = `Approval sent.  Waiting for others.`;
      popupData.buttons.push({
        label: 'Withdraw Approval',
        onClick: () => game.rejectUndo(),
      });
    }
    else {
      popupData.message = `Do you approve?`;
      popupData.buttons.push({
        label: 'Yes',
        onClick: () => game.acceptUndo(),
      });
      popupData.buttons.push({
        label: 'No',
        onClick: () => game.rejectUndo(),
      });
    }
  }

  popupData.zIndex = 20;

  if (undoPopup)
    undoPopup.update(popupData);
  else
    undoPopup = popup(popupData);
}

function hideUndoDialog() {
  if (undoPopup)
    undoPopup.close();
}

function setHistoryState() {
  let url = '';
  if (!game.isSynced)
    url = `#c=${game.turnId + 1},${game.nextActionId}`;

  if (url !== location.hash) {
    if (url === '')
      url = ' ';

    history.replaceState(null, document.title, url);
  }
}

function toggleReplayButtons() {
  let cursor = game.cursor;
  let isSynced = game.isSynced;
  let atStart = isSynced || cursor.atStart;
  let atCurrent = isSynced || cursor.atCurrent;

  $('BUTTON[name=start]').prop('disabled', atStart);
  $('BUTTON[name=back]').prop('disabled', atStart);

  $('BUTTON[name=forward]').prop('disabled', atCurrent);
  $('BUTTON[name=end]').prop('disabled', atCurrent);
}

function setCursorAlert() {
  let $alert = $('#cursor');

  if (!game.inReplay)
    return $alert.remove();

  if ($alert.length === 0) {
    $alert = $(`
      <DIV id="cursor" class="alert clickable">
        <SPAN class="fa fa-share"></SPAN>
        <SPAN class="label"></SPAN>
      </DIV>
    `).appendTo('#field');

    $alert.on('click', () => buttons.share());
  }

  let label = `Turn ${game.turnId + 1} / ${game.nextActionId}`;
  $alert.find('.label').text(label);
}
