import popup from 'components/popup.js';

Tactics.App = (function ($, window, document) {
  'use strict';

  var self = {};
  var game;
  var undoPopup;
  var pointer;
  var fullscreen = Tactics.fullscreen;

  var buttons = {
    swapbar: function () {
      var $active = $('#app > .buttons.active');
      var $next = $active.next('.buttons');

      if (!$next.length)
        $next = $('#app > .buttons').first();

      $active.removeClass('active');
      $next.addClass('active');
    },
    resize:fullscreen.toggle,
    movebar: function ($button) {
      $('#app').toggleClass('left right');
      $button.toggleClass('fa-rotate-270 fa-rotate-90');
    },
    lock: function ($button) {
      $button.toggleClass('fa-lock fa-unlock');

      if ($button.hasClass('fa-lock'))
        game.panzoom.lock();
      else
        game.panzoom.unlock();
    },
    rotate: function ($button) {
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
    sound: function ($button) {
      $button.toggleClass('fa-bell fa-bell-slash');

      Howler.mute($button.hasClass('fa-bell-slash'));
    },
    undo: function () {
      game.undo();
    },
    select: function ($button) {
      let mode = $button.val();

      if (mode == 'turn' && $button.hasClass('ready')) {
        $('BUTTON[name=select][value=turn]').removeClass('ready');
        return game.zoomToTurnOptions();
      }

      game.selectMode = mode;
    },
    pass: function () {
      game.pass();
    },
    surrender: function () {
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
    }
  };

  $(window)
    .on('load', function () {
      if ('ontouchstart' in window)
        $('body').addClass(pointer = 'touch');
      else
        $('body').addClass(pointer = 'mouse');

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
        .on('mouseover','#app BUTTON:enabled', event => {
          let $button = $(event.target);

          // Ignore disabled buttons
          if (window.getComputedStyle(event.target).cursor !== 'pointer')
            return;

          Tactics.sounds.focus.play();
        })
        .on('click','#app BUTTON:enabled', event => {
          let $button = $(event.target);
          let handler = $button.data('handler') || buttons[$button.attr('name')];
          if (!handler) return;

          // Ignore disabled buttons
          if (window.getComputedStyle(event.target).cursor !== 'pointer')
            return;

          handler($button);

          Tactics.sounds.select.play();
        });

      initGame()
        .then(g => {
          game = g;
          game.state.on('playerStatus', resetPlayerBanners);

          if (game.isViewOnly) {
            $('BUTTON[name=pass]').hide();
            $('BUTTON[name=surrender]').hide();
            $('BUTTON[name=undo]').hide();
          }

          $('#splash').show();
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

          $('#join').hide();
          $('#error').show();
        });
    })
    .on('resize', () => {
      let $resize = $('BUTTON[name=resize]');
      if (fullscreen.isEnabled() !== $resize.hasClass('fa-compress'))
        $resize.toggleClass('fa-expand fa-compress');

      if (game) game.resize();
    });

  function initGame() {
    let gameId = location.search.slice(1).replace(/&.+$/, '');

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
            return showWaitIntro(identity, gameData);
          else
            return showJoinIntro(identity, gameData);
        });
      })
  }

  function showWaitIntro(identity, gameData) {
    let $greeting = $('#wait .greeting');

    return Tactics.loadRemoteGame(gameData.id).then(game => {
      $greeting.text($greeting.text().replace('{playerName}', identity.name));

      $('#wait').show();

      return game.whenStarted.then(() => {
        $('#wait').hide();
        return game;
      })
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
            $('.message').text('One moment...');

            game.start().then(() => {
              resetPlayerBanners();

              $('BUTTON[name=pass]').prop('disabled', !game.isMyTurn());
              $('BUTTON[name=undo]').prop('disabled', !game.canUndo());

              $('#splash').hide();
              $('#app').css('visibility','visible');
            });
          })
          .find('.message')
            .text(action+' here to play!')
      })
      .on('undoRequest', showUndoDialog)
      .on('undoAccept', updateUndoDialog)
      .on('undoReject', updateUndoDialog)
      .on('undoCancel', updateUndoDialog)
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
    let myTeam = teams.find(t => game.isMyTeam(t));
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

      return undoPopup = popup(popupData);
    }

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

    undoPopup = popup(popupData);
  }

  function hideUndoDialog() {
    if (undoPopup)
      undoPopup.close();
  }

  return self;
})(jQuery,window,document);
