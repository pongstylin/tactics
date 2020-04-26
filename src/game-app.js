import popup from 'components/popup.js';
import copy from 'components/copy.js';
import share from 'components/share.js';

const ServerError = Tactics.ServerError;
const authClient = Tactics.authClient;
const gameClient = Tactics.gameClient;
const chatClient = Tactics.chatClient;

var progress;
var gameId = location.search.slice(1).replace(/[&=].*$/, '');
var game;
var lastSeenEventId;
var chatMessages = [];
var undoPopup;
var timeoutPopup;
var pointer;
var fullscreen = Tactics.fullscreen;
var readySpecial;

var buttons = {
  home: () => {
    location.href = '/online.html';
  },
  swapbar: () => {
    var $active = $('#game > .buttons.active');
    var $next = $active.next('.buttons');

    if (!$next.length)
      $next = $('#game > .buttons').first();

    $active.removeClass('active');
    $next.addClass('active');
  },
  resize:fullscreen.toggle,
  movebar: $button => {
    $('#app').toggleClass('left right');
    $button.toggleClass('fa-rotate-270 fa-rotate-90');
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
  sound: $button => {
    $button.toggleClass('fa-bell fa-bell-slash');

    Howler.mute($button.hasClass('fa-bell-slash'));
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

      // Sometimes this bubbles up from the #chat
      $app.one('transitionend', () => {
        cancelAnimationFrame(tickRequest);
        $app.toggleClass('chat-open chat-closing');
        updateChatButton();
      });

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
      // Sometimes this bubbles up from the #chat
      $app.one('transitionend', () => {
        $app.toggleClass('chat-open chat-opening');
        updateChatButton();
      });

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
};

$(() => {
  progress = new Tactics.Progress();
  progress.message = 'Loading game...';
  progress.show();

  if ('ontouchstart' in window)
    $('body').addClass(pointer = 'touch');
  else
    $('body').addClass(pointer = 'mouse');

  if (pointer === 'touch')
    $('.new-message').attr('placeholder', 'Touch to chat!');
  else
    $('.new-message').attr('placeholder', 'Type to chat!');

  if (!fullscreen.isAvailable())
    $('BUTTON[name=resize]').toggleClass('hidden');

  if (Howler.noAudio)
    $('BUTTON[name=sound]').toggleClass('hidden');

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
    .on('click', '#app BUTTON:enabled', event => {
      let $button = $(event.target);
      let handler = $button.data('handler') || buttons[$button.attr('name')];
      if (!handler) return;

      // Ignore disabled buttons
      if (window.getComputedStyle(event.target).cursor !== 'pointer')
        return;

      handler($button);

      Tactics.playSound('select');
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
      else if ($app.is('.with-popupChat:not(.chat-open)'))
        return buttons.chat();

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

  let $resize = $('BUTTON[name=resize]');
  if (fullscreen.isEnabled() !== $resize.hasClass('fa-compress'))
    $resize.toggleClass('fa-expand fa-compress');

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

function initGame() {
  return getGameData(gameId)
    .then(gameData => {
      // An account is not required to view an ended game.
      if (gameData.state.ended)
        return loadTransportAndGame(gameId, gameData);

      // No account?  Provide a name before joining/watching!
      if (!authClient.token)
        return showJoinIntro(gameData);

      // Account exists and game started?  Immediately start watching!
      if (gameData.state.started)
        return loadTransportAndGame(gameId, gameData);

      let hasJoined = gameData.state.teams.find(t => t && t.playerId === authClient.playerId);
      if (hasJoined)
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
  let gameType = await gameClient.getGameType(gameState.type);
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
  renderShareLink(gameData.id, document.querySelector('#public .shareLink'));

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
  renderShareLink(gameData.id, document.querySelector('#private .shareLink'));

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
function renderShareLink(gameId, container) {
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
    else {
      copy(link);
      popup({ message:'Copied the game link.  Paste the link to invite using your app of choice.' });
    }
  });
}

async function showJoinIntro(gameData) {
  document.body.addEventListener('focus', event => {
    let target = event.target;
    if (target.matches('INPUT[name=playerName]'))
      target.select();
  }, true);
  document.body.addEventListener('blur', event => {
    let target = event.target;
    if (target.matches('INPUT[name=playerName]'))
      // Clear selection
      target.value = target.value;
  }, true);
  document.body.addEventListener('keydown', event => {
    let target = event.target;
    if (target.matches('INPUT[name=playerName]'))
      if (event.keyCode === 13)
        event.target.blur();
  }, true);
  document.body.addEventListener('input', event => {
    let target = event.target;
    if (target.matches('INPUT[name=playerName]')) {
      let inputTextAutosave = event.target.parentElement;
      inputTextAutosave.classList.remove('is-saved');
      inputTextAutosave.classList.remove('is-saving');
    }
  }, true);

  let divPlayerAutoSave = document.querySelector('.playerName');
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

  let details = document.querySelector('.details');
  let challenge = document.querySelector('.challenge');
  let btnJoin = document.querySelector('BUTTON[name=join]');

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

    let gameType = await gameClient.getGameType(gameData.state.type);
    let person;
    if (gameData.state.randomFirstTurn)
      person = 'random';
    else if (creatorTeam.originalId === 0)
      person = creatorTeam.name;
    else
      person = 'you';

    details.innerHTML = `
      <DIV>This is a <I>${gameType.name}</I> game.</DIV>
      <DIV>The first person to move is ${person}.</DIV>
    `;

    if (gameType.isCustomizable) {
      $('#join .set').show();

      let hasCustomSet = authClient.token && await gameClient.hasCustomPlayerSet(gameType.id);
      if (hasCustomSet)
        $('#join INPUT[name=set][value=mine]').prop('checked', true);
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

        if (await Tactics.setup(gameType))
          $('#join INPUT[name=set][value=mine]').prop('checked', true);
        $('#join').show();
      });
    }

    return new Promise((resolve, reject) => {
      btnJoin.addEventListener('click', async event => {
        let set = $('#join INPUT[name=set]:checked').val();

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
}

function startGame() {
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
    .on('startTurn', event => {
      $('BUTTON[name=pass]').prop('disabled', !game.isMyTurn);
      $('BUTTON[name=undo]').prop('disabled', !game.canUndo());
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

      if (!$('#game-play').hasClass('active')) {
        $('.buttons').removeClass('active');
        $('#game-play').addClass('active');
      }

      $('BUTTON[name=select][value=move]').prop('disabled', !can_move);
      $('BUTTON[name=select][value=attack]').prop('disabled', !can_attack);
      $('BUTTON[name=select][value=turn]').prop('disabled', !can_turn);
      $('BUTTON[name=pass]').prop('disabled', !game.isMyTurn);
      $('BUTTON[name=undo]').prop('disabled', !game.canUndo());

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
    .on('undoRequest', ({ data:request }) => updateUndoDialog(request.status === 'pending'))
    .on('undoAccept', () => updateUndoDialog())
    .on('undoReject', () => updateUndoDialog())
    .on('undoCancel', () => updateUndoDialog())
    .on('undoComplete', hideUndoDialog);

  game.start().then(() => {
    resetPlayerBanners();

    $('BUTTON[name=pass]').prop('disabled', !game.isMyTurn);
    $('BUTTON[name=undo]').prop('disabled', !game.canUndo());

    progress.hide();
    $('#app').addClass('show');
    updateChatButton();
  });
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
