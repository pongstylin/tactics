import { gameConfig } from 'config/client.js';
import Autosave from 'components/Autosave.js';
import copy from 'components/copy.js';
import share from 'components/share.js';
import tappable from 'components/tappable.js';
import wakelock from 'components/wakelock.js';
import GameSettingsModal from 'components/Modal/GameSettings.js';
import PlayerActivityModal from 'components/Modal/PlayerActivity.js';
import PlayerInfoModal from 'components/Modal/PlayerInfo.js';
import PlayerInfoSelfModal from 'components/Modal/PlayerInfoSelf.js';
import ConfigureGame from 'components/Modal/ConfigureGame.js';
import sleep from 'utils/sleep.js';

const ServerError = Tactics.ServerError;
const authClient = Tactics.authClient;
const gameClient = Tactics.gameClient;
const chatClient = Tactics.chatClient;
const popup = Tactics.popup;

var settings;
var playerInfo;
var progress;
var gameId = location.search.slice(1).replace(/[&=].*$/, '');
var gameType;
var transport;
var game;
var muted;
var lastSeenEventId;
var chatMessages = [];
var playerRequestPopup;
var timeoutPopup;
var pointer;
var turnTimeout;

var buttons = {
  home: () => {
    location.href = '/online.html';
  },
  settings: () => {
    settings.show();
  },
  replay: async () => {
    const $app = $('#app');
    if ($app.hasClass('chat-open'))
      buttons.chat();

    let turnId = 0;
    let nextActionId = 0;
    let skipPassedTurns = 'back';

    const hash = location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.slice(1));

      if (params.has('c')) {
        const cursor = params.get('c').split(',');

        turnId = (parseInt(cursor[0]) || 1) - 1;
        nextActionId = parseInt(cursor[1]) || 0;
        skipPassedTurns = false;
      }
    }

    $('#game-play').removeClass('active');
    $('#game-settings').removeClass('active').css({ display:'none' });
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
      } else {
        let opponents = game.teams
          .map(t => t.name)
          .join(' vs ');

        message = `${opponents} @ ${gameType.name}, ${turnPart}`;
      }
    } else {
      if (players.size === 1) {
        if (myTeam) {
          message = `Watch my ${gameType.name} practice game.`;
        } else {
          myTeam = game.teams[0];

          message = `Watch ${gameType.name} practice game by ${myTeam.name}.`;
        }
      } else {
        if (myTeam) {
          let opponents = game.teams
            .filter(t => t.playerId !== myTeam.playerId)
            .map(t => t.name)
            .join(' and ');

          message = `Watch my ${gameType.name} game against ${opponents}.`;
        } else {
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
    else {
      copy(`${message} ${link}`);
      popup({ message:'Copied the game link.  Paste the link to share using your app of choice.' });
    }
  },
  rotate: () => {
    game.rotateBoard(90);

    updateRotateButton();
    resetPlayerBanners();
  },
  undo: () => {
    const sendingPopup = popup({
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
            message += `<DIV>Reason: ${error.message}</DIV>`;
          else if (error.code === 500)
            message += `<DIV>Reason: ${error.message}</DIV>`;
        }

        popup(message);
      });
  },
  select: $button => {
    const $app = $('#app');
    if ($app.hasClass('chat-open'))
      buttons.chat();

    const mode = $button.val();

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
    if (game.isLocalGame)
      popup({
        message: `End your single player game?`,
        buttons: [
          {
            label: 'Yes',
            onClick: () => game.surrender(),
          },
          {
            label: 'No',
          },
        ],
        margin: '16px',
      });
    else if (!game.isMyTurn && !game.turnTimeRemaining)
      popup({
        message: 'Force your opponent to surrender?',
        buttons: [
          {
            label: 'Yes',
            onClick: () => game.forceSurrender(),
          },
          {
            label: 'No',
          },
        ],
        margin: '16px',
      });
    else if (game.state.undoMode === 'loose')
      popup({
        message: `Do you surrender this practice game?  It won't affect your stats.`,
        buttons: [
          {
            label: 'Yes',
            onClick: () => game.surrender(),
          },
          {
            label: 'No',
          },
        ],
        maxWidth: '320px',
        margin: '16px',
      });
    else if (game.canTruce())
      popup({
        message: [
          `If you and your opponent agree to a truce, then this game won't affect your stats.  `,
          `Otherwise, you can surrender.`,
        ].join(''),
        buttons: [
          {
            label: 'Offer Truce',
            onClick: () => game.truce(),
          },
          {
            label: 'Surrender',
            onClick: () => game.surrender(),
          },
          {
            label: 'Cancel',
          },
        ],
        maxWidth: '320px',
        margin: '16px',
      });
    else
      popup({
        message: `A truce has been rejected.  So, do you surrender?`,
        buttons: [
          {
            label: 'Surrender',
            onClick: () => game.surrender(),
          },
          {
            label: 'Cancel',
          },
        ],
        maxWidth: '250px',
        margin: '16px',
      });
  },
  chat: () => {
    let $app = $('#app');
    if ($app.hasClass('for-practice') || $app.hasClass('chat-opening') || $app.hasClass('chat-closing'))
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
      } else {
        $app.addClass('chat-closing');
      }

      tick();
    } else {
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
    wakelock.enable();

    $('#game').toggleClass('is-busy');
    if (game.cursor.atEnd)
      game.play(0);
    else
      game.play();
    $('#game').toggleClass('is-busy');
  },
  pause: async () => {
    $('#game').toggleClass('is-busy');
    await game.pause(true);
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
  fork: async () => {
    await authClient.requireAuth();

    new ConfigureGame({ autoShow:false }).show('forkGame', { game });
  },
  resume: async () => {
    wakelock.toggle(!game.state.endedAt);

    $('#game').toggleClass('is-busy');
    await game.resume();
    $('#game').toggleClass('is-busy');

    $('#game-replay').removeClass('active');
    $('#game-settings').addClass('active').css({ display:'' });
  },
};

