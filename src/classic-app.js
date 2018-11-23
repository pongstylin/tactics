Tactics.App = (function ($,window,document)
{
  var self = {};
  var board;
  var pointer;
  var fullscreen = Tactics.fullscreen;

  // To be retreived from the game server.
  //teams[0].s = teams[1].s =  {af:3,bc:6,bd:1,bh:1,bi:8,cb:7,ce:0,cf:0,cg:0,cj:2};a
  var colors = [2,10,8,7];
  var data =
  {
    teams:
    [
      {
        c: 10,
        b: 0,
        u: {
          fa:{t:3,d:'S'},
          bc:{t:7,d:'S'},ec:{t:0,d:'S'},fc:{t:0,d:'S'},gc:{t:0,d:'S'},
        }
      },
      {
        c: 2,
        b: 0,
        u: {
          ei:{t:0,d:'N'},fi:{t:0,d:'N'},gi:{t:0,d:'N'},ji:{t:7,d:'N'},
          fk:{t:3,d:'N'},
        }
      },
    ],
    turns:[0, 1]
  };

  $(window)
    .on('load',function ()
    {
      var buttons =
      {
        swapbar:function ()
        {
          var $active = $('#app > .buttons.active');
          var $next = $active.next('.buttons');

          if (!$next.length)
            $next = $('#app > .buttons').first();

          $active.removeClass('active');
          $next.addClass('active');
        },
        resize:fullscreen.toggle,
        movebar:function ($button)
        {
          $('#app').toggleClass('left right');
          $button.toggleClass('fa-rotate-270 fa-rotate-90');
        },
        rotate:function ($button)
        {
          var cls,per;

          if ($button.hasClass('fa-rotate-90'))
          {
            cls = 'fa-rotate-90 fa-rotate-180';
            per = 'W';
          }
          else if ($button.hasClass('fa-rotate-180'))
          {
            cls = 'fa-rotate-180 fa-rotate-270';
            per = 'N';
          }
          else if ($button.hasClass('fa-rotate-270'))
          {
            cls = 'fa-rotate-270';
            per = 'E';
          }
          else
          {
            cls = 'fa-rotate-90';
            per = 'S';
          }

          $button.toggleClass(cls);
          Tactics.board.rotate(per);
        },
        sound:function ($button)
        {
          $button.toggleClass('fa-bell fa-bell-slash');

          if ($button.hasClass('fa-bell'))
          {
            Howler.unmute();
          }
          else
          {
            Howler.mute();
          }
        },
        select:function ($button)
        {
          var selected = board.selected;
          var viewed = board.viewed;
          var mode = $button.val();

          if (mode == 'turn' && board.selectMode == 'turn')
          {
            if (viewed)
            {
              if (viewed.activated == 'turn')
                viewed.activate('direction',true);
            }
            else if (selected)
            {
              if (selected.activated == 'turn')
              {
                selected.activate('direction');
                $('BUTTON[name=pass]').addClass('ready');
              }
              else
              {
                selected.turn(90).hideMode().showMode();
                $('BUTTON[name=select][value=turn]').removeClass('ready');
              }
            }
          }
          else
          {
            board.setSelectMode(mode);
          }
        },
        pass:function ()
        {
          board.endTurn();
        },
        surrender:function ()
        {
          $('#popup #message').text('Are you sure you want to reset the game?');
          $('#popup BUTTON[name=yes]').data('handler',function ()
          {
            setupGame();
            $('#overlay,#popup').hide();
          });
          $('#overlay,#popup').show();
        }
      };

      $('#overlay').on('click tap', () => {
        if ($('#popup').hasClass('error')) return;
        $('#overlay,#popup').hide();
      });

      $('#popup BUTTON[name=no]').data('handler',function ()
      {
        $('#overlay,#popup').hide();
      });

      if ('ontouchstart' in window)
      {
        $('body').addClass(pointer = 'touch');
      }
      else
      {
        $('body').addClass(pointer = 'mouse');
      }

      Tactics.init($('#field'));

      $(window).trigger('resize');

      $('#loader').css
      ({
        top:($(window).height()/2)-($('#loader').height()/2)+'px',
        left:($(window).width()/2)-($('#loader').width()/2)+'px',
        visibility:'visible'
      });

      board = Tactics.board;

      board
        .on('select-mode-change', event => {
          let selected    = board.viewed || board.selected;
          let old_mode    = event.ovalue;
          let new_mode    = event.nvalue;
          let can_move    = !selected || selected.can_move();
          let can_attack  = !selected || selected.can_attack();
          let can_special = selected && selected.can_special();

          $('BUTTON[name=select][value='+old_mode+']').removeClass('selected');
          $('BUTTON[name=select][value='+new_mode+']').addClass('selected');

          if (!$('#game-play').hasClass('active')) {
            $('.buttons').removeClass('active');
            $('#game-play').addClass('active');
          }

          $('BUTTON[name=select][value=move]').prop('disabled', !can_move);
          $('BUTTON[name=select][value=attack]').prop('disabled', !can_attack);

          if (new_mode === 'attack' && can_special)
            $('BUTton[name=select][value=attack]').addClass('ready');
          else
            $('BUTton[name=select][value=attack]').removeClass('ready');

          if (new_mode === 'turn' && pointer === 'touch' && selected && !selected.viewed)
            $('BUTTON[name=select][value=turn]').addClass('ready');
          else
            $('BUTTON[name=select][value=turn]').removeClass('ready');

          if (new_mode === 'ready')
            $('BUTTON[name=pass]').addClass('ready');
          else
            $('BUTTON[name=pass]').removeClass('ready');
        })
        .on('card-change', event => {
          let $card = $('#card');

          if (event.nvalue && event.ovalue === null) {
            $card.stop().fadeIn()
          }
          else if (event.nvalue === null) {
            $card.stop().fadeOut();
          }
        })
        .on('lock-change', event => {
          $('#app').toggleClass('locked');
        });

      if (!fullscreen.isAvailable())
        $('BUTTON[name=resize]').toggleClass('hidden');

      if (Howler.noAudio)
        $('BUTTON[name=sound]').toggleClass('hidden');

      $('BODY')
        .on('mouseover','#app BUTTON:enabled',function ()
        {
          var $button = $(this);
          if ($button.css('cursor') != 'pointer') return;

          if ($button.parents('.locked').length)
          {
            if ($button.parents('#game-settings').length)
            {
              if ($button.attr('name') === 'rotate')
                return;
            }
            else
              return;
          }

          Tactics.sounds.focus.play();
        })
        .on('click tap','#app BUTTON:enabled',function ()
        {
          var $button = $(this);
          var handler = $button.data('handler') || buttons[$button.attr('name')];

          if ($button.parents('.locked').length)
          {
            if ($button.parents('#game-settings').length)
            {
              if ($button.attr('name') === 'rotate')
                return;
            }
            else
              return;
          }

          handler($button);

          Tactics.sounds.select.play();
          Tactics.render();
        });

      load();
    })
    .on('resize',function ()
    {
      var $resize = $('BUTTON[name=resize]');

      Tactics.resize($('#field').width(),$(window).height());

      if (fullscreen.isEnabled() !== $resize.hasClass('fa-compress'))
        $resize.toggleClass('fa-expand fa-compress');
    });

  function load()
  {
    var $progress = $('#progress');
    var resources = [];
    var loaded = 0;
    var loader = PIXI.loader;
    var utypes = [];

    function progress()
    {
      var percent = (++loaded / resources.length) * 100;
      var action = pointer === 'mouse' ? 'Click' : 'Tap';

      $progress.width(percent);

      if (percent === 100)
      {
        $('#loader')
          .css({
            cursor:'pointer'
          })
          .one('click tap',function ()
          {
            board.draw();

            $('#splash').hide();
            $('#app').css('visibility','visible');

            setupGame();
          })
          .find('.message')
            .text(action+' here to play!')
      }
    }

    $.each(Tactics.images,function (i,image_url)
    {
      var url = 'http://www.taorankings.com/html5/images/'+image_url;

      resources.push(url);

      loader.add
      ({
        url:url
      });
    });

    $.each(Tactics.sounds,function (name,sound)
    {
      var howl;
      var url;

      if (typeof sound === 'string') sound = {file:sound};
      url = 'http://www.taorankings.com/html5/sounds/'+sound.file;

      resources.push(url);

      howl = new Howl
      ({
        urls:[url+'.mp3',url+'.ogg'],
        sprite:sound.sprite,
        volume:sound.volume || 1,
        rate:sound.rate || 1,
        onload:function ()
        {
          progress();
        },
        onloaderror:function ()
        {
        }
      });

      Tactics.sounds[name] = howl;
    });

    // Trophy
    $.each(Tactics.units[19].frames,function (i,frame)
    {
      $.each(frame.c,function (i,sprite)
      {
        var url = 'http://www.taorankings.com/html5/units/19/image'+sprite.id+'.png';

        if (resources.indexOf(url) !== -1)
          return;

        resources.push(url);
        loader.add
        ({
          url:url
        });
      });
    });

    $.each(data.teams,function (i,team)
    {
      var units = $.extend({},team.u);

      if (i === 4)
        units.aa = {t:22};

      $.each(units,function (i,unit)
      {
        var units = Tactics.units;
        var utype = unit.t;
        var sprites = [];

        if (utypes.indexOf(utype) > -1) return;
        utypes.push(utype);

        if (units[utype].sounds)
        {
          $.each(units[utype].sounds,function (name,sound)
          {
            var howl;
            var url;

            if (typeof sound === 'string') sound = {file:sound};
            url = 'http://www.taorankings.com/html5/sounds/'+sound.file;

            resources.push(url);

            howl = new Howl
            ({
              urls:[url+'.mp3',url+'.ogg'],
              sprite:sound.sprite,
              volume:sound.volume || 1,
              rate:sound.rate || 1,
              onload:function ()
              {
                progress();
              },
              onloaderror:function ()
              {
              }
            });

            units[utype].sounds[name] = howl;
          });
        }

        // Test Unit Render Data
        if (units[utype].frames_url) {
          let frames_url = units[utype].frames_url;
          resources.push(frames_url);

          $.getJSON(frames_url).then(renderData => {
            Object.assign(units[utype], renderData);
            progress();
          });
        }
        else if (units[utype].frames)
        {
          $.each(units[utype].frames,function (i,frame)
          {
            if (!frame) return;

            $.each(frame.c,function (i,sprite)
            {
              var url = 'http://www.taorankings.com/html5/units/'+utype+'/image'+sprite.id+'.png';

              if (resources.indexOf(url) !== -1)
                return;

              resources.push(url);
              loader.add
              ({
                url:url
              });
            });
          });
        }
        else
        {
          $.each(units[utype].stills,function (direction,still)
          {
            sprites.push(still);
          });

          if (units[utype].walks)
          {
            $.each(units[utype].walks,function (direction,walk)
            {
              sprites.push.apply(sprites,walk);
            });
          }

          if (units[utype].attacks)
          {
            $.each(units[utype].attacks,function (direction,attack)
            {
              sprites.push.apply(sprites,attack);
            });
          }

          if (units[utype].blocks)
          {
            $.each(units[utype].blocks,function (direction,block)
            {
              sprites.push.apply(sprites,block);
            });
          }

          $.each(sprites,function (i,sprite)
          {
            $.each(sprite,function (aspect,image)
            {
              var url = 'http://www.taorankings.com/html5/units/'+utype+'/'+aspect+'/image'+image.src+'.png';

              if (!image.src) return;
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
    board.reset().addTeams(data.teams);
    board.turns = data.turns.slice().spin();

    // Give Data URIs a chance to load.
    setTimeout(() => {
      Tactics.render();

      board.startTurn();
    }, 1);
  }

  return self;
})(jQuery,window,document);
