import { gameConfig } from 'config/client.js';
import Autosave from 'components/Autosave.js';
import copy from 'components/copy.js';
import share from 'components/share.js';
import tappable from 'components/tappable.js';
import wakelock from 'components/wakelock.js';
import GameSettingsModal from 'components/Modal/GameSettings.js';
import PlayerActivityModal from 'components/Modal/PlayerActivity.js';
import PlayerInfoModal from 'components/Modal/PlayerInfo.js';
import ForkModal from 'components/Modal/Fork.js';
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
var game;
var muted;
var lastSeenEventId;
var chatMessages = [];
var playerRequestPopup;
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
        message: `End your practice game?`,
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
    else if (!game.state.rated)
      popup({
        message: `Do you surrender?  This is not a rated game so it won't affect your Win/Lose/Draw stats.`,
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
    else if (game.canTruce()) {
      if (!game.teamHasPlayed(game.myTeam))
        popup({
          message: [
            `Since you haven't played a turn, you can abandon the game.  `,
            `Abandoned games do not affect player's Win/Lose/Draw stats.  `,
            `However, your opponents can see how many times you have abandoned games.  `,
            `You may, however, offer a truce to avoid abandoning the game.`,
          ].join(''),
          buttons: [
            {
              label: 'Offer Truce',
              onClick: () => game.truce(),
            },
            {
              label: 'Abandon',
              onClick: () => game.surrender(),
            },
            {
              label: 'Cancel',
            },
          ],
          maxWidth: '400px',
          margin: '16px',
        });
      else
        popup({
          message: [
            `If you and your opponent agree to a truce, then this game won't affect your Win/Lose/Draw stats.  `,
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
    } else
      if (!game.teamHasPlayed(game.myTeam))
        popup({
          message: `A truce has been rejected.  So, will you abandon the game?`,
          buttons: [
            {
              label: 'Abandon',
              onClick: () => game.surrender(),
            },
            {
              label: 'Cancel',
            },
          ],
          maxWidth: '250px',
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
    new ForkModal({ game });
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
      } else if ($link.hasClass('name'))
        playerInfo = new PlayerInfoModal(
          { game, gameType, team },
          { onClose:() => playerInfo = null }
        );
    })
    /*
     * Under these conditions a special attack can be triggered:
     *   1) The unit is enraged and selected in attack mode. (selector)
     *   2) The attack button is pressed for 2 seconds and released.
     */
    .on('press', '#app BUTTON:enabled[name=select][value=attack].ready', event => {
      readySpecial = game.readySpecial();
    })
    .on('release', '#app BUTTON:enabled[name=select][value=attack].ready', event => {
      if (event.detail.outside)
        readySpecial.cancel();
      else
        readySpecial.release();

      readySpecial = null;
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
      if (gameData.state.endedAt)
        return loadTransportAndGame(gameId, gameData);

      // An account is required before joining or watching an active game.
      await authClient.requireAuth();

      // Account exists and game started?  Immediately start watching!
      if (gameData.state.startedAt)
        return loadTransportAndGame(gameId, gameData);

      const teams = gameData.state.teams;
      const hasJoined = teams.filter(t => t?.playerId === authClient.playerId);
      const hasOpenSlot = teams.filter(t => !t?.playerId);
      if (hasJoined.length === teams.length)
        return showPracticeIntro(gameData);
      else if (hasJoined.length)
        if (gameData.collection)
          return showPublicIntro(gameData);
        else
          return showPrivateIntro(gameData);
      else
        if (!gameData.state.startedAt && gameData.forkOf)
          return showJoinFork(gameData);
        else
          return showJoinIntro(gameData);
    })
    .then(async g => {
      game = g;
      game.id = gameId;
      game.state.on('playerStatus', () => {
        resetPlayerBanners();
        // An opponent opening the game may mean no longer being able to undo without approval.
        toggleUndoButton();
      });

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
              if (playerInfo && playerId !== authClient.playerId)
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
    if (error.code !== 409 && error.code !== 412) throw error;

    if (error.code === 412)
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
  const transport = new Tactics.RemoteTransport(gameId, gameData);
  await transport.whenReady;

  return transport;
}
async function loadGame(transport) {
  await loadResources(transport);

  return new Tactics.Game(transport, authClient.playerId);
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
  chatMessages = messages;
  messages.forEach(m => renderMessage(m));

  const $messages = $('#messages');
  $messages.scrollTop($messages.prop('scrollHeight'));
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
  const myMuted = muted.get(authClient.playerId);
  const playerId = message.player.id;
  const isMuted = myMuted.has(playerId) || myMuted.size === muted.size - 1 ? 'muted' : '';
  let playerName = message.player.name;
  if (game.teams.filter(t => t.name === playerName).length > 1) {
    const team = game.teams.find(t => t.playerId === playerId);
    if (game.isMyTeam(team))
      playerName = '<I>You</I> ';
  }

  $('#messages').append(`
    <DIV class="message player-${playerId} ${isMuted}">
      <SPAN class="player">${playerName}</SPAN>
      <SPAN class="content">${message.content}</SPAN>
    </DIV>
  `);
}

async function showPublicIntro(gameData) {
  renderShareLink(gameData, document.querySelector('#public .shareLink'));
  renderCancelButton(gameData.id, document.querySelector('#public .cancelButton'));

  const rated = gameData.state.rated ? 'rated' : 'unrated';
  const vs = gameData.collection === 'public' ? 'Public' : 'Lobby';
  const $greeting = $('#public .greeting');
  const $subText = $greeting.next();
  const myTeam = gameData.state.teams.find(t => t?.playerId === authClient.playerId);
  $greeting.text($greeting.text().replace('{teamName}', myTeam.name));
  $subText.text($subText.text().replace('{vs}', `${rated} ${vs}`));

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
  const rated = state.rated ? 'rated' : 'unrated';
  const vs = state.strictUndo && state.strictFork && state.autoSurrender ? 'Tournament' : 'Private';
  const $greeting = $('#private .greeting');
  const $subText = $greeting.next();
  const myTeam = state.teams.find(t => t?.playerId === authClient.playerId);
  $greeting.text($greeting.text().replace('{teamName}', myTeam.name));
  $subText.text($subText.text().replace('{vs}', `${rated} ${vs}`));

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
      maxWidth: '250px',
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
  if (creatorTeam.id === gameData.state.currentTeamId)
    person = `<I>${creatorTeam.name}</I>`;
  else
    person = 'you';

  const blocking = gameData.state.randomHitChance ? 'random' : 'predictable';
  const forkOfURL = `/game.html?${gameData.forkOf.gameId}#c=${gameData.forkOf.turnId + 1},0`;

  details.innerHTML = `
    <DIV>This is a fork of <A href="${forkOfURL}" target="_blank">this ${of} and turn</A>.</DIV>
    <DIV>The game style is <I>${gameType.name}</I>.</DIV>
    <DIV>The turn time limit is set to ${turnLimit}.</DIV>
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
    const openSlot = gameData.state.teams.findIndex(t => {
      if (!t?.playerId)
        return true;
      return authClient.playerId === t.playerId;
    });
    if (openSlot === -1) {
      popup({
        message: 'Sorry!  This game is reserved for someone else.',
        buttons: [
          { label:'Back', closeOnClick:false, onClick:() => history.back() },
        ],
        maxWidth: '250px',
        closeOnCancel: false,
      });
      return new Promise(() => {});
    }

    const creatorTeam = gameData.state.teams.find(t => !!t?.joinedAt);
    const playerACL = await authClient.getPlayerACL(creatorTeam.playerId);

    if (playerACL?.reverseType === 'blocked') {
      challenge.innerHTML = `Sorry!  <I>${creatorTeam.name}</I> blocked you from joining their games.`;
      root.querySelector('.playerSetup').remove();
      details.remove();
      root.querySelector('.set').remove();
      root.querySelector('.buttons').remove();

      progress.hide();
      $('#join').show();
      return new Promise(() => {});
    }

    const message = [];
    if (!playerACL)
      message.push(`<I>${creatorTeam.name}</I> is waiting for an opponent.  Want to play?`);
    else if (playerACL.type === 'friended') {
      if (playerACL.name.toLowerCase() === creatorTeam.name.toLowerCase())
        message.push(`<I>${creatorTeam.name}</I> is your friend.`);
      else
        message.push(`<I>${creatorTeam.name}</I> is your friend better known as <I>${playerACL.name}</I>.`);
      message.push(`Want to play?`);
    } else if (playerACL.type === 'muted') {
      if (playerACL.name.toLowerCase() === creatorTeam.name.toLowerCase())
        message.push(`You muted <I>${creatorTeam.name}</I>.`);
      else
        message.push(`You muted <I>${creatorTeam.name}</I> under the name <I>${playerACL.name}</I>.`);
      message.push(`But, you can still play!`);
    } else if (playerACL.type === 'blocked') {
      if (playerACL.name.toLowerCase() === creatorTeam.name.toLowerCase())
        message.push(`You blocked <I>${creatorTeam.name}</I>.`);
      else
        message.push(`You blocked <I>${creatorTeam.name}</I> under the name <I>${playerACL.name}</I>.`);
      message.push(`But, you can play if you mute them instead.`);

      btnJoin.textContent = 'Mute and Join Game';
    }
    challenge.innerHTML = message.join('  ');

    let vs;
    if (gameData.collection === 'public')
      vs = 'a Public';
    else if (gameData.collection)
      vs = 'a Lobby';
    else if (gameData.state.strictUndo && gameData.state.strictFork && gameData.state.autoSurrender)
      vs = 'a Tournament';
    else
      vs = 'a Private';

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
    else if (creatorTeam.slot === 0)
      person = 'you';
    else
      person = creatorTeam.name;

    const blocking = gameData.state.randomHitChance ? 'random' : 'predictable';
    const rated = gameData.state.rated ? 'rated' : 'unrated';

    details.innerHTML = `
      <DIV>This is ${vs} game.</DIV>
      <DIV>The game style is <I>${gameType.name}</I>.</DIV>
      <DIV>The turn time limit is set to ${turnLimit}.</DIV>
      <DIV>The first person to move is ${person}.</DIV>
      <DIV>The blocking system is ${blocking}.</DIV>
      <DIV>The game is ${rated}.</DIV>
    `;

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

    if (gameData.state.rated)
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
  if (!chatMessages.length) return;

  const playerId = authClient.playerId;
  const $button = $('BUTTON[name=chat]');

  if ($('#app').is('.show.with-inlineChat, .chat-open')) {
    $button.removeClass('ready').attr('badge', '');

    if (lastSeenEventId < chatMessages.last.id) {
      lastSeenEventId = chatMessages.last.id;

      chatClient.seen(gameId, lastSeenEventId);
    }
  } else {
    if (chatMessages.last.player.id !== playerId)
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
    const showLink = playerStatus !== 'unavailable' && !game.isViewOnly && !isMyTeam;
    const $status = $player.find('.status')
      .removeClass('offline online active unavailable')
      .addClass(playerStatus.status)
      .toggleClass('mobile', playerStatus.deviceType === 'mobile')
      .toggleClass('link', showLink && !game.state.endedAt);
    const $name = $player.find('.name')
      .toggleClass('link', showLink)
      .text(team.name);

    if (team.forkOf) {
      let $fork = $player.find('.fork');
      if (!$fork.length)
        $fork = $('<SPAN>').insertAfter($name).addClass('fork fa fa-code-branch');

      if (!game.ofPracticeGame) {
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

  let timeout = game.turnTimeRemaining;
  let timeoutClass;
  let removeClass;
  let timeoutText;
  if (timeout > 0) {
    let timeLimit = game.turnTimeLimit;
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
      let min = Math.floor(timeout / 60000);
      let sec = Math.floor((timeout % 60000) / 1000).toString().padStart(2, '0');
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

  let board = game.board;
  let degree = board.getDegree('N', board.rotation);

  game.teams.forEach(team => {
    let position = board.getRotation(team.position, degree);
    let ePlayerId = 'player-'+position.toLowerCase();
    let $clock = $(`#${ePlayerId} .clock`);

    if (team === game.currentTeam) {
      $clock
        .removeClass(removeClass)
        .addClass(timeoutClass)
        .html(timeoutText);
      $('.critical').toggleClass('show', game.isMyTeam(team) && timeoutClass !== 'long');
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
      if (game.state.endedAt && game.state.rated)
        $('BUTTON[name=undo]').hide();
      toggleReplayButtons();
    })
    .on('selectMode-change', event => {
      const panzoom     = game.panzoom;
      const old_mode    = event.ovalue;
      const new_mode    = event.nvalue;
      const can_move    = game.canSelectMove();
      const can_attack  = game.canSelectAttack();
      const can_turn    = game.canSelectTurn();
      const can_special = game.canSelectSpecial();

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
    .on('playerRequest', ({ data:request }) => updatePlayerRequestPopup('request', request.status === 'pending'))
    .on('playerRequest:accept', () => updatePlayerRequestPopup('accept'))
    .on('playerRequest:reject', () => updatePlayerRequestPopup('reject'))
    .on('playerRequest:cancel', () => updatePlayerRequestPopup('cancel'))
    .on('playerRequest:complete', hidePlayerRequestPopup)
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

  resetPlayerBanners();
  updateChatButton();
  updateRotateButton();
  progress.hide();
  $('#app').addClass('show');

  // Just in case a smart user changes the URL manually
  window.addEventListener('hashchange', () => buttons.replay());

  if (location.hash)
    await buttons.replay();
  else if (game.isMyTurn && !game.isLocalGame)
    game.play(-game.teams.length);
  else
    game.play(-1);
}

function updatePlayerRequestPopup(eventType, createIfNeeded = false) {
  if (game.isViewOnly)
    return;

  if (eventType !== 'accept')
    toggleUndoButton();

  if (!playerRequestPopup && !createIfNeeded)
    return;

  const playerRequest = game.state.playerRequest;
  // Was undo cancelled before we got an update?
  if (!playerRequest)
    return hidePlayerRequestPopup();

  const teams = game.teams;
  const myTeam = game.myTeam;
  const requestor = 'teamId' in playerRequest
    ? teams[playerRequest.teamId]
    : teams.find(t => t.playerId === playerRequest.createdBy);
  const popupData = {
    buttons: [],
    onClose: () => {
      playerRequestPopup = null;
      $('#app').removeClass('with-playerRequest');
    },
    container: document.getElementById('field'),
  };

  const playerRequestTypeName = (
    playerRequest.type.toUpperCase('first') + ' ' +
    (playerRequest.type === 'undo' ? 'Request' : 'Offer')
  );
  if (game.hasOneLocalTeam(requestor))
    popupData.title = `Your ${playerRequestTypeName}`;
  else if (teams.filter(t => t.name === requestor.name).length > 1)
    popupData.title = `${playerRequestTypeName} By ${requestor.color}`;
  else
    popupData.title = `${playerRequestTypeName} By ${requestor.name}`;

  if (playerRequest.status !== 'pending') {
    if (playerRequest.status === 'rejected') {
      if (playerRequest.type === 'truce') {
        hidePlayerRequestPopup();
        return buttons.surrender();
      }

      const rejectorId = playerRequest.rejected.get(`${playerRequest.createdBy}:${playerRequest.type}`);
      const rejector = teams.find(t => t.playerId === rejectorId);

      popupData.message = `Request rejected by ${rejector.name}.`;
    } else if (playerRequest.status === 'cancelled')
      popupData.message = `The request was cancelled.`;
    else if (playerRequest.status === 'completed')
      // The playerRequest:completed event is never sent if we were offline.
      popupData.message = `The request was accepted.`;

    popupData.buttons.push({ label:'Ok' });
  } else {
    popupData.closeOnCancel = false;

    if (game.isMyTeam(requestor)) {
      popupData.message = `Waiting for approval.`;
      popupData.buttons.push({
        label: 'Cancel',
        onClick: () => {
          game.cancelPlayerRequest();
          if (playerRequest.type === 'truce')
            buttons.surrender();
        },
      });
    } else if (playerRequest.accepted.has(myTeam.id)) {
      popupData.message = `Approval sent.  Waiting for others.`;
      popupData.buttons.push({
        label: 'Withdraw Approval',
        onClick: () => game.rejectPlayerRequest(),
      });
    } else {
      popupData.message = `Do you approve?`;
      popupData.buttons.push({
        label: 'Yes',
        onClick: () => game.acceptPlayerRequest(),
      });
      popupData.buttons.push({
        label: 'No',
        onClick: () => game.rejectPlayerRequest(),
      });
    }
  }

  popupData.zIndex = 20;

  if (playerRequestPopup)
    playerRequestPopup.update(popupData);
  else {
    playerRequestPopup = popup(popupData);
    $('#app').addClass('with-playerRequest');
  }
}

function hidePlayerRequestPopup() {
  if (playerRequestPopup)
    playerRequestPopup.close();
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
  $('BUTTON[name=undo]').toggleClass('request', canUndo === 'approve');

  // If we are only able to undo for a limited time, set a timer to disable it.
  if (canUndo && typeof canUndo === 'number')
    undoTimeout = setTimeout(toggleUndoButton, canUndo);
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
  $('BUTTON[name=fork]').prop('disabled', (game.state.strictUndo && !game.state.endedAt) || atEnd);
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
