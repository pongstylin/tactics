import { gameConfig } from 'config/client.js';
import popup from 'components/popup.js';
import GameSettingsModal from 'components/Modal/GameSettings.js';

var game;
var settings;
var progress;
var pointer;
var readySpecial;

const set = {
  units: [
    { assignment:[4, 1], direction:'S', type:'Knight' },
    { assignment:[5, 1], direction:'S', type:'Knight' },
    { assignment:[6, 1], direction:'S', type:'Knight' },
  ],
};
/*
 * The player team MUST be in the 3rd position.
 * This ensures that the Game object doesn't recolor teams.
 */
const teamColorIds = gameConfig.teamColorIds;
const gameStateData = {
  type: 'chaos',
  teams: [
    {
      colorId: teamColorIds[0],
      bot: true,
      set: set,
    },
    {
      colorId: teamColorIds[1],
      bot: true,
      set: set,
    },
    {
      colorId: teamColorIds[2],
      bot: false,
      set: set,
    },
    {
      colorId: teamColorIds[3],
      bot: true,
      set: set,
    },
  ],
};

const buttons = {
  home: () => {
    location.href = '/';
  },
  settings: () => {
    settings.show();
  },
  swapbar: function () {
    var $active = $('#game > .buttons.active');
    var $next = $active.next('.buttons');

    if (!$next.length)
      $next = $('#game > .buttons').first();

    $active.removeClass('active');
    $next.addClass('active');
  },
  movebar: function ($button) {
    $('#app').toggleClass('left right');
    $button.toggleClass('fa-rotate-270 fa-rotate-90');
  },
  rotate: function ($button) {
    game.rotateBoard(90);

    updateRotateButton();
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
    let resetPopup = popup({
      message: 'Are you sure you want to reset the game?',
      buttons: [
        {
          label: 'Yes',
          onClick: () => {
            let momentPopup = popup({
              message: 'One moment...',
              buttons: [],
            });

            game.restart().then(() => {
              momentPopup.close();
              $('BUTTON[name=surrender]').removeClass('ready');

              game.play(0);
            });
          },
        },
        {
          label: 'No',
        },
      ],
    });
  }
};

$(() => {
  progress = new Tactics.Progress();
  progress.message = 'Loading game...';
  progress.show();

  if ('ontouchstart' in window) {
    $('body').addClass(pointer = 'touch');
  }
  else {
    $('body').addClass(pointer = 'mouse');
  }

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
    .on('mouseover','#app BUTTON:enabled', event => {
      var $button = $(event.target);

      // Ignore disabled buttons
      if (window.getComputedStyle(event.target).cursor !== 'pointer')
        return;

      Tactics.playSound('focus');
    })
    .on('click','#app BUTTON:enabled', event => {
      var $button = $(event.target);
      var handler = $button.data('handler') || buttons[$button.attr('name')];

      // Ignore disabled buttons
      if (window.getComputedStyle(event.target).cursor !== 'pointer')
        return;

      handler($button);

      Tactics.playSound('select');
    });

  loadResources().then(async () => {
    game = await Tactics.createLocalGame(gameStateData);
    settings = new GameSettingsModal(
      { game, gameType:{ name:'Chaos' } },
      {
        autoShow: false,
        hideOnCancel: true,
      },
    );
    startGame();
  });
});

$(window).on('resize', () => {
  if (game) game.resize();
});

async function loadResources() {
  let unitTypes = [
    'Knight',
    'ChaosSeed',
    'ChaosDragon',
  ];

  return new Promise(resolve => {
    progress
      .on('complete', () => {
        let core = Tactics.getSprite('core');

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

        let tapHandler = () => {
          progress.disableButtonMode(tapHandler);
          progress.message = 'One moment...';
          resolve();
        };
        progress.enableButtonMode(tapHandler);

        let action = pointer === 'mouse' ? 'Click' : 'Tap';
        progress.message = `${action} here to play!`;
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
      toggleUndoButton();
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

      if (!$('#game-play').hasClass('active')) {
        $('.buttons').removeClass('active');
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
      if (event.nvalue && event.ovalue === null)
        $card.addClass('show');
      else if (event.nvalue === null)
        $card.removeClass('show');
    })
    .on('lock-change', event => {
      if (event.nvalue === 'gameover') {
        $('#app').addClass('gameover');
        $('BUTTON[name=surrender]').addClass('ready');
      }
      else {
        $('#app').removeClass('gameover');
        $('BUTTON[name=surrender]').removeClass('ready');
      }

      if (event.nvalue)
        $('#app').addClass('locked');
      else
        $('#app').removeClass('locked');
    });

  await game.start();

  updateRotateButton();
  progress.hide();
  $('#app').addClass('show');

  game.play(0);
}

function toggleUndoButton() {
  const canUndo = game.canUndo();
  $('BUTTON[name=undo]').prop('disabled', !canUndo);
}