$(() => {
  progress = new Tactics.Progress();
  progress.message = 'Loading game...';
  progress.show();

  tappable('BUTTON');

  if ('ontouchstart' in window)
    $('body').addClass(pointer = 'touch');
  else
    $('body').addClass(pointer = 'mouse');

  $('BODY')
    .on('click', '#field .player .link', event => {
      const $link = $(event.currentTarget);
      const team = $link.closest('.player').data('team');
      
      if ($link.hasClass('status')) {
        new PlayerActivityModal({ game, team });
      } else if (team.playerId !== authClient.playerId) {
        playerInfo = new PlayerInfoModal(
          { game, gameType, team },
          { onClose: () => playerInfo = null }
        );
      } else {
        new PlayerInfoSelfModal(
          { game, gameType, team },
        );
      }
    })
    .on('mouseover', '#app BUTTON:enabled', event => {
      const $button = $(event.target);

      // Ignore disabled buttons
      if (window.getComputedStyle(event.target).cursor !== 'pointer')
        return;

      Tactics.playSound('focus');
    })
    .on('click', '#app #alert', async event => {
      const $alert = $(event.target).closest('#alert');
      const handler = $alert.data('handler');
      if (!handler)
        return;

      handler();
    })
    .on('click', '#app BUTTON:enabled', async event => {
      const $button = $(event.target);
      const handler = $button.data('handler') || buttons[$button.attr('name')];
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
      const $app = $('#app');
      const $chat = $('#chat');
      const $messages = $chat.find('#messages');
      const $newMessage = $chat.find('.new-message');
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
        } else if (keyChar === 'ArrowDown') {
          event.preventDefault();
          $messages.scrollTop($messages.scrollTop() + 18);
        } else if (keyChar === 'PageUp') {
          event.preventDefault();
          $messages.scrollTop($messages.scrollTop() - 90);
        } else if (keyChar === 'PageDown') {
          event.preventDefault();
          $messages.scrollTop($messages.scrollTop() + 90);
        }
      }

      if (keyChar === 'Enter') {
        // Disallow line breaks.
        event.preventDefault();

        if (!$newMessage.is(':focus'))
          return $newMessage[0].focus({ preventScroll:true });

        const message = $newMessage.val().trim();
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
      } else if (keyChar === 'Escape') {
        if ($app.hasClass('chat-open')) {
          $newMessage.blur();
          buttons.chat();
        }
      } else if (
        // Any normal character
        keyChar.length === 1 &&
        // Ignore control sequences (e.g. Ctrl+C)
        !event.ctrlKey &&
        !$newMessage.is(':focus')
      ) {
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
    const $messages = $('#messages');

    if (event.propertyName === 'height')
      $messages.scrollTop($messages.prop('scrollHeight'));
  });

  // It takes some JS-work to base a TEXTAREA's height on its content.
  $('TEXTAREA')
    .on('input', async event => {
      const $chat = $('#chat');
      const $messages = $chat.find('#messages');
      const $newMessage = $chat.find('.new-message');

      if ($newMessage.data('submit')) {
        const value = $newMessage.val().trim();

        await chatClient.postMessage(gameId, value);
        $newMessage.val('').removeData('submit');
      } else if ($newMessage.val().includes('\n')) {
        const value = $newMessage.val().trim().replace(/\n/g, '');

        if (value.length) {
          await chatClient.postMessage(gameId, value);
          $newMessage.val('');
        } else
          $newMessage.val(value);
      }

      const newMessage = $newMessage.get(0);
      newMessage.style.height = 'auto';
      const style = window.getComputedStyle(newMessage);
      const paddingHeight = parseInt(style.paddingTop) + parseInt(style.paddingBottom);

      let height = newMessage.scrollHeight;
      if (style.boxSizing === 'content-box') {
        height -= paddingHeight;
        // The initial height can be computed as zero in some cases (flexbox?)
        height = Math.max(height, 18);
      } else {
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
  const chatMode = $('#app').hasClass('chat-open');
  $('#app').removeClass('chat-open with-inlineChat');

  game.resize();

  const bodyHeight = $('BODY').prop('clientHeight');
  const appHeight = $('#board').prop('clientHeight') + 106;
  $('#app').toggleClass('with-inlineChat', appHeight <= bodyHeight);
  $('#app').toggleClass('with-popupChat', appHeight > bodyHeight);
  if (chatMode) $('#app').addClass('chat-open');

  // Useful for orientation changes
  $('#messages').scrollTop($('#messages').prop('scrollHeight'));
  $('#chat .new-message').trigger('input');

  setTimeout(updateChatButton);
});

async function initGame() {
  // Authenticate first, if possible, so that the server knows what information to return.
  await authClient.whenReady;
  if (authClient.token)
    await gameClient.whenAuthorized;

  return getGameData(gameId)
    .then(async gameData => {
      gameType = await gameClient.getGameType(gameData.state.type);

      // An account is not required to view an ended game.
      if (gameData.state.recentTurns?.last.actions.last?.type === 'endGame')
        return loadTransportAndGame(gameId, gameData);

      // An account is required before joining or watching an active game.
      await authClient.requireAuth();

      // Account exists and game started?  Immediately start watching!
      if (gameData.state.startedAt)
        return loadTransportAndGame(gameId, gameData);

      const teams = gameData.state.teams;
      const isParticipant = teams.filter(t => t?.playerId === authClient.playerId);
      const hasJoined = teams.filter(t => t?.playerId === authClient.playerId && t.joinedAt);
      const hasOpenSlot = teams.filter(t => !t?.playerId);
      if (isParticipant.length === teams.length)
        return showPracticeIntro(gameData);
      else if (hasJoined.length)
        if (gameData.collection)
          return showPublicIntro(gameData);
        else
          return showPrivateIntro(gameData);
      else if (isParticipant.length || hasOpenSlot.length)
        if (gameData.forkOf)
          return showJoinFork(gameData);
        else
          return showJoinIntro(gameData);
      else
        return popup({
          message: `Sorry!  This game hasn't started yet and is reserved for someone else.`,
          buttons: [
            { label:'Back', closeOnClick:false, onClick:() => history.back() },
          ],
          maxWidth: '250px',
          closeOnCancel: false,
        }).whenClosed;
    })
    .then(async g => {
      game = g;
      game.id = gameId;

      settings = new GameSettingsModal(
        { game, gameType },
        {
          autoShow: false,
          hideOnCancel: true,
        },
      );

      if (game.isViewOnly)
        $('#app').addClass('for-viewing');
      else if (game.hasOneLocalTeam()) {
        $('#app').addClass('for-playing');

        let players, events;
        while (!players) {
          try {
            ({ players, events, muted } = await chatClient.joinChat(gameId));
          } catch (error) {
            // Retry after a connection reset
            if (error !== 'Connection reset')
              throw error;
          }
        }

        const groupId = `/rooms/${gameId}`;
        const playerId = authClient.playerId;

        const opponentName = game.teams.find(t => t.playerId !== playerId).name;
        document.title = `Tactics vs ${opponentName}`;

        /*
         * Don't listen to 'open' event until the chat has been joined to avoid
         * race conditions where we might try to join chat twice in one session.
         */
        chatClient
          .on('open', async ({ data }) => {
            if (data.reason === 'resume') return;

            const resume = {
              id: chatMessages.length ? chatMessages.last.id : null,
            };

            try {
              const { events } = await chatClient.joinChat(gameId, resume);

              appendMessages(events.filter(e => e.type === 'message'));
            } catch (error) {
              // Ignore connection resets since we'll try again with the next 'open'
              if (error !== 'Connection reset')
                throw error;
            }
          })
          .on('event', event => {
            if (event.body.group !== groupId) return;

            if (event.body.type === 'message') {
              const message = event.body.data;
              appendMessages(message);
            } else if (event.body.type === 'muted') {
              const playerId = event.body.data.playerId;
              const playerMuted = event.body.data.muted;

              muted.set(playerId, playerMuted);
              // If the player info dialog is open and someone else has changed
              // their mute/block preferences, then refresh the dialog content.
              if (playerInfo)
                playerInfo.getPlayerInfo();
              resetChatStatus(playerId);
            }
          });

        lastSeenEventId = players.find(p => p.id === playerId).lastSeenEventId;

        resetChatStatus();
        initMessages(events.filter(e => e.type === 'message'));
      } else {
        $('#app').addClass('for-practice');
        document.title = `Tactics Practice`;
      }

      startGame();
    })
    .catch(error => {
      if (error === 'Connection reset')
        return initGame();

      if (error.code === 403 || error.code === 409)
        $('#error').text(error.message);
      else if (error.code === 404)
        $('#error').text('The game doesn\'t exist');
      else if (error.code === 422)
        $('#error').text('Invalid game link');
      else if (error.code === 429)
        $('#error').text('Loading games too quickly');

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
async function joinGame(gameId, name, set, randomSide) {
  return gameClient.joinGame(gameId, { name, set, randomSide }).catch(error => {
    if (error.code !== 404 && error.code !== 409 && error.code !== 412) throw error;

    if (error.code === 404)
      return new Promise(resolve => {
        popup({
          message: 'Oops!  The game expired or was cancelled.',
          buttons: [
            { label:'Back', closeOnClick:false, onClick:() => history.back() },
          ],
          maxWidth: '250px',
          closeOnCancel: false,
        });
      });
    else if (error.code === 412)
      return new Promise(resolve => {
        popup({
          message: error.message,
          buttons: [
            { label:'Back', closeOnClick:false, onClick:() => history.back() },
            { label:'Reload', closeOnClick:false, onClick:() => location.reload() },
          ],
          maxWidth: '250px',
          closeOnCancel: false,
        });
      });
    else if (error.message === 'Too many pending games for this collection')
      return new Promise(resolve => {
        popup({
          message: 'Sorry!  You have too many open games.',
          buttons: [
            { label:'Back', closeOnClick:false, onClick:() => history.back() },
            { label:'Reload', closeOnClick:false, onClick:() => location.reload() },
          ],
          maxWidth: '250px',
          closeOnCancel: false,
        });
      });
    else
      return new Promise(resolve => {
        popup({
          message: 'Oops!  Somebody else joined the game first.',
          buttons: [
            { label:'Back', closeOnClick:false, onClick:() => history.back() },
            { label:'Watch', onClick:resolve },
          ],
          maxWidth: '250px',
          closeOnCancel: false,
        });
      });
  });
}
async function loadTransportAndGame(gameId, gameData) {
  return loadGame(await loadTransport(gameId, gameData));
}
// Must be authorized first or the game already ended
async function loadTransport(gameId, gameData) {
  transport = new Tactics.RemoteTransport(gameId, gameData);
  await transport.whenReady;

  return transport;
}
async function loadGame(transport) {
  await loadResources(transport);

  return new Tactics.Game(transport, authClient.playerId ?? false).init();
}
async function loadResources(gameState) {
  const unitTypes = gameType.getUnitTypes();

  // If the user will see the game immediately after the resources are loaded,
  // then require a tap to make sure sound effects work.
  const requireTap = gameState.endedAt || authClient.token && gameState.startedAt;

  return new Promise(resolve => {
    progress
      .on('complete', () => {
        const core = Tactics.getSprite('core');

        $('BUTTON[name=select][value=move]')
          .css({ backgroundImage:`url('${core.getImage('move').src}')` });
        $('BUTTON[name=select][value=attack]')
          .css({ backgroundImage:`url('${core.getImage('attack').src}')` });
        $('BUTTON[name=select][value=turn]')
          .css({ backgroundImage:`url('${core.getImage('turn').src}')` });
        $('BUTTON[name=pass]')
          .css({ backgroundImage:`url('${core.getImage('pass').src}')` });
        $('BUTTON[name=surrender]')
          .css({ backgroundImage:`url('${core.getImage('surrender').src}')` });

        if (!requireTap) return resolve();

        const tapHandler = async () => {
          wakelock.toggle(!gameState.endedAt && !location.hash);

          progress.disableButtonMode(tapHandler);
          progress.message = 'One moment...';
          await sleep(200);

          resolve();
        };
        progress.enableButtonMode(tapHandler);

        const action = pointer === 'mouse' ? 'Click' : 'Tap';
        if (gameState.endedAt)
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
    }).catch(error => {
      progress.message = 'Loading failed!';
      throw error;
    });
  });
}

function resetChatStatus(playerId) {
  /*
   * Chat is disabled if:
   *   I muted all other participants in the chat and/or...
   *   All other participants in the chat muted me.
   */
  const myPlayerId = authClient.playerId;
  const myMuted = muted.get(myPlayerId);
  let disabled = true;
  for (const [ playerId, playerMuted ] of muted) {
    if (playerId === myPlayerId) continue;
    if (myMuted.has(playerId)) continue;
    if (playerMuted.has(myPlayerId)) continue;

    disabled = false;
    break;
  }

  const $newMessage = $('#chat .new-message').prop('disabled', disabled);
  if (disabled) {
    $newMessage.attr('placeholder', 'Chat disabled!');
  } else {
    if (pointer === 'touch')
      $('.new-message').attr('placeholder', 'Touch to chat!');
    else
      $('.new-message').attr('placeholder', 'Type to chat!');
  }

  if (playerId === myPlayerId) {
    for (const playerId of muted.keys()) {
      if (playerId === myPlayerId)
        $(`.message.player-${playerId}`).toggleClass('muted', myMuted.size === muted.size - 1);
      else
        $(`.message.player-${playerId}`).toggleClass('muted', myMuted.has(playerId));
    }
  }
}
function initMessages(messages) {
  if (gameType.notice)
    messages.push({ content:gameType.notice });

  if (game.state.randomHitChance === false)
    messages.push({ content:[
      `This is a <a href="javascript:void(0)" class="info-no-luck">No Luck</a> game.  `,
      `Tap link for more info.`,
    ].join('') });

  if (game.state.undoMode === 'loose')
    messages.push({ content:[
      `This is a <a href="javascript:void(0)" class="info-practice">Practice</a> game.  `,
      `Tap link for more info.`,
    ].join('') });
  else if (!game.state.rated && game.state.unratedReason) {
    let reason;
    switch (game.state.unratedReason) {
      case 'not rated':
        reason = `it was disabled by the game creator`;
        break;
      case 'private':
        reason = `this is a private game`;
        break;
      case 'not verified':
        reason = `both players must be verified`;
        break;
      case 'same identity':
        reason = `both players share the same identity`;
        break;
      case 'in game':
        reason = `the players were already playing a rated game against each other in this style`;
        break;
      case 'too many games':
        reason = `the players have 2 rated games against each other in this style within the past week`;
        break;
      case 'truce':
        reason = `the game ended in a truce`;
        break;
      case 'unseen':
        reason = `the loser didn't open the game in time`;
        break;
      case 'old':
        reason = `it predated rankings release`;
        break;
      default:
        reason = `of a bug`;
    }

    messages.push({ class:'rated', content:[
      `This is <span style="color:red">NOT</span> a <a href="javascript:void(0)" class="info-rated">Rated</a> game `,
      `because ${reason}.`,
    ].join('') });
  }

  chatMessages = messages;
  messages.forEach(m => renderMessage(m));

  const $messages = $('#messages');
  $messages.scrollTop($messages.prop('scrollHeight'));

  $messages.on('click', event => {
    if (event.target.classList.contains('info-no-luck'))
      popup({ message:`
        <P style="margin:0 0 8px 0">
          Normally, hits and blocks are determined by random chance.
          When creating a game, you can enable No Luck mode to make hits and blocks more predictable.
          You can tell whether a unit will block by looking at the shield icons in the unit card.
        </P>
        <UL style="margin: 0 0 0 24px">
          <LI>A unit with 50%+ blocking will block front attacks.</LI>
          <LI>A unit with 100%+ blocking will also block side attacks.</LI>
          <LI>A unit with 1.5x blocking will block front attacks.</LI>
          <LI>A unit with 2x blocking will also block side attacks.</LI>
        </UL>
        <P>
          The 1.5x and 2x blocking rules can be confusing.  It means that even units with low blocking
          will block front temporarily after being hit and will block side after being hit twice in quick
          succession.  The unit's info card will tell you how long the unit will remain protected.
        </P>
      `, maxWidth:'400px' });
    else if (event.target.classList.contains('info-practice'))
      popup({ message:`
        A practice game is a great way to learn especially if you find a helpful partner.  Unlike other
        games, observers can see the latest moves so that they may offer advice.  Your partner can also
        see your moves before your turn ends to further enable collaboration.  Finally, undo rules are
        very relaxed.  There are fewer conditions that require approval and you can revert as many turns
        of game history as exist.  You can even undo after the game ends!  Practice games do not affect
        your stats.
      `, maxWidth:'400px' });
    else if (event.target.classList.contains('info-draw'))
      popup({ message:`
        <P style="margin:0 0 8px 0">
          To avoid never-ending games, there are 2 conditions that can result in a game ending in draw.
          The 1st condition requires both players to take no action for 3 turns each for a total of 6
          turns without action.  The 2nd condition requires both players to not make contact with each
          other for 15 turns each for a total of 30 turns without contact.
        </P>
        <P style="margin:0 0 8px 0">
          The 1st draw condition can surprise you if you use a unit (e.g. a Dragon Tyrant) to move and
          attack with a penalty of 3 turns of recovery.  Your opponent can force a draw by optionally
          using one turn to kill a 2nd unit, if any, then pass 3 times.  If you have no unit to take
          action while waiting for your 1st unit to recover, then the game will end in a draw.
        </P>
        <P style="margin:0 0 8px 0">
          The 2nd draw condition can be avoided by attacking your opponent.  Almost all attacks will
          reset the draw counter including physical, magical, paralysis, poison, and quake attacks.
          However, healing or attacking yourself won't reset it.  Immune attacks won't reset it such
          as Scout shooting enemy Lightning Ward without doing damage or mud quaking a Poison Wisp.
          Also, killing shrubs won't reset it.
        </P>
      `, maxWidth:'500px' });
    else if (event.target.classList.contains('info-rated'))
      popup({ message:`
        <P style="margin:0 0 8px 0">
          Players are ranked according to their style skill ratings.
          You can view a player's ratings and rank by clicking their name in the banner.
          Here are the requirements for playing a rated game.
        </P>
        <UL style="margin: 0 0 0 24px">
          <LI>Only rated public or lobby games affect rankings.</LI>
          <LI>A rated game must be between 2 verified players.</LI>
          <LI>Only 1 rated game per opponent per style at a time.</LI>
          <LI>Only 2 rated games per opponent per style per week.</LI>
          <LI>Game will not affect rating if it ends in a truce.</LI>
          <LI>Game will not affect rating if a player doesn't see it.</LI>
        </UL>
      `, maxWidth:'400px' });
  });
}
function appendMessages(messages) {
  if (!Array.isArray(messages))
    messages = [messages];

  chatMessages.push(...messages);
  messages.forEach(m => renderMessage(m));

  const $messages = $('#messages');
  $messages.scrollTop($messages.prop('scrollHeight'));

  updateChatButton();
}
function renderMessage(message) {
  if (message.player) {
    const myMuted = muted.get(authClient.playerId);
    const playerId = message.player.id;
    const isMuted = myMuted.has(playerId) || myMuted.size === muted.size - 1 ? 'muted' : '';
    let playerName = message.player.name;
    if (game.teams.filter(t => t.name === playerName).length > 1) {
      const team = game.teams.find(t => t.playerId === playerId);
      if (game.isMyTeam(team))
        playerName = '<I>You</I> ';
    }

    const gameUrl = location.origin + location.pathname.slice(0, location.pathname.lastIndexOf('/')) + '/game.html';
    const gameUrlMatch = new RegExp(`${gameUrl}\\?([0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12})`);

    message.content = message.content.replace(gameUrlMatch, '<A href="game.html?$1" target="_blank">Game Link</A>');

    $('#messages').append(`
      <DIV
        class="message player player-${playerId} ${isMuted} ${message.class ?? ''}"
      >
        <SPAN class="player">${playerName}</SPAN>
        <SPAN class="content">${message.content}</SPAN>
      </DIV>
    `);
  } else {
    $('#messages').append(`
      <DIV
        class="message system ${message.class ?? ''}"
        data-json='${JSON.stringify(message.data ?? null)}'
      >
        <SPAN class="content">${message.content}</SPAN>
      </DIV>
    `);
  }
}
function refreshRatedMessage() {
  const reason =
    game.state.unratedReason === 'truce' ? 'the game ended in a truce' :
    game.state.unratedReason === 'unseen' ? `the loser didn't open the game in time` :
    null;

  if (reason) {
    $('#messages .message.rated').remove();
    appendMessages([ { class:'rated', content:[
      `This is <span style="color:red">NOT</span> a <a href="javascript:void(0)" class="info-rated">Rated</a> game `,
      `because ${reason}.`,
    ].join('') } ]);
  }
}
function refreshDrawMessage() {
  const $oldMessage = $('#messages .message.draw');
  const oldDrawCounts = $oldMessage.data('json');

  if (!game.state.startedAt || game.state.endedAt)
    return $oldMessage.remove();

  const drawCounts = game.state.drawCounts;
  if (
    drawCounts?.passedTurnCount === oldDrawCounts?.passedTurnCount &&
    drawCounts?.attackTurnCount === oldDrawCounts?.attackTurnCount
  ) return;

  $oldMessage.remove();

  const forecasts = [];

  if ((drawCounts.passedTurnCount / drawCounts.passedTurnLimit) >= 1/3) {
    const turnsRemaining = drawCounts.passedTurnLimit - drawCounts.passedTurnCount;
    forecasts.push({ turnsRemaining, text:`${turnsRemaining} turns without action` });
  }
  if ((drawCounts.attackTurnCount / drawCounts.attackTurnLimit) >= 1/3) {
    const turnsRemaining = drawCounts.attackTurnLimit - drawCounts.attackTurnCount;
    forecasts.push({ turnsRemaining, text:`${turnsRemaining} turns without contact` });
  }

  forecasts.sort((a,b) => a.turnsRemaining - b.turnsRemaining);

  if (forecasts.length)
    appendMessages([ { class:'draw', data:drawCounts, content:[
      `The game will <a href="javascript:void(0)" class="info-draw">Draw</a> in ${forecasts[0].text}.`,
    ].join('') } ]);
}

function resetPrompts() {
  const divPrompts = document.querySelector('#prompts');

  if (game.state.playerRequest === null)
    divPrompts.innerHTML = '';
  // Used to clear cancelled requests after they become irrelevant (esp. undo requests)
  else if (game.state.playerRequest.turnId <= game.state.lockedTurnId)
    divPrompts.innerHTML = '';

  updateChatButton();
}

async function showPublicIntro(gameData) {
  renderShareLink(gameData, document.querySelector('#public .shareLink'));
  renderCancelButton(gameData.id, document.querySelector('#public .cancelButton'));

  const state = gameData.state;
  const collection = gameData.collection === 'public' ? 'Public' : 'Lobby';
  const mode = state.undoMode === 'loose' ? ' Practice' : state.strictFork ? ' Tournament' : '';
  const $greeting = $('#public .greeting');
  const $subText = $greeting.next();
  const myTeam = state.teams.find(t => t?.playerId === authClient.playerId);
  $greeting.text($greeting.text().replace('{teamName}', myTeam.name));
  $subText.text($subText.text().replace('{vs}', `${collection}${mode}`));

  const transport = await loadTransport(gameData.id);

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

  const state = gameData.state;
  const vs = (
    gameData.forkOf ? 'Fork' :
    state.undoMode === 'loose' ? 'Private Practice' :
    state.strictFork ? 'Private Tournament' : ''
  );
  const $greeting = $('#private .greeting');
  const $subText = $greeting.next();
  const myTeam = state.teams.find(t => t?.playerId === authClient.playerId);
  $greeting.text($greeting.text().replace('{teamName}', myTeam.name));
  $subText.text($subText.text().replace('{vs}', vs));

  const transport = await loadTransport(gameData.id);

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
          onClick: () => transport ? transport.cancel() : gameClient.cancelGame(gameId).then(() => {
            location.href = '/online.html';
          }),
        },
        {
          label: 'No'
        },
      ],
      maxWidth: '250px',
      zIndex: 10,
    });
  });
}

