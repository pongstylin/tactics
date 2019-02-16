Tactics.App = (function ($, window, document) {
  'use strict';

  var self = {};
  var board;
  var pointer;
  var fullscreen = Tactics.fullscreen;

  // Ultimately, team data will be retreived from the game server.
  var data = {
    teams: [
      {
        n: 'Blue',
        c: 10,
        b: 0,
        u: {
          fa:{t:3, d:'S'},
          cb:{t:6, d:'S'},db:{t:1, d:'S'},hb:{t:1, d:'S'},ib:{t:8, d:'S'},
          bc:{t:7, d:'S'},ec:{t:0, d:'S'},fc:{t:0, d:'S'},gc:{t:0, d:'S'},jc:{t:2, d:'S'},
        }
      },
      {
        n: 'Red',
        c: 2,
        b: 0,
        u: {
          bi:{t:2, d:'N'},ei:{t:0, d:'N'},fi:{t:0, d:'N'},gi:{t:0, d:'N'},ji:{t:7, d:'N'},
          cj:{t:8, d:'N'},dj:{t:1, d:'N'},hj:{t:1, d:'N'},ij:{t:6, d:'N'},
          fk:{t:3, d:'N'},
        }
      },
    ],
  };

  $(window)
    .on('load', function () {
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
            Tactics.panzoom.lock();
          else
            Tactics.panzoom.unlock();
        },
        rotate: function ($button) {
          var cls,per;

          if ($button.hasClass('fa-rotate-90')) {
            cls = 'fa-rotate-90 fa-rotate-180';
            per = 'W';
          }
          else if ($button.hasClass('fa-rotate-180')) {
            cls = 'fa-rotate-180 fa-rotate-270';
            per = 'N';
          }
          else if ($button.hasClass('fa-rotate-270')) {
            cls = 'fa-rotate-270';
            per = 'E';
          }
          else {
            cls = 'fa-rotate-90';
            per = 'S';
          }

          $button.toggleClass(cls);
          Tactics.board.rotate(per);
        },
        undo: function () {
          board.undo();
        },
        sound: function ($button) {
          $button.toggleClass('fa-bell fa-bell-slash');

          Howler.mute($button.hasClass('fa-bell-slash'));
        },
        select: function ($button) {
          let mode = $button.val();

          if (mode == 'turn' && $button.hasClass('ready')) {
            $('BUTTON[name=select][value=turn]').removeClass('ready');
            return board.zoomToTurnOptions();
          }

          board.setSelectMode(mode);
        },
        pass: function () {
          board.takeAction({type:'endTurn'});
        },
        surrender: function () {
          $('#popup #message').text('Are you sure you want to reset the game?');
          $('#popup BUTTON[name=yes]').data('handler', () => {
            setupGame();
            $('#overlay,#popup').hide();
          });
          $('#overlay,#popup').show();
        }
      };

      $('#overlay').on('click', () => {
        if ($('#popup').hasClass('error')) return;
        $('#overlay,#popup').hide();
      });

      $('#popup BUTTON[name=no]').data('handler', () => {
        $('#overlay,#popup').hide();
      });

      if ('ontouchstart' in window) {
        $('body').addClass(pointer = 'touch');
      }
      else {
        $('body').addClass(pointer = 'mouse');
      }

      Tactics.init($('#field').get(0));

      $(window).trigger('resize');

      $('#loader').css({
        top:($(window).height()/2)-($('#loader').height()/2)+'px',
        left:($(window).width()/2)-($('#loader').width()/2)+'px',
        visibility:'visible'
      });

      board = Tactics.board;

      board
        .on('select-mode-change', event => {
          let panzoom     = Tactics.panzoom;
          let selected    = board.viewed || board.selected;
          let old_mode    = event.ovalue;
          let new_mode    = event.nvalue;
          let can_move    = !selected || selected.canMove();
          let can_attack  = !selected || selected.canAttack();
          let can_special = selected && selected.canSpecial();
          let can_undo    = board.canUndo();

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
          $('BUTTON[name=undo]').prop('disabled', !can_undo);

          if (new_mode === 'attack' && can_special && !selected.viewed)
            $('BUTton[name=select][value=attack]').addClass('ready');
          else
            $('BUTton[name=select][value=attack]').removeClass('ready');

          if (new_mode === 'turn' && panzoom.canZoom() && selected && !selected.viewed)
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
          let $card = $('#card');

          if (event.nvalue && event.ovalue === null)
            $card.addClass('show');
          else if (event.nvalue === null)
            $card.removeClass('show');
        })
        .on('lock-change', event => {
          if (event.nvalue === 'gameover')
            $('#app').addClass('gameover');
          else
            $('#app').removeClass('gameover');

          if (event.nvalue)
            $('#app').addClass('locked');
          else
            $('#app').removeClass('locked');
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
          let selected = board.selected;
          let readySpecial = selected.readySpecial();
          let button = event.target;

          $(document).one('mouseup touchend', event => {
            if (event.target === button)
              readySpecial.release();
            else
              readySpecial.cancel();
          });
        })
        .on('mouseover','#app BUTTON:enabled', event => {
          var $button = $(event.target);

          // Ignore disabled buttons
          if (window.getComputedStyle(event.target).cursor !== 'pointer')
            return;

          Tactics.sounds.focus.play();
        })
        .on('click','#app BUTTON:enabled', event => {
          var $button = $(event.target);
          var handler = $button.data('handler') || buttons[$button.attr('name')];

          // Ignore disabled buttons
          if (window.getComputedStyle(event.target).cursor !== 'pointer')
            return;

          handler($button);

          Tactics.sounds.select.play();
          Tactics.render();
        });

      load();
    })
    .on('resize', () => {
      let $resize = $('BUTTON[name=resize]');
      if (fullscreen.isEnabled() !== $resize.hasClass('fa-compress'))
        $resize.toggleClass('fa-expand fa-compress');

      Tactics.resize();
    });

  function load() {
    let $progress = $('#progress');
    let resources = [];
    let loaded = 0;
    let loader = PIXI.loader;
    let unit_types = [];
    let effects = {};

    function progress() {
      let percent = (++loaded / resources.length) * 100;
      let action = pointer === 'mouse' ? 'Click' : 'Tap';

      $progress.width(percent);

      if (percent === 100) {
        $('#loader')
          .addClass('complete')
          .one('click', () => {
            board.draw();

            $('.message').text('One moment...');

            setTimeout(setupGame, 1);
          })
          .find('.message')
            .text(action+' here to play!')
      }
    }

    Tactics.images.forEach(image_url => {
      let url = 'https://legacy.taorankings.com/images/'+image_url;

      resources.push(url);
      loader.add({url: url});
    });

    Object.keys(Tactics.sounds).forEach(name => {
      let sound = Tactics.sounds[name];
      if (typeof sound === 'string')
        sound = {file: sound};

      let url = 'https://tactics.taorankings.com/sounds/'+sound.file;

      Tactics.sounds[name] = new Howl({
        src:        [url+'.mp3', url+'.ogg'],
        sprite:      sound.sprite,
        volume:      sound.volume || 1,
        rate:        sound.rate || 1,
        onload:      () => progress(),
        onloaderror: () => {},
      });

      resources.push(url);
    });

    Object.keys(Tactics.effects).forEach(name => {
      let effect_url = Tactics.effects[name].frames_url;

      if (!(effect_url in effects)) {
        resources.push(effect_url);

        effects[effect_url] = $.getJSON(effect_url).then(renderData => {
          progress();
          return renderData;
        });
      }
  
      effects[effect_url].then(renderData => {
        Object.assign(Tactics.effects[name], renderData);
        return renderData;
      });
    });

    let trophy_url = Tactics.units[19].frames_url;
    resources.push(trophy_url);

    $.getJSON(trophy_url).then(renderData => {
      Object.assign(Tactics.units[19], renderData);
      progress();
    });

    data.teams.forEach(team => {
      Object.values(team.u).forEach(u => {
        let units     = Tactics.units;
        let unit_type = u.t;
        let unit      = units[unit_type];
        let sprites   = [];

        if (unit_types.indexOf(unit_type) > -1)
          return;
        unit_types.push(unit_type);

        if (unit.sounds) {
          Object.keys(unit.sounds).forEach(name => {
            let sound = unit.sounds[name];
            if (typeof sound === 'string')
              sound = {file: sound};

            let url = 'https://tactics.taorankings.com/sounds/'+sound.file;

            unit.sounds[name] = new Howl({
              src:        [url+'.mp3', url+'.ogg'],
              sprite:      sound.sprite,
              volume:      sound.volume || 1,
              rate:        sound.rate || 1,
              onload:      () => progress(),
              onloaderror: () => {},
            });

            resources.push(url);
          });
        }

        if (unit.effects) {
          Object.keys(unit.effects).forEach(name => {
            let effect_url = unit.effects[name].frames_url;

            if (!(effect_url in effects)) {
              resources.push(effect_url);

              effects[effect_url] = $.getJSON(effect_url).then(renderData => {
                progress();
                return renderData;
              });
            }
  
            effects[effect_url].then(renderData => {
              Object.assign(unit.effects[name], renderData);
              return renderData;
            });
          });
        }

        if (unit.frames_url) {
          let frames_url = unit.frames_url;
          resources.push(frames_url);

          $.getJSON(frames_url).then(renderData => {
            Object.assign(unit, renderData);
            progress();
          });
        }
        // Legacy
        else if (unit.frames) {
          unit.frames.forEach(frame => {
            if (!frame) return;

            frame.c.forEach(sprite => {
              let url = 'https://legacy.taorankings.com/units/'+unit_type+'/image'+sprite.id+'.png';
              if (resources.indexOf(url) !== -1)
                return;

              resources.push(url);
              loader.add({url: url});
            });
          });
        }
        // Legacy
        else {
          sprites.push.apply(sprites, Object.values(unit.stills));

          if (unit.walks)
            sprites.push.apply(sprites, [].concat.apply([], Object.values(unit.walks)));

          if (unit.attacks)
            sprites.push.apply(sprites, [].concat.apply([], Object.values(unit.attacks)));

          if (unit.blocks)
            sprites.push.apply(sprites, [].concat.apply([], Object.values(unit.blocks)));

          sprites.forEach(sprite => {
            Object.keys(sprite).forEach(name => {
              let image = sprite[name];
              if (!image.src) return;

              let url = 'https://legacy.taorankings.com/units/'+unit_type+'/'+name+'/image'+image.src+'.png';
              if (resources.indexOf(url) !== -1)
                return;

              resources.push(url);
              loader.add({url: url});
            });
          });
        }
      });
    });

    loader
      .on('progress',progress)
      .load();
  }

  function setupGame() {
    // Preload the Trophy data URLs
    let trophy = new Tactics.Unit(19);
    trophy.drawAvatar();

    data.teams.spin();
    board.reset().addTeams(data.teams);

    // Give Data URIs a chance to load.
    setTimeout(() => {
      Tactics.render();

      board.startTurn();

      $('#splash').hide();
      $('#app').css('visibility','visible');
    }, 1);
  }

  return self;
})(jQuery,window,document);
