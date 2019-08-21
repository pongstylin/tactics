import popup from 'components/popup.js';
import copy from 'components/copy.js';

Tactics.App = (function ($, window, document) {
  'use strict';

  var self = {};
  var gameId = location.search.slice(1).replace(/&.+$/, '');
  var game;
  var lastSeenEventId;
  var chatMessages = [];
  var undoPopup;
  var timeoutPopup;
  var pointer;
  var fullscreen = Tactics.fullscreen;

  var buttons = {
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
    lock: $button => {
      $button.toggleClass('fa-lock fa-unlock');

      if ($button.hasClass('fa-lock'))
        game.panzoom.lock();
      else
        game.panzoom.unlock();
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
      game.undo();
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
      let $messages = $('#messages');

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

        $app.addClass('chat-closing');
        tick();
      }
      else {
        // Sometimes this bubbles up from the #chat
        $app.one('transitionend', () => {
          $app.toggleClass('chat-open chat-opening');
          updateChatButton();
        });

        $app.addClass('chat-opening');

        // Keep chat scrolled to bottom after displaying input box
        $messages.scrollTop($messages.prop('scrollHeight'));
      }
    },
  };

  $(() => {
    if ('ontouchstart' in window)
      $('body').addClass(pointer = 'touch');
    else
      $('body').addClass(pointer = 'mouse');

    if (pointer === 'touch')
      $('.new-message').attr('placeholder', 'Touch to chat!');
    else
      $('.new-message').attr('placeholder', 'Type to chat!');

    $('#loader').css({
      top:($(window).height()/2)-($('#loader').height()/2)+'px',
      left:($(window).width()/2)-($('#loader').width()/2)+'px',
      visibility:'visible'
    });

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
        let readySpecial = game.readySpecial();
        let button = event.target;
        let eventType = pointer === 'touch' ? 'touchend' : 'mouseup';

        $(document).one(eventType, event => {
          if (event.target === button)
            readySpecial.release();
          else
            readySpecial.cancel();
        });
      })
      .on('mouseover', '#app BUTTON:enabled', event => {
        let $button = $(event.target);

        // Ignore disabled buttons
        if (window.getComputedStyle(event.target).cursor !== 'pointer')
          return;

        Tactics.sounds.focus.play();
      })
      .on('click', '#app BUTTON:enabled', event => {
        let $button = $(event.target);
        let handler = $button.data('handler') || buttons[$button.attr('name')];
        if (!handler) return;

        // Ignore disabled buttons
        if (window.getComputedStyle(event.target).cursor !== 'pointer')
          return;

        handler($button);

        Tactics.sounds.select.play();
      })
      .on('keydown', event => {
        let $app = $('#app');
        let $chat = $('#chat');
        let $messages = $chat.find('#messages');
        let $newMessage = $chat.find('.new-message');
        let keyChar = event.key;

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

          if (!event.shiftKey && !event.metaKey)
            Tactics.chatClient.postMessage(gameId, message).then(() => {
              $newMessage.val('');
              $newMessage.trigger('input');
            });
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
      .on('blur', '#chat .new-message', event => {
        setTimeout(() => {
          let $newMessage = $('#chat.active .new-message');
          if ($newMessage.length)
            $newMessage[0].focus({ preventScroll:true });
        });
      });

    $('#chat').on('transitionend', ({ originalEvent:event }) => {
      let $messages = $('#messages');

      if (event.propertyName === 'height')
        $messages.scrollTop($messages.prop('scrollHeight'));
    });

    // It takes some JS-work to base a TEXTAREA's height on its content.
    $('TEXTAREA')
      .on('input', function () {
        this.style.height = 'auto';
        let style = window.getComputedStyle(this);
        let paddingHeight = parseInt(style.paddingTop) + parseInt(style.paddingBottom);

        let height = this.scrollHeight;
        if (style.boxSizing === 'content-box') {
          height -= paddingHeight;
          // The initial height can be computed as zero in some cases (flexbox?)
          height = Math.max(height, 18);
        }
        else {
          // The initial height can be computed as zero in some cases (flexbox?)
          height = Math.max(height, 18 + paddingHeight);
        }

        this.style.height = `${height}px`;

        // As the height of the textarea increases, the height of the messages
        // decreases.  As it does so, make sure it remains scrolled to bottom.
        if (style.position === 'relative')
          $('#messages').scrollTop($('#messages').prop('scrollHeight'));
      })
      .each(function () {
        $(this).trigger('input');
      });

    initGame()
      .then(g => {
        $('#splash').show();

        game = g;
        game.state.on('playerStatus', resetPlayerBanners);

        if (game.isViewOnly)
          $('#app').addClass('for-viewing');
        else if (game.hasOneLocalTeam()) {
          $('#app').addClass('for-playing');

          let chatClient = Tactics.chatClient;
          let groupId = `/rooms/${gameId}`;
          let playerId = Tactics.authClient.playerId;

          chatClient.on('open', ({ data }) => {
            if (data.reason !== 'reset') return;

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

            loadThenStartGame();
          });
        }
        else
          $('#app').addClass('for-practice');

        loadThenStartGame();
      })
      .catch(error => {
        console.error(error);

        if (error.code === 403 || error.code === 409)
          $('#error').text(error.message);
        else if (error.code === 404)
          $('#error').text("The game doesn't exist");
        else if (error.code === 429)
          $('#error').text("Loading games too quickly");

        $('#splash').hide();
        $('#join').hide();
        $('#error').show();
      });
  });

  $(window).on('resize', () => {
    let $resize = $('BUTTON[name=resize]');
    if (fullscreen.isEnabled() !== $resize.hasClass('fa-compress'))
      $resize.toggleClass('fa-expand fa-compress');

    // Temporarily remove chat-open and inlineChat so that the game can
    // calculate the biggest board size it can.
    let chatMode = $('#app').hasClass('chat-open');
    $('#app').removeClass('chat-open with-inlineChat');

    if (game) game.resize();

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
    return Tactics.getRemoteGameData(gameId)
      .then(gameData => {
        // An account is not required to view an ended game.
        if (gameData.state.ended)
          return Tactics.loadRemoteGame(gameId, gameData);

        return Tactics.getMyIdentity().then(identity => {
          // No account?  Provide a name before joining/watching!
          if (!identity)
            return showJoinIntro(identity, gameData);

          // Account exists and game started?  Immediately start watching!
          if (gameData.state.started)
            return Tactics.loadRemoteGame(gameId, gameData);

          let hasJoined = gameData.state.teams.find(t => t && t.playerId === identity.id);
          if (hasJoined)
            if (gameData.isPublic)
              return showPublicIntro(identity, gameData);
            else
              return showPrivateIntro(identity, gameData);
          else
            return showJoinIntro(identity, gameData);
        });
      })
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
    $('#messages').append(`
      <DIV class="message">
        <SPAN class="player">${message.player.name}</SPAN>
        <SPAN class="content">${message.content}</SPAN>
      </DIV>
    `);
  }

  function showPublicIntro(identity, gameData) {
    renderShareLink(gameData.id, document.querySelector('#public .shareLink'));

    let $greeting = $('#public .greeting');
    let myTeam = gameData.state.teams.find(t => t && t.playerId === identity.id);
    $greeting.text($greeting.text().replace('{teamName}', myTeam.name));

    return Tactics.loadRemoteGame(gameData.id).then(game => {
      $('#public').show();

      return game.whenStarted.then(() => {
        $('#public').hide();
        return game;
      });
    });
  }
  function showPrivateIntro(identity, gameData) {
    renderShareLink(gameData.id, document.querySelector('#private .shareLink'));

    let $greeting = $('#private .greeting');
    let myTeam = gameData.state.teams.find(t => t && t.playerId === identity.id);
    $greeting.text($greeting.text().replace('{teamName}', myTeam.name));

    return Tactics.loadRemoteGame(gameData.id).then(game => {
      $('#private').show();

      return game.whenStarted.then(() => {
        $('#private').hide();
        return game;
      });
    });
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
        navigator.share({
          title: 'Tactics',
          text: 'Want to play?',
          url: link,
        });
      else {
        copy(link);
        popup({ message:'Game link copied to clipboard.' });
      }
    });
  }

  function showJoinIntro(identity, gameData) {
    let greeting = document.querySelector('#join .greeting');
    let playerName = document.querySelector('INPUT[name=playerName]');
    let details = document.querySelector('.details');
    let challenge = document.querySelector('.challenge');
    let btnJoin = document.querySelector('BUTTON[name=join]');

    if (identity) {
      greeting.innerHTML = `
        Welcome back, ${identity.name}!  You may change your name here.<BR>
        Note: This won't change your name on previously created/joined games.
      `;
      playerName.value = identity.name;
    }
    else {
      greeting.innerHTML = `Welcome!  Choose your game name.`;
      playerName.value = 'Noob';
    }

    if (gameData.state.started) {
      btnJoin.textContent = 'Watch Game';

      return new Promise((resolve, reject) => {
        btnJoin.addEventListener('click', event => {
          Tactics.authClient.setAccountName(playerName.value)
            .then(() => resolve(gameData));
        });

        $('#join').show();
      });
    }
    else {
      let creatorTeam = gameData.state.teams.find(t => !!t);
      let person;
      if (gameData.state.randomFirstTurn)
        person = 'random';
      else if (creatorTeam.originalId === 0)
        person = creatorTeam.name;
      else
        person = 'you';

      details.textContent = `The first person to move is ${person}.`;
      challenge.textContent = `${creatorTeam.name} is waiting for an opponent.  Want to play?`;

      return new Promise((resolve, reject) => {
        btnJoin.addEventListener('click', event => {
          Tactics.joinRemoteGame(playerName.value, gameData.id)
            .then(() => Tactics.loadRemoteGame(gameData.id, gameData))
            .then(game => {
              $('#join').hide();
              resolve(game);
            })
            .catch(error => reject(error));
        });

        $('#join').show();
      });
    }
  }

  function updateChatButton() {
    if (!chatMessages.length) return;

    let playerId = Tactics.authClient.playerId;
    let $button = $('BUTTON[name=chat]');

    if ($('#app').is('.show.with-inlineChat, .chat-open')) {
      $button.removeClass('ready').attr('badge', '');

      if (lastSeenEventId < chatMessages.last.id) {
        lastSeenEventId = chatMessages.last.id;

        Tactics.chatClient.seen(gameId, lastSeenEventId);
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

  function loadThenStartGame() {
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
        $('BUTTON[name=pass]').prop('disabled', !game.isMyTurn());
        $('BUTTON[name=undo]').prop('disabled', !game.canUndo());
      })
      .on('selectMode-change', event => {
        let panzoom     = game.panzoom;
        let old_mode    = event.ovalue;
        let new_mode    = event.nvalue;
        let can_move    = game.canSelectMove();
        let can_attack  = game.canSelectAttack();
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
        $('BUTTON[name=pass]').prop('disabled', !game.isMyTurn());
        $('BUTTON[name=undo]').prop('disabled', !game.canUndo());

        if (new_mode === 'attack' && can_special)
          $('BUTton[name=select][value=attack]').addClass('ready');
        else
          $('BUTton[name=select][value=attack]').removeClass('ready');

        if (new_mode === 'turn' && panzoom.canZoom() && game.selected && !game.viewed)
          $('BUTTON[name=select][value=turn]').addClass('ready');
        else
          $('BUTTON[name=select][value=turn]').removeClass('ready');

        if (new_mode === 'ready')
          $('BUTTON[name=pass]').addClass('ready');
        else
          $('BUTTON[name=pass]').removeClass('ready');

        // Automatically lock panzoom for improved game interaction
        if (!panzoom.locked)
          buttons.lock($('BUTTON[name=lock]'));
      })
      .on('card-change', event => {
        if (event.nvalue && event.ovalue === null)
          $card.addClass('show');
        else if (event.nvalue === null)
          $card.removeClass('show');
      })
      .on('lock-change', event => {
        if (event.nvalue === 'gameover') {
          $('BUTTON[name=pass]').hide();
          $('BUTTON[name=surrender]').hide();
          $('BUTTON[name=undo]').hide();
        }

        if (event.nvalue === 'readonly' || event.nvalue === 'gameover')
          $('#app').addClass('readonly');
        else
          $('#app').removeClass('readonly');

        if (event.nvalue)
          $('#app').addClass('locked');
        else
          $('#app').removeClass('locked');
      })
      .on('progress', event => {
        let $progress = $('#progress');
        let percent = event.percent;

        $progress.width(percent);
      })
      .on('ready', () => {
        let action = pointer === 'mouse' ? 'Click' : 'Tap';

        $('#loader')
          .addClass('complete')
          .one('click', () => {
            $('#splash .message').text('One moment...');

            game.start().then(() => {
              resetPlayerBanners();

              $('BUTTON[name=pass]').prop('disabled', !game.isMyTurn());
              $('BUTTON[name=undo]').prop('disabled', !game.canUndo());

              $('#splash').hide();
              $('#app').addClass('show');
            });
          })
          .find('.message')
            .text(action+' here to play!')
      })
      .on('timeout', () => {
        timeoutPopup = popup({
          title: "Time's up!",
          message: 'The turn time limit has been reached.  You can continue to wait or force surrender.',
          onCancel: () => false,
          onClose: () => {
            timeoutPopup = null;
          },
          buttons: [{
            label: 'Force Surrender',
            onClick: () => game.forceSurrender(),
          }],
          minWidth: '250px',
          zIndex: 10,
        });
      })
      .on('cancelTimeout', () => {
        if (timeoutPopup)
          timeoutPopup.close();
      })
      .on('undoRequest', showUndoDialog)
      .on('undoAccept', () => updateUndoDialog())
      .on('undoReject', () => updateUndoDialog())
      .on('undoCancel', () => updateUndoDialog())
      .on('undoComplete', hideUndoDialog);
  }

  function showUndoDialog() {
    if (game.isViewOnly)
      return;

    let undoRequest = game.state.undoRequest;

    // Only show the popup if it is already shown or if the undo is pending.
    updateUndoDialog(undoRequest.status === 'pending');
  }

  function updateUndoDialog(createIfNeeded = false) {
    if (!undoPopup && !createIfNeeded) {
      // When a request is rejected, the undo button becomes disabled.
      $('BUTTON[name=undo]').prop('disabled', !game.canUndo());
      return;
    }

    let undoRequest = game.state.undoRequest;
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
      popupData.onCancel = () => false;

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

  return self;
})(jQuery,window,document);