function renderShareLink(gameData, container) {
  let message = `Want to play a ${gameType.name} game`;
  if (gameData.timeLimitName !== 'week')
    message += ` with a ${gameData.timeLimitName.toUpperCase('first')} time limit`;
  if (!gameData.state.randomHitChance)
    message += ' without luck';
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
    else {
      copy(`${message} ${link}`);
      popup({ message:'Copied the game link.  Paste the link to invite using your app of choice.' });
    }
  });
}

async function showPracticeIntro(gameData) {
  renderCancelButton(gameData.id, document.querySelector('#practice .cancelButton'));

  const root = document.body.querySelector('#practice');
  const details = root.querySelector('.details');
  const challenge = root.querySelector('.challenge');
  const btnStart = root.querySelector('BUTTON[name=start]');

  const teamName = new Autosave({
    submitOnChange: true,
    defaultValue: false,
    value: authClient.playerName,
    maxLength: 20,
  }).appendTo(root.querySelector('.teamName'));

  const creatorTeam = gameData.state.teams.find(t => !!t.joinedAt);

  challenge.innerHTML = `Configure your opponent in the practice game.`;

  let person;
  if (gameData.state.randomFirstTurn)
    person = 'random';
  else if (creatorTeam.slot === 0)
    person = creatorTeam.name;
  else
    person = 'this one';

  const blocking = gameData.state.randomHitChance ? 'random' : 'predictable';

  details.innerHTML = `
    <DIV>The game style is <I>${gameType.name}</I>.</DIV>
    <DIV>The first team to move is ${person}.</DIV>
    <DIV>The blocking system is ${blocking}.</DIV>
  `;

  $('#practice .set').show();
  $('#practice .mirror').toggle(!gameType.hasFixedPositions);

  const $mySet = $('#practice INPUT[name=setChoice][value=mySet]');
  const $practice = $('#practice INPUT[name=setChoice][value=practice]');
  const $sets = $('#practice .mySet SELECT');
  const sets = await gameClient.getPlayerSets(gameType.id);

  $mySet.prop('checked', true);

  if (sets.length > 1) {
    $sets.on('change', () => $mySet.prop('checked', true));

    $('#practice .mySet A').on('click', async () => {
      const setOption = $sets.find(`OPTION:checked`)[0];
      const setId = setOption.value;
      const setIndex = sets.findIndex(s => s.id === setId);
      const setBuilder = await Tactics.editSet({
        gameType,
        set: sets[setIndex],
        rotation: gameConfig.oppRotation,
        colorId: gameConfig.oppColorId,
      });
      const newSet = setBuilder.set;

      if (newSet.units.length) {
        sets[setIndex] = newSet;
        setOption.textContent = sets[setIndex].name;
        $mySet.prop('checked', true);
      } else {
        sets.splice(setIndex, 1);
        setOption.style.display = 'none';
        $sets.val('default');
      }
    });

    for (const setId of gameConfig.setsById.keys()) {
      const setOption = $sets.find(`OPTION[value="${setId}"]`)[0];
      const set = sets.find(s => s.id === setId);
      if (set) {
        setOption.style.display = '';
        setOption.textContent = set.name;
      } else
        setOption.style.display = 'none';
    }
  } else {
    $('#practice .mySet').hide();
    $('#practice INPUT[name=setChoice][value=same]').prop('checked', true);
  }

  let practiceSet;
  $('#practice  .practice A').on('click', async () => {
    const setBuilder = await Tactics.editSet({
      gameType,
      set: practiceSet,
      rotation: gameConfig.oppRotation,
      colorId: gameConfig.oppColorId,
    });
    practiceSet = setBuilder.set;

    if (practiceSet.units.length > 0)
      $practice
        .prop('disabled', false)
        .prop('checked', true)
        .closest('LABEL').removeClass('disabled');
    else {
      if ($practice.is(':checked'))
        $mySet.prop('checked', true);

      $practice
        .prop('disabled', true)
        .closest('LABEL').addClass('disabled');
    }
  });

  return new Promise((resolve, reject) => {
    btnStart.addEventListener('click', async event => {
      let set = $('#practice INPUT[name=setChoice]:checked').val();
      if (set === 'mySet')
        set = $sets.val();
      else if (set === 'practice')
        set = practiceSet;

      $('#practice').hide();
      progress.message = 'Starting game...';
      progress.show();

      try {
        await gameClient.joinGame(gameData.id, {
          name: teamName.value,
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
async function showJoinFork(gameData) {
  const root = document.body.querySelector('#fork');
  const details = root.querySelector('.details');
  const challenge = root.querySelector('.challenge');
  const btnJoin = root.querySelector('BUTTON[name=join]');

  const teamName = new Autosave({
    submitOnChange: true,
    defaultValue: false,
    value: authClient.playerName,
    maxLength: 20,
  }).appendTo(root.querySelector('.teamName'));

  const creatorTeam = gameData.state.teams.find(t => !!t.joinedAt);
  const opponentTeam = gameData.state.teams.find(t => !t.joinedAt);
  const forkPlayerIds = new Set(gameData.state.teams.map(t => t.forkOf.playerId));
  const who = forkPlayerIds.has(creatorTeam.playerId) ? 'their' : `another's`;
  let as1;
  let as2;
  let of;

  if (forkPlayerIds.size === 1) {
    const practicePlayerId = [ ...forkPlayerIds ][0];

    as1 = `<I>${creatorTeam.forkOf.name}</I>`;
    as2 = `<I>${opponentTeam.forkOf.name}</I>`;
    of = 'practice game';
  } else {
    as1 =
      creatorTeam.forkOf.playerId === creatorTeam.playerId ? 'themself' :
      creatorTeam.forkOf.playerId === authClient.playerId ? 'you' : `<I>${creatorTeam.forkOf.name}</I>`;
    as2 = authClient.playerId === opponentTeam.forkOf.playerId ? 'yourself' : `<I>${opponentTeam.forkOf.name}</I>`;
    of = 'game';
  }

  challenge.innerHTML = `<I>${creatorTeam.name}</I> is waiting to play as ${as1} in a fork of ${who} ${of}.  Want to play as ${as2}?`;

  let person;
  if (creatorTeam.id === gameData.state.currentTeamId)
    person = `<I>${creatorTeam.name}</I>`;
  else
    person = 'you';

  const blocking = gameData.state.randomHitChance ? 'random' : 'predictable';
  const forkOfURL = `/game.html?${gameData.forkOf.gameId}#c=${gameData.forkOf.turnId + 1},0`;

  details.innerHTML = `
    <DIV>This is a fork of <A href="${forkOfURL}" target="_blank">this ${of} and turn</A>.</DIV>
    <DIV>The game style is <I>${gameType.name}</I>.</DIV>
    <DIV>The time limit is set to ${gameData.timeLimitName.toUpperCase('first')}.</DIV>
    <DIV>The next person to move is ${person}.</DIV>
    <DIV>The blocking system is ${blocking}.</DIV>
  `;

  return new Promise((resolve, reject) => {
    btnJoin.addEventListener('click', async event => {
      $('#fork').hide();
      progress.message = 'Joining game...';
      progress.show();

      try {
        await joinGame(gameData.id, teamName.value);
        progress.message = 'Loading game...';
        resolve(
          await loadTransportAndGame(gameData.id, gameData)
        );
      } catch (error) {
        reject(error);
      }
    });

    progress.hide();
    $('#fork').show();
  });
}
async function showJoinIntro(gameData) {
  const root = document.body.querySelector('#join');
  const details = root.querySelector('.details');
  const challenge = root.querySelector('.challenge');
  const btnJoin = root.querySelector('BUTTON[name=join]');

  const teamName = new Autosave({
    submitOnChange: true,
    defaultValue: false,
    value: authClient.playerName,
    maxLength: 20,
  }).appendTo(root.querySelector('.teamName'));

  if (gameData.state.startedAt) {
    btnJoin.textContent = 'Watch Game';

    return new Promise((resolve, reject) => {
      btnJoin.addEventListener('click', async event => {
        $('#join').hide();
        progress.message = 'Loading game...';
        progress.show();

        try {
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
  } else {
    const creatorTeam = gameData.state.teams.find(t => !!t?.joinedAt);
    const relationship = await authClient.getRelationship(creatorTeam.playerId);

    let isBlocked;
    if (relationship.reverseType === 'blocked')
      isBlocked = `Sorry!  <I>${creatorTeam.name}</I> blocked you from joining their games.`;
    else if (gameData.collection && !relationship.isVerified.get('me') && relationship.acl.get('them').guestAccounts === 'blocked')
      isBlocked = `
        Sorry!  <I>${creatorTeam.name}</I> blocked guests from joining their public and lobby games.
        You can verify your account on your <A href="security.html">Account Security</A> page.
      `;
    else if (gameData.collection && relationship.isNew.get('me') && relationship.acl.get('them').newAccounts === 'blocked')
      isBlocked = `
        Sorry!  <I>${creatorTeam.name}</I> blocked new players from joining their public and lobby games.
        You can try again later or create your own game.
      `;

    if (isBlocked) {
      challenge.innerHTML = isBlocked;
      root.querySelector('.playerSetup').remove();
      details.remove();
      root.querySelector('.set').remove();
      root.querySelector('.buttons').remove();

      progress.hide();
      $('#join').show();
      return new Promise(() => {});
    }

    const message = [];
    if (!relationship.type)
      message.push(`<I>${creatorTeam.name}</I> is waiting for an opponent.  Want to play?`);
    else if (relationship.type === 'friended') {
      if (relationship.name.toLowerCase() === creatorTeam.name.toLowerCase())
        message.push(`<I>${creatorTeam.name}</I> is your friend.`);
      else
        message.push(`<I>${creatorTeam.name}</I> is your friend better known as <I>${relationship.name}</I>.`);
      message.push(`Want to play?`);
    } else if (relationship.type === 'muted') {
      if (relationship.name.toLowerCase() === creatorTeam.name.toLowerCase())
        message.push(`You muted <I>${creatorTeam.name}</I>.`);
      else
        message.push(`You muted <I>${creatorTeam.name}</I> under the name <I>${relationship.name}</I>.`);
      message.push(`But, you can still play!`);
    } else if (relationship.type === 'blocked') {
      if (relationship.name.toLowerCase() === creatorTeam.name.toLowerCase())
        message.push(`You blocked <I>${creatorTeam.name}</I>.`);
      else
        message.push(`You blocked <I>${creatorTeam.name}</I> under the name <I>${relationship.name}</I>.`);
      message.push(`But, you can play if you mute them instead.`);

      btnJoin.textContent = 'Mute and Join Game';
    }
    challenge.innerHTML = message.join('  ');

    const isForkMode = !!gameData.forkOf;
    const isPracticeMode =
      gameData.state.rated === false && gameData.state.undoMode === 'loose';
    const isTournamentMode =
      gameData.state.undoMode === 'strict' && gameData.state.strictFork === true && gameData.state.autoSurrender === true;

    const visibility = !gameData.collection ? 'Private' : gameData.collection.split('/')[0].toUpperCase('first');
    const mode =
      isForkMode ? 'Fork' :
      isPracticeMode ? 'Practice' :
      isTournamentMode ? `${visibility} Tournament` :
      visibility;

    let person;
    if (gameData.state.randomFirstTurn)
      person = 'random';
    else if (creatorTeam.slot === 0)
      person = 'you';
    else
      person = creatorTeam.name;

    const blocking = gameData.state.randomHitChance ? 'random' : 'predictable';
    const rated = gameData.meta.rated ? 'rated' : 'unrated';

    details.innerHTML = [
      `<DIV>This is a ${mode} game.</DIV>`,
      `<DIV>The game style is <I>${gameType.name}</I>.</DIV>`,
      `<DIV>The time limit is set to ${gameData.timeLimitName.toUpperCase('first')}.</DIV>`,
      !isPracticeMode ? '' :
        `<DIV>The first person to move is ${person}.</DIV>`,
      `<DIV>The blocking system is ${blocking}.</DIV>`,
      !gameData.collection && isPracticeMode && isForkMode ? '' :
        `<DIV>The game is ${rated}.</DIV>`,
    ].join('');

    const $mySet = $('#join INPUT[name=setChoice][value=mySet]');
    const $sets = $('#join .mySet SELECT');

    $mySet.prop('checked', true);

    if (gameType.isCustomizable) {
      $('#join .set').show();
      $('#join .mirror').toggle(!gameType.hasFixedPositions);

      const $editSet = $('#join .set A');
      const sets = await gameClient.getPlayerSets(gameType.id);

      if (sets.length === 1)
        $('#join .mySet > div:nth-child(2)').hide();
      else {
        $sets.on('change', () => {
          $mySet.prop('checked', true);
          $editSet.toggle($sets.val() !== 'random');
        });

        for (const setId of gameConfig.setsById.keys()) {
          const setOption = $sets.find(`OPTION[value="${setId}"]`)[0];
          const set = sets.find(s => s.id === setId);
          if (set) {
            setOption.style.display = '';
            setOption.textContent = set.name;
          } else
            setOption.style.display = 'none';
        }

        if (gameConfig.set === 'random') {
          $sets.val('random');
          $editSet.hide();
        }
      }

      $editSet.on('click', async () => {
        $('#join').hide();

        const setOption = $sets.find(`OPTION:checked`)[0];
        const setId = setOption.value;
        const setIndex = sets.findIndex(s => s.id === setId);
        const setBuilder = await Tactics.editSet({
          gameType,
          set: sets[setIndex],
        });
        const newSet = setBuilder.set;

        if (newSet) {
          sets[setIndex] = newSet;
          setOption.textContent = sets[setIndex].name;
          $mySet.prop('checked', true);
        } else {
          sets.splice(setIndex, 1);
          setOption.style.display = 'none';
          $sets.val('default');
        }
        $('#join').show();
      });
    }

    if (gameData.state.undoMode !== 'loose')
      $('#join .mirror, #join .same').hide();

    return new Promise((resolve, reject) => {
      btnJoin.addEventListener('click', async event => {
        const set = $sets.val();

        $('#join').hide();
        progress.message = 'Joining game...';
        progress.show();

        try {
          await joinGame(gameData.id, teamName.value, set, !gameType.hasFixedPositions && gameConfig.randomSide);
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
  const $button = $('BUTTON[name=chat]');
  const playerId = authClient.playerId;

  const divPrompt = document.querySelector('#prompts .prompt');
  if (divPrompt && game.state.playerRequest && game.state.playerRequest.status !== 'cancelled')
    return $button.addClass('ready').attr('badge', '+');

  $button.removeClass('ready').attr('badge', '');

  if (!chatMessages.length) return;

  if ($('#app').is('.show.with-inlineChat, .chat-open')) {
    if (lastSeenEventId < chatMessages.last.id) {
      lastSeenEventId = chatMessages.last.id;

      chatClient.seen(gameId, lastSeenEventId);
    }
  } else {
    if (chatMessages.last.player?.id !== playerId)
      $button.attr('badge', '+');
    else
      $button.attr('badge', '');

    $button.toggleClass('ready', chatMessages.last.id > lastSeenEventId);
  }
}
function updateRotateButton() {
  const board = game.board;
  const myColorId = gameConfig.myColorId;
  const myTeam = game.teams.find(t => t.colorId === myColorId);
  const degree = board.getDegree('N', board.rotation);
  const position = board.getRotation(myTeam.position, degree);

  $('#game BUTTON[name=rotate]')
    .toggleClass('fa-rotate-90', position === 'S')
    .toggleClass('fa-rotate-180', position === 'W')
    .toggleClass('fa-rotate-270', position === 'N');
}
function resetPlayerBanners() {
  const board = game.board;
  const degree = board.getDegree('N', board.rotation);

  $('#field .player').removeClass('show bronze');

  game.state.teams.forEach(team => {
    const isMyTeam = game.isMyTeam(team);
    const position = board.getRotation(team.position, degree);
    const ePlayerId = 'player-'+position.toLowerCase();
    const $player = $('#'+ePlayerId);

    $player
      .addClass('show bronze')
      .data('team', team);

    const playerStatus = game.state.playerStatus.get(team.playerId);
    const showLink = playerStatus !== 'unavailable' && !game.isViewOnly;
    const $status = $player.find('.status')
      .removeClass('offline online active unavailable')
      .addClass(playerStatus.status)
      .toggleClass('mobile', playerStatus.deviceType === 'mobile')
      .toggleClass('link', showLink && !isMyTeam && !game.state.endedAt);
    const $name = $player.find('.name')
      .toggleClass('link', showLink)
      .text(team.name);

    if (team.forkOf) {
      let $fork = $player.find('.fork');
      if (!$fork.length)
        $fork = $('<SPAN>').insertAfter($name).addClass('fork fa fa-code-branch');

      if (!game.ofSinglePlayer) {
        let $forkName = $player.find('.forkName');
        if (!$forkName.length)
          $forkName = $('<SPAN>').insertAfter($fork).addClass('forkName');

        if (team.forkOf.playerId === team.playerId)
          $forkName.html('<I>Me</I>');
        else
          $forkName.text(team.forkOf.name);
      }
    }
  });

  setTurnTimeoutClock();
}
function setTurnTimeoutClock() {
  clearTimeout(turnTimeout);
  turnTimeout = null;

  if (game.inReplay || game.currentTurnTimeLimit === null) {
    $('.clock').css({ display:'none' });
    $('.critical').removeClass('show');
    return;
  } else
    $('.clock').css({ display:'' });

  const timeLimit = game.timeLimit.base;
  const timeout = game.turnTimeRemaining;
  let timeoutClass;
  let removeClass;
  let timeoutText;
  if (timeout > 0) {
    timeoutClass = timeout < timeLimit*1000 * 0.3 ? 'short' : 'long';
    removeClass = timeout < timeLimit*1000 * 0.3 ? 'long' : 'short';
    removeClass += ' expired';

    let tick;
    // If greater than 23 hours, show days
    if (timeout > 82800000) {
      timeoutText = `&lt; ${Math.ceil(timeout / 86400000)}d`;
      tick = (timeout % 86400000) + 250;
    // If greater than 1 hour, show hours
    } else if (timeout > 3600000) {
      timeoutText = `&lt; ${Math.ceil(timeout / 3600000)}h`;
      tick = (timeout % 3600000) + 250;
    // If greater than 9 minutes, show minutes
    } else if (timeout > 540000) {
      timeoutText = `&lt; ${Math.ceil(timeout / 60000)}m`;
      tick = (timeout % 60000) + 250;
    // Show clock
    } else {
      const min = Math.floor(timeout / 60000);
      const sec = Math.floor((timeout % 60000) / 1000).toString().padStart(2, '0');
      timeoutText = `${min}:${sec}`;
      tick = (timeout % 1000) + 250;
    }

    if (tick < 0x80000000)
      turnTimeout = setTimeout(setTurnTimeoutClock, tick);
  } else {
    timeoutClass = 'expired';
    removeClass = 'short long';
    timeoutText = '0:00';
  }

  timeoutText += ' <SPAN class="fa fa-clock"></SPAN>';

  const board = game.board;
  const degree = board.getDegree('N', board.rotation);

  game.teams.forEach(team => {
    const position = board.getRotation(team.position, degree);
    const ePlayerId = 'player-'+position.toLowerCase();
    const $clock = $(`#${ePlayerId} .clock`);

    if (team === game.currentTeam) {
      $clock
        .removeClass(removeClass)
        .addClass(timeoutClass)
        .html(timeoutText);
      $('.critical').toggleClass('show', timeLimit < 3600 && game.isMyTeam(team) && timeoutClass !== 'long');
    } else
      $clock
        .removeClass('expired short long')
        .empty();
  });
}

async function startGame() {
  const $card = $(game.card.canvas)
    .attr('id', 'card')
    .on('transitionend', event => {
      // An invisible overlapping card should not intercept the pointer.
      const opacity = $card.css('opacity');
      const pointerEvents = opacity === '0' ? 'none' : '';

      $card.css({ pointerEvents });
    })
    .appendTo('#field');

  $(game.canvas)
    .attr('id', 'board')
    .appendTo('#field');

  $(window).trigger('resize');

  game
    .on('state-change', event => {
      $('BUTTON[name=pass]').prop('disabled', !game.isMyTurn);
      toggleUndoButton();
      if (game.state.endedAt && game.state.undoMode !== 'loose') {
        $('BUTTON[name=undo]').hide();
        refreshRatedMessage();
      }
      refreshDrawMessage();
      toggleReplayButtons();
    })
    .on('selectMode-change', event => {
      const panzoom     = game.panzoom;
      const old_mode    = event.ovalue;
      const new_mode    = event.nvalue;
      const can_move    = game.canSelectMove();
      const can_attack  = game.canSelectAttack();
      const can_turn    = game.canSelectTurn();

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
        resetPlayerBanners();

      $('#app').removeClass('readonly gameover');
      if (event.nvalue === 'readonly' || event.nvalue === 'gameover')
        $('#app').addClass(event.nvalue);

      if (event.nvalue)
        $('#app').addClass('locked');
      else
        $('#app').removeClass('locked');
    })
    .on('timeout', () => {
      // Only display once per page load
      if (timeoutPopup === undefined && !game.state.autoSurrender)
        timeoutPopup = popup({
          title: "Time's up!",
          message: `
            The turn time limit has been reached.
            Use the surrender button to force your opponent to surrender.
          `,
          onClose: () => {
            timeoutPopup = null;
          },
          maxWidth: '250px',
          zIndex: 10,
        });
    })
    .on('cancelTimeout', () => {
      if (timeoutPopup)
        timeoutPopup.close();
    })
    .on('resetTimeout', () => setTurnTimeoutClock())
    .on('playerRequest', ({ data:request }) => updatePlayerRequest('request', request.status === 'pending'))
    .on('playerRequest:accept', () => updatePlayerRequest('accept'))
    .on('playerRequest:reject', () => updatePlayerRequest('reject'))
    .on('playerRequest:cancel', () => updatePlayerRequest('cancel'))
    .on('playerRequest:complete', hidePlayerRequest)
    .on('startSync', () => {
      $('BUTTON[name=play]').hide();
      $('BUTTON[name=pause]').show();
      setHistoryState();
      toggleReplayButtons();
      setCursorAlert();
    })
    .on('endSync', () => {
      wakelock.disable();

      $('BUTTON[name=play]').show();
      $('BUTTON[name=pause]').hide();
      setHistoryState();
      toggleReplayButtons();
      setCursorAlert();
    })
    .on('startReplay', () => {
      $('#app').addClass('in-replay');

      setCursorAlert();
      setTurnTimeoutClock();
    })
    .on('endReplay', () => {
      $('#app').removeClass('in-replay');

      setCursorAlert();
      setTurnTimeoutClock();
    })
    .on('cursor-change', () => {
      if (game.cursor.atEnd)
        wakelock.disable();
      else
        wakelock.stayAwake();

      setHistoryState();
      setCursorAlert();
      toggleReplayButtons();
    });

  await game.start();

  // Wait until first turn starts, if it hasn't already started.
  // (Observers may need to wait to view the first turn)
  if (!game.state.whenTurnStarted.isFinalized) {
    progress.message = 'Game started.  Awaiting first turn...';
    await game.state.whenTurnStarted;
  }

  /*
   * Warning: These events can fire before state changes are animated.
   */
  game.state
    .on('playerStatus', () => {
      resetPlayerBanners();
      // An opponent opening the game may mean no longer being able to undo without approval.
      // The game._teams property must be defined or this will throw an error.
      toggleUndoButton();
    })
    .on('startTurn', resetPrompts)
    .on('endGame', hidePlayerRequest);

  resetPlayerBanners();
  toggleUndoButton();
  updateChatButton();
  updateRotateButton();
  progress.hide();
  $('#app').addClass('show');

  // Just in case a smart user changes the URL manually
  window.addEventListener('hashchange', () => buttons.replay());

  if (location.hash || game.state.endedAt)
    await buttons.replay();
  else if (game.isMyTurn && !game.isLocalGame)
    game.play(-game.teams.length);
  else
    game.play(-1);
}

function updatePlayerRequest(eventType, createIfNeeded = false) {
  if (game.isViewOnly)
    return;

  if (eventType !== 'accept')
    toggleUndoButton();

  const playerRequest = game.state.playerRequest;
  // Was undo cancelled before we got an update?
  if (!playerRequest)
    return hidePlayerRequest();

  const teams = game.teams;
  const requestor = 'teamId' in playerRequest
    ? teams[playerRequest.teamId]
    : teams.find(t => t.playerId === playerRequest.createdBy);

  if (game.hasOneLocalTeam(requestor))
    updatePlayerRequestPopup(playerRequest, createIfNeeded);
  else
    updatePlayerRequestPrompt(playerRequest, requestor, createIfNeeded);
}

function updatePlayerRequestPrompt(playerRequest, requestor, createIfNeeded) {
  const teams = game.teams;
  const myTeam = game.myTeam;
  const requestorName = teams.filter(t => t.name === requestor.name).length > 1 ? requestor.color : requestor.name;

  const divPrompts = document.getElementById('prompts');
  let divPrompt = divPrompts.querySelector(`.prompt.${playerRequest.type}`);
  if (!divPrompt) {
    if (!createIfNeeded)
      return;

    divPrompt = document.createElement('DIV');
    divPrompt.classList.add('prompt');
    divPrompt.classList.add(playerRequest.type);

    const spnMessage = document.createElement('SPAN');
    spnMessage.classList.add('message');
    divPrompt.appendChild(spnMessage);

    const spnActions = document.createElement('SPAN');
    spnActions.classList.add('actions');
    divPrompt.appendChild(spnActions);

    divPrompts.appendChild(divPrompt);
  }

  let message;
  const buttons = [];
  if (playerRequest.status === 'pending') {
    if (playerRequest.accepted.has(myTeam.id)) {
      message = playerRequest.type === 'undo'
        ? `undo request is waiting: ${playerRequest.accepted.size}/${teams.length}`
        : `truce offer is waiting: ${playerRequest.accepted.size}/${teams.length}`;
    } else {
      message = playerRequest.type === 'undo'
        ? `requests an undo:`
        : `offers a truce:`;
      buttons.push(
        {
          label: 'Accept',
          onClick: () => game.acceptPlayerRequest(),
        },
        {
          label: 'Reject',
          onClick: () => game.rejectPlayerRequest(),
        }
      );
    }
  } else if (playerRequest.status === 'cancelled') {
    message = playerRequest.type === 'undo'
      ? `cancelled their undo request.`
      : `cancelled their truce offer.`;
    buttons.push({
      label: 'Ok',
      onClick: hidePlayerRequest,
    });
  } else if (playerRequest.status === 'rejected') {
    const rejectorId = playerRequest.rejected.get(`${playerRequest.createdBy}:${playerRequest.type}`);
    if (rejectorId === authClient.playerId)
      return hidePlayerRequest();

    const rejector = teams.find(t => t.playerId === rejectorId);
    const rejectorName = teams.filter(t => t.name === rejector.name).length > 1 ? rejector.color : rejector.name;

    message = playerRequest.type === 'undo'
      ? `undo request was rejected by ${rejectorName}.`
      : `truce offer was rejected by ${rejectorName}.`;
    buttons.push({
      label: 'Ok',
      onClick: hidePlayerRequest,
    });
  }

  divPrompt.querySelector('.message').textContent = `${requestorName} ${message}`;
  divPrompt.querySelector('.actions').innerHTML = '';
  for (const button of buttons) {
    const spnAction = document.createElement('SPAN');
    spnAction.classList.add('action');
    divPrompt.querySelector('.actions').appendChild(spnAction);

    const prefix = document.createTextNode('«');
    spnAction.appendChild(prefix);

    const btn = document.createElement('BUTTON');
    btn.classList.add('link');
    btn.addEventListener('click', button.onClick);
    btn.textContent = button.label;
    spnAction.appendChild(btn);

    const suffix = document.createTextNode('»');
    spnAction.appendChild(suffix);
  }

  updateChatButton();
}

function updatePlayerRequestPopup(playerRequest, createIfNeeded) {
  if (!playerRequestPopup && !createIfNeeded)
    return;

  const teams = game.teams;
  const playerRequestTypeName = (
    playerRequest.type.toUpperCase('first') + ' ' +
    (playerRequest.type === 'undo' ? 'Request' : 'Offer')
  );
  const popupData = {
    title: `Your ${playerRequestTypeName}`,
    buttons: [],
    onClose: () => {
      playerRequestPopup = null;
      $('#app').removeClass('with-playerRequest');
    },
    container: document.getElementById('field'),
  };

  if (playerRequest.status === 'pending') {
    popupData.closeOnCancel = false;

    popupData.message = `Waiting for approval.`;
    popupData.buttons.push({
      label: 'Cancel',
      onClick: () => {
        game.cancelPlayerRequest();
        if (playerRequest.type === 'truce')
          buttons.surrender();
      },
    });
  } else {
    if (playerRequest.status === 'rejected') {
      if (playerRequest.type === 'truce') {
        hidePlayerRequest();
        return buttons.surrender();
      }

      const rejectorId = playerRequest.rejected.get(`${playerRequest.createdBy}:${playerRequest.type}`);
      const rejector = teams.find(t => t.playerId === rejectorId);

      popupData.message = `Request rejected by ${rejector.name}.`;
    } else if (playerRequest.status === 'completed')
      // The playerRequest:completed event is never sent if we were offline.
      popupData.message = `The request was accepted.`;

    popupData.buttons.push({ label:'Ok' });
  }

  popupData.zIndex = 20;

  if (playerRequestPopup)
    playerRequestPopup.update(popupData);
  else {
    playerRequestPopup = popup(popupData);
    $('#app').addClass('with-playerRequest');
  }
}

function hidePlayerRequest() {
  if (playerRequestPopup)
    playerRequestPopup.close();

  const divPrompts = document.getElementById('prompts');
  divPrompts.innerHTML = '';

  updateChatButton();
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

/*
 * The undo button state is reset every time there is a state change.  So, it is
 * always accurate except in one case... when the undo time limit has run out.
 * There are no events to indicate that time has run out so a timeout is used.
 * The timeout is cleared when a state change occurs before time is up.
 */
let undoTimeout = null;
function toggleUndoButton() {
  clearTimeout(undoTimeout);

  const playerRequest = game.state.playerRequest;
  if (playerRequest?.status === 'pending')
    return $('BUTTON[name=undo]').prop('disabled', true).removeClass('request');

  const canUndo = game.canUndo();
  $('BUTTON[name=undo]').prop('disabled', !canUndo);
  $('BUTTON[name=undo]').toggleClass('request', !!canUndo?.approve);

  // If we are only able to undo for a limited time, set a timer to disable it.
  if (canUndo?.refreshTimeout && canUndo.refreshTimeout < Infinity)
    undoTimeout = setTimeout(toggleUndoButton, canUndo.refreshTimeout);
}

function toggleReplayButtons() {
  const cursor = game.cursor;
  const isSynced = game.isSynced;
  const atStart = isSynced || cursor.atStart;
  const atCurrent = isSynced || cursor.atCurrent;
  const atEnd = isSynced || cursor.atEnd;

  $('BUTTON[name=start]').prop('disabled', atStart);
  $('BUTTON[name=back]').prop('disabled', atStart);

  $('BUTTON[name=forward]').prop('disabled', atCurrent);
  $('BUTTON[name=end]').prop('disabled', atCurrent);
  $('BUTTON[name=fork]').prop('disabled', (
    (game.state.strictFork || game.state.undoMode === 'strict') && !game.state.endedAt
  ) || atEnd);
}

function setCursorAlert() {
  const $alert = $('#alert');
  if (!game.inReplay)
    return $alert.empty().removeClass().removeData();

  if (!$alert.hasClass('cursor')) {
    $alert
      .addClass('cursor clickable')
      .data('handler', buttons.share)
      .html(`
        <SPAN class="fa fa-share"></SPAN>
        <SPAN class="label"></SPAN>
      `);
  }

  const label = `Turn ${game.turnId + 1} • ${game.nextActionId}`;

  $alert.find('.label').text(label);
}
