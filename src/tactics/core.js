Tactics = (function () {
  'use strict';

  var self = {};
  var stage;
  var renderer;
  var rendering = false;
  var render = () => {
    self.emit({type:'render'});

    // This is a hammer.  Without it, the mouse cursor will not change to a
    // pointer and back when needed without moving the mouse.
    renderer.plugins.interaction.update();

    //console.log('render', +new Date());
    renderer.render(stage);
    rendering = false;
  };

  utils.addEvents.call(self);

  $.extend(self, {
    width:22+(88*9)+22,
    height:38+4+(56*9)+4,
    utils:{},
    animators: {},

    init: function (container) {
      // We don't need an infinite loop, thanks.
      PIXI.ticker.shared.autoStart = false;

      stage = self.stage = new PIXI.Container();

      renderer = PIXI.autoDetectRenderer(self.width, self.height);

      // Let's not go crazy with the move events.
      renderer.plugins.interaction.moveWhenInside = true;

      let canvas = self.canvas = renderer.view;
      canvas.id = 'board';
      container.appendChild(canvas);

      self.board = new Tactics.Board();
      self.panzoom = panzoom({
        target: canvas,
        locked: true,
      });
    },
    /*
     * Allow touch devices to upscale to normal size.
     */
    resize: function () {
      let width = self.canvas.clientWidth;
      let height = self.canvas.clientHeight;
      let elementScale = Math.min(1, width / self.width, height / self.height);

      self.panzoom.maxScale = 1 / elementScale;
      self.panzoom.reset();

      return self;
    },
    draw: function (data) {
      var types = {C:'Container',G:'Graphics',T:'Text'};
      var elements = {};
      var context = data.context;

      if (!data.children) return;

      $.each(data.children,function (k,v)
      {
        var cls = types[v.type];
        var child;

        if (cls == 'Text')
        {
          child = new PIXI[cls](v.text || '',$.extend({},data.textStyle,v.style || {}));
        }
        else
        {
          child = new PIXI[cls]();
        }

        if ('x'        in v) child.position.x = v.x;
        if ('y'        in v) child.position.y = v.y;
        if ('visible'  in v) child.visible = v.visible;
        if ('onSelect' in v)
        {
          child.interactive = child.buttonMode = true;
          child.hitArea = new PIXI.Rectangle(0,0,v.w,v.h);
          child.click = child.tap = function () { v.onSelect.call(child,child); };
        }
        if ('children' in v) $.extend(elements,self.draw($.extend({},data,{context:child,children:v.children})));
        if ('draw'     in v) v.draw(child);

        context.addChild(elements[k] = child);
      });

      return elements;
    },
    /*
     * Most games have a "render loop" that refreshes all display objects on the
     * stage every time the screen refreshes - about 60 frames per second.  The
     * animations in this game runs at about 12 frames per second and do not run
     * at all times.  To improve battery life on mobile devices, it is better to
     * only render when needed.  Only two things may cause the stage to change:
     *   1) An animation is being run.
     *   2) The user interacted with the game.
     *
     * So, call this method once per animation frame or once after handling a
     * user interaction event.  If this causes the render method to be called
     * more frequently than the screen refresh rate (which is very possible
     * just by whipping around the mouse over the game board), then the calls
     * will be throttled thanks to requestAnimationFrame().
     */
    render: function () {
      if (rendering) return;
      rendering = true;

      requestAnimationFrame(render);
    },
    //
    // This clever function will call your animator every throttle millseconds
    // and render the result.  The animator must return false when the animation
    // is complete.  The animator is passed the number of frames that should be
    // skipped to maintain speed.
    //
    renderAnim: function (anim, fps) {
      let self = this;
      let throttle = 1000 / fps;
      let animators = [anim];
      let start;
      let delay = 0;
      let count = 0;
      let skip = 0;
      let i;

      let loop = now => {
        skip = 0;

        // stop the loop if all animators returned false
        if (animators.length) {
          if (count) {
            delay = (now - start) - (count * throttle);

            if (delay > throttle) {
              skip = Math.floor(delay / throttle);
              count += skip;

              requestAnimationFrame(loop);
            }
            else {
              setTimeout(() => requestAnimationFrame(loop), throttle - delay);
            }
          }
          else {
            start = now;
            setTimeout(() => requestAnimationFrame(loop), throttle);
          }

          // Iterate backward since elements may be removed.
          for (i = animators.length-1; i > -1; i--) {
            if (animators[i](skip) === false)
              animators.splice(i, 1);
          }
          render();
          count++;
        }
        else {
          delete self.animators[fps];
        }
      };

      // Stack multiple animations using the same FPS into one loop.
      if (fps in self.animators)
        self.animators[fps].push(anim);
      else {
        self.animators[fps] = animators;
        requestAnimationFrame(loop);
      }
    },
    images: [
      'board.jpg',
      'shock.png',
      'particle.png',
      'lightning-1.png',
      'lightning-2.png',
      'lightning-3.png',
      'death.png',
      'turn_tl.png',
      'turn_tr.png', // Inefficient.  Better to flip the tl horizontally.
      'turn_bl.png',
      'turn_br.png'  // Inefficient.  Better to flip the bl horizontally.
    ],
    sounds: {
      step:   'sound10',
      block:  'sound11',
      focus:  'sound15',
      select: 'sound14',
      strike: 'sound6',
    },
    effects: {
      focus: {
        frames_url: 'https://tactics.taorankings.com/json/focus.json',
        frames_offset: {y:-16},
      },
    },
    animations: {
      death: [
        [
          {src:'death.png',pos:{x: 0  ,y:-16  },scale:{x:1.416,y:1.5  },alpha:0.5 }
        ],
        [
          {src:'death.png',pos:{x: 0  ,y:-28  },scale:{x:1.167,y:2.166},alpha:0.69},
          {src:'death.png',pos:{x:-1  ,y:-18  },scale:{x:1.418,y:1.583},alpha:0.5 }
        ],
        [
          {src:'death.png',pos:{x:-0.5,y:-41  },scale:{x:0.956,y:2.833},alpha:0.35},
          {src:'death.png',pos:{x:-2  ,y:-27.5},scale:{x:1.251,y:2.126},alpha:0.69},
          {src:'death.png',pos:{x: 2  ,y:-18  },scale:{x:0.917,y:1.5  },alpha:0.5 }
        ],
        [
          {src:'death.png',pos:{x: 0.5,y:-21  },scale:{x:1.123,y:1.417},alpha:0.5 },
          {src:'death.png',pos:{x:-2  ,y:-38  },scale:{x:1.084,y:2.668},alpha:0.35},
          {src:'death.png',pos:{x: 2  ,y:-32  },scale:{x:0.750,y:2.417},alpha:0.69}
        ],
        [
          {src:'death.png',pos:{x:-0.8,y:-31.7},scale:{x:0.978,y:1.938},alpha:0.69},
          {src:'death.png',pos:{x: 1  ,y:-24  },scale:{x:0.999,y:1.417},alpha:0.5 },
          {src:'death.png',pos:{x: 2  ,y:-46.5},scale:{x:0.584,y:3.291},alpha:0.35}
        ],
        [
          {src:'death.png',pos:{x:-2  ,y:-43.5},scale:{x:0.832,y:2.459},alpha:0.35},
          {src:'death.png',pos:{x: 0  ,y:-36.5},scale:{x:1    ,y:1.958},alpha:0.69},
          {src:'death.png',pos:{x: 1  ,y:-27  },scale:{x:0.998,y:1.5  },alpha:0.5 }
        ],
        [
          {src:'death.png',pos:{x:-0.5,y:-48.5},scale:{x:0.958,y:2.458},alpha:0.35},
          {src:'death.png',pos:{x: 0  ,y:-38.5},scale:{x:0.915,y:2.126},alpha:0.69}
        ],
        [
          {src:'death.png',pos:{x:-0.5,y:-50  },scale:{x:0.791,y:2.752},alpha:0.35}
        ],
      ],
    },
    units:
    [
      {
        name:'Knight',
        ability:'Sword & Shield',
        power:22,
        armor:25,
        health:50,
        recovery:1,
        blocking:80,
        aType:'melee',
        aRadius:1,
        mRadius:3,
        sounds:
        {
          step:    'sound13',
          attack1: 'sound809',
          attack2: 'sound2021',
          block:   'sound12'
        },
        stills:
        {
          N:{anchor:{x:29,y:70},base:{src:'5235',x:1,y:0},color:{src:'5087',x:0, y:8},shadow:{src:'70', x:55,y:80,flip:1}},
          S:{anchor:{x:23,y:65},base:{src:'5011',x:1,y:0},color:{src:'5013',x:0, y:2},shadow:{src:'70', x:0, y:54}},
          W:{anchor:{x:51,y:65},base:{src:'5199',x:0,y:0},color:{src:'5051',x:32,y:1},shadow:{src:'111',x:3, y:48}},
          E:{anchor:{x:14,y:72},base:{src:'5274',x:0,y:0},color:{src:'5126',x:0, y:9},shadow:{src:'111',x:65,y:88,flip:1}}
        },
        walks:
        {
          N:
          [
            {anchor:{x:36,y:70},base:{src:'5248',x:2,y:0},color:{src:'5100',x:0, y:3},shadow:{src:'83',x:55,y:79,flip:1}},
            {anchor:{x:37,y:71},base:{src:'5250',x:3,y:0},color:{src:'5102',x:0, y:2},shadow:{src:'85',x:56,y:82,flip:1}},
            {anchor:{x:34,y:68},base:{src:'5252',x:3,y:0},color:{src:'5104',x:0, y:3},shadow:{src:'87',x:55,y:81,flip:1}},
            {anchor:{x:31,y:67},base:{src:'5245',x:0,y:0},color:{src:'5097',x:0, y:3},shadow:{src:'80',x:50,y:82,flip:1}},
            {anchor:{x:50,y:71},base:{src:'5243',x:0,y:0},color:{src:'5095',x:20,y:3},shadow:{src:'78',x:64,y:86,flip:1}},
            {anchor:{x:60,y:72},base:{src:'5241',x:0,y:0},color:{src:'5093',x:29,y:3},shadow:{src:'76',x:77,y:86,flip:1}},
            {anchor:{x:48,y:69},base:{src:'5239',x:0,y:0},color:{src:'5091',x:21,y:2},shadow:{src:'74',x:67,y:85,flip:1}},
            {anchor:{x:31,y:67},base:{src:'5237',x:0,y:0},color:{src:'5089',x:0, y:3},shadow:{src:'72',x:52,y:82,flip:1}}
          ],
          S:
          [
            {anchor:{x:14,y:57},base:{src:'5174',x:1,y:0},color:{src:'5025',x:0,y:2},shadow:{src:'83',x:0,y:49}},
            {anchor:{x:15,y:58},base:{src:'5176',x:2,y:0},color:{src:'5027',x:0,y:3},shadow:{src:'85',x:0,y:47}},
            {anchor:{x:16,y:58},base:{src:'5178',x:1,y:0},color:{src:'5029',x:0,y:1},shadow:{src:'87',x:0,y:46}},
            {anchor:{x:16,y:62},base:{src:'5172',x:0,y:0},color:{src:'5023',x:1,y:3},shadow:{src:'80',x:0,y:46}},
            {anchor:{x:11,y:61},base:{src:'5170',x:3,y:0},color:{src:'5021',x:0,y:5},shadow:{src:'78',x:0,y:45}},
            {anchor:{x:14,y:61},base:{src:'5168',x:4,y:0},color:{src:'5019',x:0,y:6},shadow:{src:'76',x:0,y:46}},
            {anchor:{x:16,y:63},base:{src:'5166',x:3,y:0},color:{src:'5017',x:0,y:6},shadow:{src:'74',x:0,y:46}},
            {anchor:{x:18,y:63},base:{src:'5164',x:0,y:0},color:{src:'5015',x:0,y:3},shadow:{src:'72',x:-1,y:46}}
          ],
          W:
          [
            {anchor:{x:58,y:57},base:{src:'5211',x:0,y:0},color:{src:'5063',x:32,y:2},shadow:{src:'124',x:-1,y:46}},
            {anchor:{x:60,y:58},base:{src:'5213',x:0,y:0},color:{src:'5065',x:29,y:3},shadow:{src:'126',x:1,y:46}},
            {anchor:{x:56,y:58},base:{src:'5215',x:0,y:0},color:{src:'5067',x:31,y:2},shadow:{src:'128',x:-4,y:46}},
            {anchor:{x:47,y:61},base:{src:'5209',x:0,y:0},color:{src:'5061',x:21,y:2},shadow:{src:'121',x:-3,y:49}},
            {anchor:{x:37,y:57},base:{src:'5207',x:0,y:0},color:{src:'5059',x:5 ,y:2},shadow:{src:'119',x:-1,y:48}},
            {anchor:{x:32,y:58},base:{src:'5205',x:0,y:0},color:{src:'5057',x:0 ,y:3},shadow:{src:'117',x:0,y:47}},
            {anchor:{x:35,y:59},base:{src:'5203',x:0,y:0},color:{src:'5055',x:5 ,y:3},shadow:{src:'115',x:-1,y:47}},
            {anchor:{x:47,y:61},base:{src:'5201',x:0,y:0},color:{src:'5053',x:21,y:2},shadow:{src:'113',x:0,y:48}}
          ],
          E:
          [
            {anchor:{x:10,y:74},base:{src:'5286',x:2,y:0},color:{src:'5138',x:0,y:6},shadow:{src:'124',x:73,y:85,flip:1}},
            {anchor:{x:13,y:75},base:{src:'5288',x:4,y:0},color:{src:'5140',x:0,y:5},shadow:{src:'126',x:75,y:86,flip:1}},
            {anchor:{x:16,y:72},base:{src:'5290',x:0,y:0},color:{src:'5142',x:0,y:5},shadow:{src:'128',x:80,y:84,flip:1}},
            {anchor:{x:21,y:68},base:{src:'5284',x:0,y:0},color:{src:'5136',x:0,y:4},shadow:{src:'121',x:74,y:79,flip:1}},
            {anchor:{x:20,y:72},base:{src:'5282',x:1,y:0},color:{src:'5134',x:0,y:4},shadow:{src:'119',x:62,y:81,flip:1}},
            {anchor:{x:20,y:74},base:{src:'5280',x:2,y:0},color:{src:'5132',x:0,y:4},shadow:{src:'117',x:55,y:84,flip:1}},
            {anchor:{x:22,y:70},base:{src:'5278',x:1,y:0},color:{src:'5130',x:0,y:4},shadow:{src:'115',x:62,y:82,flip:1}},
            {anchor:{x:21,y:69},base:{src:'5276',x:0,y:0},color:{src:'5128',x:0,y:5},shadow:{src:'113',x:71,y:81,flip:1}}
          ]
        },
        attacks:
        {
          N:
          [
            {anchor:{x:29,y:91 },base:{src:'5256',x:0,y:0},color:{src:'5108',x:0 ,y:27},shadow:{src:'93' ,x:62,y:101,flip:1}},
            {anchor:{x:30,y:88 },base:{src:'5258',x:1,y:0},color:{src:'5110',x:0 ,y:21},shadow:{src:'95' ,x:66,y:98 ,flip:1}},
            {anchor:{x:33,y:74 },base:{src:'5260',x:2,y:1},color:{src:'5112',x:0 ,y:0 },shadow:{src:'97' ,x:61,y:84 ,flip:1}},
            {anchor:{x:32,y:87 },base:{src:'5262',x:3,y:0},color:{src:'5114',x:0 ,y:8 },shadow:{src:'99' ,x:52,y:102,flip:1}},
            {anchor:{x:30,y:102},base:{src:'5264',x:0,y:0},color:{src:'5116',x:0 ,y:36},shadow:{src:'101',x:51,y:120,flip:1}},
            {anchor:{x:57,y:67 },base:{src:'5266',x:0,y:0},color:{src:'5118',x:32,y:2 },shadow:{src:'103',x:79,y:88 ,flip:1}},
            {anchor:{x:30,y:72 },base:{src:'5268',x:4,y:0},color:{src:'5120',x:0 ,y:9 },shadow:{src:'105',x:51,y:89 ,flip:1}}
          ],
          S:
          [
            {anchor:{x:29,y:65},base:{src:'5181',x:0,y:0},color:{src:'5033',x:0,y:2 },shadow:{src:'93' ,x:-1,y:54}},
            {anchor:{x:33,y:75},base:{src:'5183',x:0,y:0},color:{src:'5035',x:1,y:13},shadow:{src:'95' ,x: 0,y:64}},
            {anchor:{x:25,y:82},base:{src:'5185',x:1,y:0},color:{src:'5037',x:0,y:20},shadow:{src:'97' ,x: 0,y:71}},
            {anchor:{x:17,y:81},base:{src:'5187',x:0,y:0},color:{src:'5039',x:0,y:19},shadow:{src:'99' ,x: 0,y:65}},
            {anchor:{x:18,y:68},base:{src:'5189',x:0,y:0},color:{src:'5041',x:0,y:8 },shadow:{src:'101',x: 0,y:49}},
            {anchor:{x:19,y:68},base:{src:'5191',x:1,y:0},color:{src:'5043',x:0,y:7 },shadow:{src:'103',x: 0,y:46}},
            {anchor:{x:18,y:67},base:{src:"5193",x:1,y:0},color:{src:"5045",x:0,y:5 },shadow:{src:'105',x: 0,y:49}}
          ],
          W:
          [
            {anchor:{x:45,y:71},base:{src:'5217',x:0,y:0},color:{src:'5069',x:25,y:8 },shadow:{src:'133',x: 0,y:50}},
            {anchor:{x:22,y:78},base:{src:'5219',x:1,y:0},color:{src:'5071',x:0 ,y:4 },shadow:{src:'135',x: 0,y:55}},
            {anchor:{x:28,y:75},base:{src:'5221',x:0,y:0},color:{src:'5073',x:5 ,y:3 },shadow:{src:'137',x: 0,y:57}},
            {anchor:{x:36,y:90},base:{src:'5223',x:0,y:0},color:{src:'5075',x:1 ,y:27},shadow:{src:'139',x:-1,y:77}},
            {anchor:{x:51,y:63},base:{src:'5225',x:0,y:0},color:{src:'5077',x:22,y:2 },shadow:{src:'141',x: 1,y:49}},
            {anchor:{x:37,y:64},base:{src:'5227',x:0,y:0},color:{src:'5079',x:13,y:2 },shadow:{src:'143',x:-1,y:50}},
            {anchor:{x:53,y:64},base:{src:'5229',x:0,y:0},color:{src:'5081',x:28,y:2 },shadow:{src:'145',x: 4,y:51}}
          ],
          E:
          [
            {anchor:{x:15,y:72},base:{src:'5293',x:1,y:0},color:{src:'5145',x:0,y:9 },shadow:{src:'133',x:63,y:92 ,flip:1}},
            {anchor:{x:15,y:79},base:{src:'5295',x:1,y:0},color:{src:'5147',x:0,y:15},shadow:{src:'135',x:40,y:101,flip:1}},
            {anchor:{x:15,y:83},base:{src:'5297',x:2,y:0},color:{src:'5149',x:0,y:18},shadow:{src:'137',x:46,y:100,flip:1}},
            {anchor:{x:22,y:78},base:{src:'5299',x:0,y:0},color:{src:'5151',x:0,y:15},shadow:{src:'139',x:62,y:90 ,flip:1}},
            {anchor:{x:26,y:88},base:{src:'5301',x:3,y:0},color:{src:'5153',x:0,y:24},shadow:{src:'141',x:79,y:101,flip:1}},
            {anchor:{x:31,y:72},base:{src:'5303',x:5,y:0},color:{src:'5155',x:0,y:8 },shadow:{src:'143',x:72,y:85 ,flip:1}},
            {anchor:{x:24,y:69},base:{src:'5305',x:0,y:0},color:{src:'5157',x:0,y:6 },shadow:{src:'145',x:76,y:81 ,flip:1}}
          ]
        },
        blocks:
        {
          N:
          [
            {anchor:{x:28,y:74},base:{src:'5270',x:1,y:0},color:{src:'5122',x:0,y:12},shadow:{src:'107',x:53,y:84,flip:1}},
            {anchor:{x:25,y:78},base:{src:'5272',x:0,y:0},color:{src:'5124',x:0,y:15},shadow:{src:'109',x:49,y:88,flip:1}}
          ],
          S:
          [
            {anchor:{x:22,y:64},base:{src:'5195',x:1,y:0},color:{src:'5047',x:0,y:2},shadow:{src:'107',x: 0,y:53}},
            {anchor:{x:20,y:63},base:{src:'5197',x:0,y:0},color:{src:'5049',x:0,y:1},shadow:{src:'109',x:-1,y:52}}
          ],
          W:
          [
            {anchor:{x:32,y:64},base:{src:'5231',x:0,y:0},color:{src:'5083',x:7,y:1},shadow:{src:'147',x:-18,y:48}},
            {anchor:{x:34,y:63},base:{src:'5233',x:0,y:0},color:{src:'5085',x:4,y:2},shadow:{src:'149',x:-15,y:48}}
          ],
          E:
          [
            {anchor:{x:14,y:72},base:{src:'5307',x:1,y:0},color:{src:'5159',x:0,y:9},shadow:{src:'147',x:67,y:87,flip:1}},
            {anchor:{x:14,y:70},base:{src:'5309',x:1,y:0},color:{src:'5161',x:0,y:7},shadow:{src:'149',x:66,y:84,flip:1}}
          ]
        },
        turns:
        {
          N: {anchor:{x:31,y:67},base:{src:'5237',x:0,y:0},color:{src:'5089',x:0, y:3},shadow:{src:'72',x:52,y:82,flip:1}},
          S: {anchor:{x:18,y:63},base:{src:'5164',x:0,y:0},color:{src:'5015',x:0,y:3},shadow:{src:'72',x:-1,y:46}},
          W: {anchor:{x:47,y:61},base:{src:'5201',x:0,y:0},color:{src:'5053',x:21,y:2},shadow:{src:'113',x:0,y:48}},
          E: {anchor:{x:21,y:69},base:{src:'5276',x:0,y:0},color:{src:'5128',x:0,y:5},shadow:{src:'113',x:71,y:81,flip:1}},
        }
      },
      {
        name:     'Pyromancer',
        ability:  'Fire Blast',
        power:    15,
        armor:    0,
        health:   30,
        recovery: 3,
        blocking: 33,
        aType:    'magic',
        aRadius:  3,
        mRadius:  3,
        sounds:   {
          attack: 'sound431',
        },
        effects: {
          fireblast: {
            frames_url:    'https://tactics.taorankings.com/json/explode.json',
            frames_offset: {y:-20},
          },
        },
        frames_url: 'https://tactics.taorankings.com/json/pyromancer.json',
        stills: {
          S: 1,
          W: 36,
          N: 71,
          E: 106,
        },
        backSteps: {
          S: [  2,   7],
          W: [ 37,  42],
          N: [ 72,  77],
          E: [107, 112],
        },
        foreSteps: {
          S: [  8,  11],
          W: [ 43,  46],
          N: [ 78,  81],
          E: [113, 116],
        },
        walks: {
          S: [ 12,  19],
          W: [ 47,  54],
          N: [ 82,  89],
          E: [117, 124],
        },
        attacks: {
          S: [ 21,  30],
          W: [ 56,  65],
          N: [ 91, 100],
          E: [126, 135],
        },
        blocks: {
          S: [ 26,  31],
          W: [ 61,  66],
          N: [ 96, 101],
          E: [131, 136],
        },
        turns: {
          S: 35,
          W: 70,
          N: 105,
          E: 140,
        },
      },
      {
        name:     'Scout',
        ability:  'Long Shot',
        power:    18,
        armor:    8,
        health:   40,
        recovery: 2,
        blocking: 60,
        mRadius:  4,
        aRadius:  6,
        aType:    'melee',
        aLOS:     true,
        sounds:   {
          attack: 'sound812',
        },
        frames_url: 'https://tactics.taorankings.com/json/scout.json',
        frames_offset: {y:5},
        stills: {
          S: 0,
          W: 42,
          N: 84,
          E: 126,
        },
        backSteps: {
          S: [  1,   6],
          W: [ 43,  48],
          N: [ 85,  90],
          E: [127, 132],
        },
        foreSteps: {
          S: [  7,  10],
          W: [ 49,  52],
          N: [ 91,  94],
          E: [133, 136],
        },
        walks: {
          S: [ 11,  18],
          W: [ 53,  60],
          N: [ 95, 102],
          E: [137, 144],
        },
        attacks: {
          S: [ 19,  32],
          W: [ 61,  74],
          N: [103, 116],
          E: [145, 158],
        },
        blocks: {
          S: [ 34,  39],
          W: [ 76,  81],
          N: [118, 123],
          E: [160, 165],
        },
        turns: {
          S: 41,
          W: 83,
          N: 125,
          E: 167,
        },
      },
      {
        name:    'Cleric',
        ability: 'Holy Mass',
        power:    12,
        armor:    0,
        health:   24,
        recovery: 5,
        blocking: 0,
        mRadius:  3,
        aRadius:  'all',
        aAll:     true,
        aType:    'magic',
        sounds:   {
          heal: 'sound1203',
        },
        frames_url: 'https://tactics.taorankings.com/json/cleric.json',
        stills: {
          S: 1,
          W: 45,
          N: 89,
          E: 133,
        },
        backSteps: {
          S: [  2,   7],
          W: [ 46,  51],
          N: [ 90,  95],
          E: [134, 139],
        },
        foreSteps: {
          S: [  8,  11],
          W: [ 52,  55],
          N: [ 96,  99],
          E: [140, 143],
        },
        walks: {
          S: [ 12,  19],
          W: [ 56,  63],
          N: [100, 107],
          E: [144, 151],
        },
        attacks: {
          S: [ 20,  43],
          W: [ 64,  87],
          N: [108, 131],
          E: [152, 175],
        },
        turns: {
          S: 44,
          W: 88,
          N: 132,
          E: 176,
        },
      },
      {name:'Barrier Ward'},
      {
        name:'Lightning Ward',
        ability:'Lightning',
				power:30,
				armor:18,
				health:56,
				recovery:4,
				blocking:100,
				aType:'magic',
				aRadius:3,
				mRadius:0,
				directional:false,
				sounds:
				{
					block:'sound8',
					heal:'sound1203',
          attack:'sound1368',
          lightning:'sound1370',              
        },
        stills: {
          S: 0,
          W: 0,
          N: 0,
          E: 0,
        },
        attacks: {
          S: [ 10, 30],
          W: [ 10, 30],
          N: [ 10, 30],
          E: [ 10, 30],
        },
        blocks: {
          S: [ 31,  42],
          W: [ 31,  42],
          N: [ 31,  42],
          E: [ 31,  42],
        },
        turns: {
          S: 0,
          W: 0,
          N: 0,
          E: 0,
        },                            
        frames_url: 'https://tactics.taorankings.com/json/lightning_ward.json',
        frames_offset: {x:5,y:-5},        
      },
      {
        name:     'Dark Magic Witch',
        ability:  'Black Spikes',
        power:    24,
        armor:    0,
        health:   28,
        recovery: 3,
        blocking: 20,
        mRadius:  3,
        aRadius:  4,
        aType:    'magic',
        aLinear:  true,
        sounds:   {
          attack1: 'sound431',
          attack2: 'sound1602',
          block1: {
            file: 'sound431',
            volume: 2,
            rate: 0.5,
            sprite: {
              block: [1400, 600],
            },
          },
          block2: 'sound11',
        },
        effects:  {
          black_spike: {
            frames_url:    'https://tactics.taorankings.com/json/black_spike.json',
            frames_offset: {y:-16},
          },
        },
        frames_url: 'https://tactics.taorankings.com/json/witch.json',
        stills: {
          S: 1,
          W: 38,
          N: 75,
          E: 112,
        },
        backSteps: {
          S: [  2,   7],
          W: [ 39,  44],
          N: [ 76,  81],
          E: [113, 118],
        },
        foreSteps: {
          S: [  8,  11],
          W: [ 45,  48],
          N: [ 82,  85],
          E: [119, 122],
        },
        walks: {
          S: [ 12,  19],
          W: [ 49,  56],
          N: [ 86,  93],
          E: [123, 130],
        },
        attacks: {
          S: [ 21,  32],
          W: [ 58,  69],
          N: [ 95, 106],
          E: [132, 143],
        },
        blocks: {
          S: [ 28,  33],
          W: [ 65,  70],
          N: [102, 107],
          E: [139, 144],
        },
        turns: {
          S: 37,
          W: 74,
          N: 111,
          E: 148,
        },
      },
      {
        name:      'Assassin',
        ability:   'Multi-Strike',
        specialty: 'Deathblow',
        power:     18,
        armor:     12,
        health:    35,
        recovery:  1,
        blocking:  70,
        aType:     'melee',
        aRadius:   1,
        aAll:      true,
        mRadius:   4,
        sounds:    {
          attack1: 'sound809',
          attack2: 'sound809',
          bomb1:   'sound1368',
          bomb2:   'sound1370',
          block:   {
            file: 'sound8',
            volume: 0.50,
            sprite: {
              block:[0,400],
            },
          },
        },
        effects: {
          explode: {
            frames_url:    'https://tactics.taorankings.com/json/explode.json',
            frames_offset: {y:-20},
          },
        },
        frames_url:    'https://tactics.taorankings.com/json/assassin.json',
        frames_offset: {y:-4},
        stills: {
          S: 1,
          W: 55,
          N: 109,
          E: 163,
        },
        backSteps: {
          S: [  2,   7],
          W: [ 56,  61],
          N: [110, 115],
          E: [164, 169],
        },
        foreSteps: {
          S: [  8,  11],
          W: [ 62,  65],
          N: [116, 119],
          E: [170, 173],
        },
        walks: {
          S: [ 12,  19],
          W: [ 66,  73],
          N: [120, 127],
          E: [174, 181],
        },
        attacks: {
          S: [ 21,  30],
          W: [ 75,  84],
          N: [129, 138],
          E: [183, 192],
        },
        special: {
          S: [ 32,  45],
          W: [ 86,  99],
          N: [140, 153],
          E: [194, 207],
        },
        blocks: {
          S: [ 47,  52],
          W: [101, 106],
          N: [155, 160],
          E: [209, 214],
        },
        turns: {
          S: 54,
          W: 108,
          N: 162,
          E: 216,
        },
      },
      {
        name:     'Enchantress',
        ability:  'Paralytic Field',
        power:    0,
        armor:    0,
        health:   35,
        recovery: 3,
        blocking: 0,
        aType:    'magic',
        aRadius:  2,
        aAll:     true,
        mRadius:  3,
        sounds:   {
          paralyze: 'sound2393',
        },
        effects: {
          streaks: {
            frames_url:    'https://tactics.taorankings.com/json/streaks.json',
            frames_offset: {y:-26},
          },
        },
        frames_url: 'https://tactics.taorankings.com/json/enchantress.json',
        stills: {
          S: 0,
          W: 36,
          N: 72,
          E: 108,
        },
        backSteps: {
          S: [  2,   7],
          W: [ 38,  43],
          N: [ 74,  79],
          E: [110, 115],
        },
        foreSteps: {
          S: [  8,  11],
          W: [ 44,  47],
          N: [ 80,  83],
          E: [116, 119],
        },
        walks: {
          S: [ 12,  19],
          W: [ 48,  55],
          N: [ 84,  91],
          E: [120, 127],
        },
        attacks: {
          S: [ 21,  33],
          W: [ 57,  69],
          N: [ 93, 105],
          E: [129, 141],
        },
        turns: {
          S: 35,
          W: 71,
          N: 107,
          E: 143,
        },
      },
      {name:'Mud Golem'},
      {name:'Frost Golem'},
      {name:'Stone Golem'},
      {
        name:'Dragon Tyrant',
        sounds:
        {
          fire:'sound431',
          impact:'sound1602'
        },
        frames:
        [
          // S Still
          {c:[{id:6055,x:-70,y:-40,a:0.5},{id:3955,x:-71,y:-101},{id:3957,x:-29,y:-52}]},
          // S Turn
          {c:[{id:6057,x:-53,y:-36,a:0.5},{id:4102,x:-52,y:-109},{id:3959,x:-14,y:-54}]},
          // S Move
          {c:[{id:6059,x:-57,y:-38,a:0.5},{id:4104,x:-60,y:-108},{id:3961,x:-29,y:-51}]},
          {c:[{id:6061,x:-51,y:-31,a:0.5},{id:4106,x:-49,y:-108},{id:3963,x:-29,y:-50}]},
          {c:[{id:6063,x:-68,y:-33,a:0.5},{id:4108,x:-68,y:-74},{id:3965,x:-28,y:-54}]},
          {c:[{id:6065,x:-54,y:-32,a:0.5},{id:4110,x:-55,y:-80},{id:3967,x:-21,y:-55}]},
          {c:[{id:6057,x:-53,y:-36,a:0.5},{id:4102,x:-52,y:-109},{id:3959,x:-14,y:-54}]},
          {c:[{id:6067,x:-28,y:-28,a:0.5},{id:4112,x:-28,y:-110},{id:3969,x:-13,y:-52}]},
          {c:[{id:6069,x:-56,y:-36,a:0.5},{id:4114,x:-54,y:-109},{id:3971,x:-14,y:-52}]},
          {c:[{id:6071,x:-35,y:-29,a:0.5},{id:4116,x:-36,y:-78},{id:3973,x:-8,y:-62}]},
          {c:[{id:6073,x:-19,y:-23,a:0.5},{id:4118,x:-21,y:-105},{id:3975,x:-9,y:-83}]},
          {c:[{id:6075,x:-14,y:-24,a:0.5},{id:4120,x:-13,y:-117},{id:3977,x:-3,y:-94}],a:0.5},
          ,
          ,
          ,
          ,
          {c:[{id:6071,x:-35,y:-29,a:0.5},{id:4116,x:-36,y:-78},{id:3973,x:-8,y:-62}],a:0.5},
          {c:[{id:6069,x:-56,y:-36,a:0.5},{id:4114,x:-54,y:-109},{id:3971,x:-14,y:-52}]},
          {c:[{id:6067,x:-28,y:-28,a:0.5},{id:4112,x:-28,y:-110},{id:3969,x:-13,y:-52}]},
          {c:[{id:6057,x:-53,y:-36,a:0.5},{id:4102,x:-52,y:-109},{id:3959,x:-14,y:-54}]},
          {c:[{id:6065,x:-54,y:-32,a:0.5},{id:4110,x:-55,y:-80},{id:3967,x:-21,y:-55}]},
          {c:[{id:6063,x:-68,y:-33,a:0.5},{id:4108,x:-68,y:-74},{id:3965,x:-28,y:-54}]},
          {c:[{id:6061,x:-51,y:-31,a:0.5},{id:4106,x:-49,y:-108},{id:3963,x:-29,y:-50}]},
          {c:[{id:6059,x:-57,y:-38,a:0.5},{id:4104,x:-60,y:-108},{id:3961,x:-29,y:-51}]},
          {c:[{id:6055,x:-70,y:-40,a:0.5},{id:3955,x:-71,y:-101},{id:3957,x:-29,y:-52}]},
          // S Attack
          {c:[{id:6077,x:-46,y:-25,a:0.5},{id:4122,x:-48,y:-65},{id:3979,x:-29,y:-50}]},
          {c:[{id:6079,x:-38,y:-25,a:0.5},{id:4124,x:-39,y:-51},{id:3981,x:-29,y:-50},{id:56,x:17,y:-10,s:4/3,a:1/3}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5},{id:4126,x:-39,y:-53},{id:3983,x:-26,y:-49},{id:56,x:17,y:-10,s:5/3,a:2/3}]},
          {c:[{id:6083,x:-40,y:-25,a:0.5},{id:4128,x:-41,y:-68},{id:3985,x:-29,y:-48},{id:56,x:17,y:-10,s:2}]},
          {c:[{id:6085,x:-57,y:-39,a:0.5},{id:4130,x:-59,y:-103},{id:3987,x:-30,y:-45},{id:56,x:39,y:4,s:3,a:0.5}]},
          {c:[{id:6087,x:-48,y:-34,a:0.5},{id:4132,x:-51,y:-105},{id:3989,x:-30,y:-47}]},
          {c:[{id:6089,x:-60,y:-44,a:0.5},{id:4134,x:-67,y:-112},{id:3991,x:-30,y:-50}]},
          {c:[{id:6055,x:-70,y:-40,a:0.5},{id:3955,x:-71,y:-101},{id:3957,x:-29,y:-52}]},
          // S Block
          {c:[{id:6077,x:-46,y:-25,a:0.5},{id:4122,x:-48,y:-65},{id:3979,x:-29,y:-50}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5},{id:4126,x:-39,y:-53},{id:3983,x:-26,y:-49}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5},{id:4126,x:-39,y:-53},{id:3983,x:-26,y:-49}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5},{id:4126,x:-39,y:-53},{id:3983,x:-26,y:-49}]},
          {c:[{id:6077,x:-46,y:-25,a:0.5},{id:4122,x:-48,y:-65},{id:3979,x:-29,y:-50}]},
          {c:[{id:6055,x:-70,y:-40,a:0.5},{id:3955,x:-71,y:-101},{id:3957,x:-29,y:-52}]},
          // S ???
          {c:[{id:6079,x:-38,y:-25,a:0.5},{id:4124,x:-39,y:-51},{id:3981,x:-29,y:-50}]},
          // W Still
          {c:[{id:6091,x:-26,y:-45,a:0.5},{id:4136,x:-26,y:-102},{id:3993,x:-21,y:-54}]},
          // W Turn
          {c:[{id:6093,x:-70,y:-35,a:0.5},{id:4138,x:-72,y:-113},{id:3995,x:-29,y:-54}]},
          // W Move
          {c:[{id:6095,x:-26,y:-38,a:0.5},{id:4140,x:-26,y:-105},{id:3997,x:-22,y:-51}]},
          {c:[{id:6097,x:-26,y:-33,a:0.5},{id:4142,x:-26,y:-108},{id:3999,x:-22,y:-49}]},
          {c:[{id:6099,x:-49,y:-43,a:0.5},{id:4144,x:-49,y:-75},{id:4001,x:-26,y:-54}]},
          {c:[{id:6101,x:-53,y:-35,a:0.5},{id:4146,x:-53,y:-83},{id:4003,x:-28,y:-55}]},
          {c:[{id:6093,x:-70,y:-35,a:0.5},{id:4138,x:-72,y:-113},{id:3995,x:-29,y:-54}]},
          {c:[{id:6103,x:-33,y:-18,a:0.5},{id:4148,x:-33,y:-107},{id:4005,x:-30,y:-53}]},
          {c:[{id:6105,x:-54,y:-36,a:0.5},{id:4150,x:-54,y:-109},{id:4007,x:-31,y:-52}]},
          {c:[{id:6107,x:-78,y:-24,a:0.5},{id:4152,x:-79,y:-77},{id:4009,x:-36,y:-62}]},
          {c:[{id:6109,x:-61,y:-13,a:0.5},{id:4154,x:-61,y:-103},{id:4011,x:-46,y:-83}]},
          {c:[{id:6111,x:-70,y:-9,a:0.5},{id:4156,x:-71,y:-117},{id:4013,x:-51,y:-94}],a:0.5},
          ,
          ,
          ,
          ,
          {c:[{id:6107,x:-78,y:-24,a:0.5},{id:4152,x:-79,y:-77},{id:4009,x:-36,y:-62}],a:0.5},
          {c:[{id:6105,x:-54,y:-36,a:0.5},{id:4150,x:-54,y:-109},{id:4007,x:-31,y:-52}]},
          {c:[{id:6103,x:-33,y:-18,a:0.5},{id:4148,x:-33,y:-107},{id:4005,x:-30,y:-53}]},
          {c:[{id:6093,x:-70,y:-35,a:0.5},{id:4138,x:-72,y:-113},{id:3995,x:-29,y:-54}]},
          {c:[{id:6101,x:-53,y:-35,a:0.5},{id:4146,x:-53,y:-83},{id:4003,x:-28,y:-55}]},
          {c:[{id:6099,x:-49,y:-43,a:0.5},{id:4144,x:-49,y:-75},{id:4001,x:-26,y:-54}]},
          {c:[{id:6097,x:-26,y:-33,a:0.5},{id:4142,x:-26,y:-108},{id:3999,x:-22,y:-49}]},
          {c:[{id:6095,x:-26,y:-38,a:0.5},{id:4140,x:-26,y:-105},{id:3997,x:-22,y:-51}]},
          {c:[{id:6091,x:-26,y:-45,a:0.5},{id:4136,x:-26,y:-102},{id:3993,x:-21,y:-54}]},
          // W Attack
          {c:[{id:6113,x:-54,y:-30,a:0.5},{id:4158,x:-55,y:-75},{id:4015,x:-20,y:-50}]},
          {c:[{id:6115,x:-34,y:-25,a:0.5},{id:4160,x:-34,y:-56},{id:4017,x:-19,y:-50},{id:56,x:-17,y:-10,s:4/3,a:1/3}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5},{id:4162,x:-37,y:-59},{id:4019,x:-19,y:-49},{id:56,x:-17,y:-10,s:5/3,a:2/3}]},
          {c:[{id:6119,x:-49,y:-25,a:0.5},{id:4164,x:-50,y:-70},{id:4021,x:-20,y:-48},{id:56,x:-17,y:-10,s:2}]},
          {c:[{id:6121,x:-30,y:-38,a:0.5},{id:4166,x:-31,y:-102},{id:4023,x:-25,y:-45},{id:56,x:-39,y:4,s:3,a:0.5}]},
          {c:[{id:6123,x:-32,y:-31,a:0.5},{id:4168,x:-32,y:-100},{id:4025,x:-30,y:-47}]},
          {c:[{id:6125,x:-28,y:-42,a:0.5},{id:4170,x:-28,y:-109},{id:4027,x:-25,y:-50}]},
          {c:[{id:6091,x:-26,y:-45,a:0.5},{id:4136,x:-26,y:-102},{id:3993,x:-21,y:-54}]},
          // W Block
          {c:[{id:6113,x:-54,y:-30,a:0.5},{id:4158,x:-55,y:-75},{id:4015,x:-20,y:-50}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5},{id:4162,x:-37,y:-59},{id:4019,x:-19,y:-49}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5},{id:4162,x:-37,y:-59},{id:4019,x:-19,y:-49}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5},{id:4162,x:-37,y:-59},{id:4019,x:-19,y:-49}]},
          {c:[{id:6113,x:-54,y:-30,a:0.5},{id:4158,x:-55,y:-75},{id:4015,x:-20,y:-50}]},
          {c:[{id:6091,x:-26,y:-45,a:0.5},{id:4136,x:-26,y:-102},{id:3993,x:-21,y:-54}]},
          // N ???
          {c:[{id:6115,x:-34,y:-25,a:0.5},{id:4160,x:-34,y:-56},{id:4017,x:-19,y:-50}]},
          // N Still
          {c:[{id:6055,x:-70,y:-40,a:0.5,f:'B',w:112,h:58},{id:4172,x:-43,y:-65},{id:4029,x:-26,y:-61}]},
          // N Turn
          {c:[{id:6057,x:-53,y:-36,a:0.5,f:'B',w:124,h:82},{id:4174,x:-71,y:-123},{id:4031,x:-27,y:-68}]},
          // N Move
          {c:[{id:6059,x:-57,y:-38,a:0.5,f:'B',w:99,h:56},{id:4176,x:-43,y:-62},{id:4033,x:-26,y:-58}]},
          {c:[{id:6061,x:-51,y:-31,a:0.5,f:'B',w:94,h:49},{id:4178,x:-44,y:-70},{id:4035,x:-26,y:-56}]},
          {c:[{id:6063,x:-68,y:-33,a:0.5,f:'B',w:135,h:65},{id:4180,x:-69,y:-59},{id:4037,x:-23,y:-64}]},
          {c:[{id:6065,x:-54,y:-32,a:0.5,f:'B',w:107,h:66},{id:4182,x:-54,y:-82},{id:4039,x:-27,y:-67}]},
          {c:[{id:6057,x:-53,y:-36,a:0.5,f:'B',w:124,h:82},{id:4174,x:-71,y:-123},{id:4031,x:-27,y:-68}]},
          {c:[{id:6067,x:-28,y:-28,a:0.5,f:'B',w:71,h:50},{id:4184,x:-44,y:-113},{id:4041,x:-29,y:-68}]},
          {c:[{id:6069,x:-56,y:-36,a:0.5,f:'B',w:109,h:71},{id:4186,x:-53,y:-114},{id:4043,x:-31,y:-68}]},
          {c:[{id:6071,x:-35,y:-29,a:0.5,f:'B',w:110,h:81},{id:4188,x:-79,y:-83},{id:4045,x:-36,y:-84}]},
          {c:[{id:6073,x:-19,y:-23,a:0.5,f:'B',w:79,h:63},{id:4190,x:-61,y:-121},{id:4047,x:-46,y:-117}]},
          {c:[{id:6075,x:-14,y:-24,a:0.5,f:'B',w:83,h:70},{id:4192,x:-71,y:-139},{id:4049,x:-52,y:-135}],a:0.5},
          ,
          ,
          ,
          ,
          {c:[{id:6071,x:-35,y:-29,a:0.5,f:'B',w:110,h:81},{id:4188,x:-79,y:-83},{id:4045,x:-36,y:-84}],a:0.5},
          {c:[{id:6069,x:-56,y:-36,a:0.5,f:'B',w:109,h:71},{id:4186,x:-53,y:-114},{id:4043,x:-31,y:-68}]},
          {c:[{id:6067,x:-28,y:-28,a:0.5,f:'B',w:71,h:50},{id:4184,x:-44,y:-113},{id:4041,x:-29,y:-68}]},
          {c:[{id:6057,x:-53,y:-36,a:0.5,f:'B',w:124,h:82},{id:4174,x:-71,y:-123},{id:4031,x:-27,y:-68}]},
          {c:[{id:6065,x:-54,y:-32,a:0.5,f:'B',w:107,h:66},{id:4182,x:-54,y:-82},{id:4039,x:-27,y:-67}]},
          {c:[{id:6063,x:-68,y:-33,a:0.5,f:'B',w:135,h:65},{id:4180,x:-69,y:-59},{id:4037,x:-23,y:-64}]},
          {c:[{id:6061,x:-51,y:-31,a:0.5,f:'B',w:94,h:49},{id:4178,x:-44,y:-70},{id:4035,x:-26,y:-56}]},
          {c:[{id:6059,x:-57,y:-38,a:0.5,f:'B',w:99,h:56},{id:4176,x:-43,y:-62},{id:4033,x:-26,y:-58}]},
          {c:[{id:6055,x:-70,y:-40,a:0.5,f:'B',w:112,h:58},{id:4172,x:-43,y:-65},{id:4029,x:-26,y:-61}]},
          // N Attack
          {c:[{id:6077,x:-46,y:-25,a:0.5,f:'B',w:104,h:62},{id:4194,x:-60,y:-87},{id:4051,x:-26,y:-56}]},
          {c:[{id:6079,x:-38,y:-25,a:0.5,f:'B',w:80,h:48},{id:56,x:-17,y:-32,s:4/3,a:1/3},{id:4196,x:-43,y:-64},{id:4053,x:-26,y:-52}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5,f:'B',w:80,h:50},{id:56,x:-17,y:-32,s:5/3,a:2/3},{id:4198,x:-43,y:-68},{id:4055,x:-26,y:-51}]},
          {c:[{id:6083,x:-40,y:-25,a:0.5,f:'B',w:89,h:57},{id:56,x:-17,y:-32,s:2},{id:4200,x:-48,y:-70},{id:4057,x:-26,y:-52}]},
          {c:[{id:6085,x:-57,y:-39,a:0.5,f:'B',w:99,h:61},{id:56,x:-39,y:-46,s:3,a:0.5},{id:4202,x:-43,y:-67},{id:4059,x:-25,y:-55}]},
          {c:[{id:6087,x:-48,y:-34,a:0.5,f:'B',w:90,h:55},{id:4204,x:-43,y:-59},{id:4061,x:-27,y:-55}]},
          {c:[{id:6089,x:-60,y:-44,a:0.5,f:'B',w:102,h:63},{id:4206,x:-43,y:-58},{id:4063,x:-25,y:-58}]},
          {c:[{id:6055,x:-70,y:-40,a:0.5,f:'B',w:112,h:58},{id:4172,x:-43,y:-65},{id:4029,x:-26,y:-61}]},
          // N Block
          {c:[{id:6077,x:-46,y:-25,a:0.5,f:'B',w:104,h:62},{id:4194,x:-60,y:-87},{id:4051,x:-26,y:-56}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5,f:'B',w:80,h:50},{id:4198,x:-43,y:-68},{id:4055,x:-26,y:-51}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5,f:'B',w:80,h:50},{id:4198,x:-43,y:-68},{id:4055,x:-26,y:-51}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5,f:'B',w:80,h:50},{id:4198,x:-43,y:-68},{id:4055,x:-26,y:-51}]},
          {c:[{id:6077,x:-46,y:-25,a:0.5,f:'B',w:104,h:62},{id:4194,x:-60,y:-87},{id:4051,x:-26,y:-56}]},
          {c:[{id:6055,x:-70,y:-40,a:0.5,f:'B',w:112,h:58},{id:4172,x:-43,y:-65},{id:4029,x:-26,y:-61}]},
          // E ???
          {c:[{id:6079,x:-38,y:-25,a:0.5,f:'B',w:80,h:48},{id:4196,x:-43,y:-64},{id:4053,x:-26,y:-52}]},
          // E Still
          {c:[{id:6091,x:-26,y:-45,a:0.5,f:'B',w:86,h:73},{id:4208,x:-61,y:-83},{id:4065,x:-21,y:-56}]},
          // E Turn
          {c:[{id:6093,x:-70,y:-35,a:0.5,f:'B',w:123,h:82},{id:4210,x:-55,y:-120},{id:4067,x:-16,y:-67}]},
          // E Move
          {c:[{id:6095,x:-26,y:-38,a:0.5,f:'B',w:82,h:66},{id:4212,x:-59,y:-71},{id:4069,x:-23,y:-53}]},
          {c:[{id:6097,x:-26,y:-33,a:0.5,f:'B',w:72,h:62},{id:4214,x:-49,y:-91},{id:4071,x:-24,y:-50}]},
          {c:[{id:6099,x:-49,y:-43,a:0.5,f:'B',w:99,h:72},{id:4216,x:-52,y:-63},{id:4073,x:-22,y:-62}]},
          {c:[{id:6101,x:-53,y:-35,a:0.5,f:'B',w:101,h:70},{id:4218,x:-50,y:-83},{id:4075,x:-18,y:-66}]},
          {c:[{id:6093,x:-70,y:-35,a:0.5,f:'B',w:123,h:82},{id:4210,x:-55,y:-120},{id:4067,x:-16,y:-67}]},
          {c:[{id:6103,x:-33,y:-18,a:0.5,f:'B',w:75,h:47},{id:4220,x:-43,y:-114},{id:4077,x:-15,y:-68}]},
          {c:[{id:6105,x:-54,y:-36,a:0.5,f:'B',w:109,h:71},{id:4222,x:-56,y:-114},{id:4079,x:-13,y:-68}]},
          {c:[{id:6107,x:-78,y:-24,a:0.5,f:'B',w:123,h:75},{id:4224,x:-46,y:-83},{id:4081,x:-8,y:-84}]},
          {c:[{id:6109,x:-61,y:-13,a:0.5,f:'B',w:96,h:53},{id:4226,x:-36,y:-121},{id:4083,x:-6,y:-117}]},
          {c:[{id:6111,x:-70,y:-9,a:0.5,f:'B',w:106,h:55},{id:4228,x:-38,y:-139},{id:4085,x:-3,y:-135}],a:0.5},
          ,
          ,
          ,
          ,
          {c:[{id:6107,x:-78,y:-24,a:0.5,f:'B',w:123,h:75},{id:4224,x:-46,y:-83},{id:4081,x:-8,y:-84}],a:0.5},
          {c:[{id:6105,x:-54,y:-36,a:0.5,f:'B',w:109,h:71},{id:4222,x:-56,y:-114},{id:4079,x:-13,y:-68}]},
          {c:[{id:6103,x:-33,y:-18,a:0.5,f:'B',w:75,h:47},{id:4220,x:-43,y:-114},{id:4077,x:-15,y:-68}]},
          {c:[{id:6093,x:-70,y:-35,a:0.5,f:'B',w:123,h:82},{id:4210,x:-55,y:-120},{id:4067,x:-16,y:-67}]},
          {c:[{id:6101,x:-53,y:-35,a:0.5,f:'B',w:101,h:70},{id:4218,x:-50,y:-83},{id:4075,x:-18,y:-66}]},
          {c:[{id:6099,x:-49,y:-43,a:0.5,f:'B',w:99,h:72},{id:4216,x:-52,y:-63},{id:4073,x:-22,y:-62}]},
          {c:[{id:6097,x:-26,y:-33,a:0.5,f:'B',w:72,h:62},{id:4214,x:-49,y:-91},{id:4071,x:-24,y:-50}]},
          {c:[{id:6095,x:-26,y:-38,a:0.5,f:'B',w:82,h:66},{id:4212,x:-59,y:-71},{id:4069,x:-23,y:-53}]},
          {c:[{id:6091,x:-26,y:-45,a:0.5,f:'B',w:86,h:73},{id:4208,x:-61,y:-83},{id:4065,x:-21,y:-56}]},
          // E Attack
          {c:[{id:6113,x:-54,y:-30,a:0.5,f:'B',w:92,h:69},{id:4230,x:-40,y:-90},{id:4087,x:-23,y:-52}]},
          {c:[{id:6115,x:-34,y:-25,a:0.5,f:'B',w:71,h:53},{id:56,x:17,y:-32,s:4/3,a:1/3},{id:4232,x:-39,y:-62},{id:4089,x:-23,y:-50}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5,f:'B',w:74,h:53},{id:56,x:17,y:-32,s:5/3,a:2/3},{id:4234,x:-39,y:-66},{id:4091,x:-23,y:-49}]},
          {c:[{id:6119,x:-49,y:-25,a:0.5,f:'B',w:86,h:58},{id:56,x:17,y:-32,s:2},{id:4236,x:-39,y:-71},{id:4093,x:-22,y:-50}]},
          {c:[{id:6121,x:-30,y:-38,a:0.5,f:'B',w:88,h:66},{id:56,x:39,y:-46,s:3,a:0.5},{id:4238,x:-61,y:-66},{id:4095,x:-17,y:-54}]},
          {c:[{id:6123,x:-32,y:-31,a:0.5,f:'B',w:84,h:59},{id:4240,x:-53,y:-63},{id:4097,x:-19,y:-53}]},
          {c:[{id:6125,x:-28,y:-42,a:0.5,f:'B',w:93,h:70},{id:4242,x:-70,y:-70},{id:4099,x:-19,y:-55}]},
          {c:[{id:6091,x:-26,y:-45,a:0.5,f:'B',w:86,h:73},{id:4208,x:-61,y:-83},{id:4065,x:-21,y:-56}]},
          // E Block
          {c:[{id:6113,x:-54,y:-30,a:0.5,f:'B',w:92,h:69},{id:4230,x:-40,y:-90},{id:4087,x:-23,y:-52}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5,f:'B',w:74,h:53},{id:4234,x:-39,y:-66},{id:4091,x:-23,y:-49}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5,f:'B',w:74,h:53},{id:4234,x:-39,y:-66},{id:4091,x:-23,y:-49}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5,f:'B',w:74,h:53},{id:4234,x:-39,y:-66},{id:4091,x:-23,y:-49}]},
          {c:[{id:6113,x:-54,y:-30,a:0.5,f:'B',w:92,h:69},{id:4230,x:-40,y:-90},{id:4087,x:-23,y:-52}]},
          {c:[{id:6091,x:-26,y:-45,a:0.5,f:'B',w:86,h:73},{id:4208,x:-61,y:-83},{id:4065,x:-21,y:-56}]},
          // E ???
          {c:[{id:6115,x:-34,y:-25,a:0.5,f:'B',w:71,h:53},{id:4232,x:-39,y:-62},{id:4089,x:-23,y:-50}]}
        ]
      },
      {name:'Beast Rider'},
      {name:'Dragonspeaker Mage'},
      {
        name:        'Chaos Seed',
        ability:     'Chaos',
        specialty:   'Awaken',
        power:       24,
        armor:       99,
        health:      6,
        recovery:    0,
        blocking:    50,
        aType:       'magic',
        aRadius:     0,
        mRadius:     0,
        directional: false,
        sounds: {
          crack:'crack',
          block:'sound8',
          heal:'sound1203',
          lightning:'sound1370',
          wind: {
            file:'chaos',
            volume:0.25,
            sprite: {
              wind1:[   0,1950],
              wind2:[2150,1950],
              wind3:[4300,1800],
              wind4:[6300,2500],
              wind5:[9000,1725]
            }
          },
          phase: {
            file: 'sound4',
            rate: 0.5,
          },
          roar: {
            file:'chaos',
            sprite: {
              roar :[10925,1675]
            }
          }
        },
        stills: {S: 0},
        frames: [
          {
            x: -1,
            y: 7,
            c: [
              {id:6459, x:-12.5, y:-19.5},
              {id:1351, x:-21,   y:-61},
              {id:1354, x:-20,   y:-57},
            ]
          }
        ]
      },
      {name:'Wisp'},
      {name:'Furgon'},
      {name:'Shrub'},
      {
        name:          'Champion',
        frames_url:    'https://tactics.taorankings.com/json/trophy.json',
        frames_offset: {y:-20},
        stills:        {S:0, N:1},
      },
      {name:'Ambusher'},
      {name:'Berserker'},
      {
        name:'Chaos Dragon',
        ability:'Static Charge',
        specialty:'Regenerate',
        power:28,
        armor:30,
        health:38,
        recovery:1,
        blocking:50,
        aType:'magic',
        aLOS:true,
        aLinear:true,
        aRadius:3,
        mPass:false,
        mPath:false,
        mRadius:4,
        sounds: {
          flap:   'sound7',
          block:  'sound11',
          heal:   'sound1203',
          impact: 'sound1602',
          charge: {file:'charge', rate:0.6},
          buzz:   {file:'buzz',   rate:0.6},
          phase:  {file:'sound4', rate:0.5},
        },
        stills: {
          S: 0,
          W: 48,
          N: 96,
          E: 144,
        },
        turns: {
          S: 1,
          W: 49,
          N: 97,
          E: 145,
        },
        animations: {
          S:{move:{s:  2,l:23},attack:{s: 25,l:9},block:{s: 34,l:6},hatch:{s: 40,l:8}},
          W:{move:{s: 50,l:23},attack:{s: 73,l:9},block:{s: 82,l:6},hatch:{s: 88,l:8}},
          N:{move:{s: 98,l:23},attack:{s:121,l:9},block:{s:130,l:6},hatch:{s:136,l:8}},
          E:{move:{s:146,l:23},attack:{s:169,l:9},block:{s:178,l:6},hatch:{s:184,l:8}}
        },
        frames: [
          // S Still
          {c:[{id:6055,x:-70,y:-40,a:0.5},{id:3955,x:-71,y:-101},{id:3957,x:-29,y:-52}]},
          // S Turn
          {c:[{id:6057,x:-53,y:-36,a:0.5},{id:4102,x:-52,y:-109},{id:3959,x:-14,y:-54}]},
          // S Move
          {c:[{id:6059,x:-57,y:-38,a:0.5},{id:4104,x:-60,y:-108},{id:3961,x:-29,y:-51}]},
          {c:[{id:6061,x:-51,y:-31,a:0.5},{id:4106,x:-49,y:-108},{id:3963,x:-29,y:-50}]},
          {c:[{id:6063,x:-68,y:-33,a:0.5},{id:4108,x:-68,y:-74},{id:3965,x:-28,y:-54}]},
          {c:[{id:6065,x:-54,y:-32,a:0.5},{id:4110,x:-55,y:-80},{id:3967,x:-21,y:-55}]},
          {c:[{id:6057,x:-53,y:-36,a:0.5},{id:4102,x:-52,y:-109},{id:3959,x:-14,y:-54}]},
          {c:[{id:6067,x:-28,y:-28,a:0.5},{id:4112,x:-28,y:-110},{id:3969,x:-13,y:-52}]},
          {c:[{id:6069,x:-56,y:-36,a:0.5},{id:4114,x:-54,y:-109},{id:3971,x:-14,y:-52}]},
          {c:[{id:6071,x:-35,y:-29,a:0.5},{id:4116,x:-36,y:-78},{id:3973,x:-8,y:-62}]},
          {c:[{id:6073,x:-19,y:-23,a:0.5},{id:4118,x:-21,y:-105},{id:3975,x:-9,y:-83}]},
          {c:[{id:6075,x:-14,y:-24,a:0.5},{id:4120,x:-13,y:-117},{id:3977,x:-3,y:-94}],a:0.5},
          ,
          ,
          ,
          ,
          {c:[{id:6071,x:-35,y:-29,a:0.5},{id:4116,x:-36,y:-78},{id:3973,x:-8,y:-62}],a:0.5},
          {c:[{id:6069,x:-56,y:-36,a:0.5},{id:4114,x:-54,y:-109},{id:3971,x:-14,y:-52}]},
          {c:[{id:6067,x:-28,y:-28,a:0.5},{id:4112,x:-28,y:-110},{id:3969,x:-13,y:-52}]},
          {c:[{id:6057,x:-53,y:-36,a:0.5},{id:4102,x:-52,y:-109},{id:3959,x:-14,y:-54}]},
          {c:[{id:6065,x:-54,y:-32,a:0.5},{id:4110,x:-55,y:-80},{id:3967,x:-21,y:-55}]},
          {c:[{id:6063,x:-68,y:-33,a:0.5},{id:4108,x:-68,y:-74},{id:3965,x:-28,y:-54}]},
          {c:[{id:6061,x:-51,y:-31,a:0.5},{id:4106,x:-49,y:-108},{id:3963,x:-29,y:-50}]},
          {c:[{id:6059,x:-57,y:-38,a:0.5},{id:4104,x:-60,y:-108},{id:3961,x:-29,y:-51}]},
          {c:[{id:6055,x:-70,y:-40,a:0.5},{id:3955,x:-71,y:-101},{id:3957,x:-29,y:-52}]},
          // S Attack
          {c:[{id:6077,x:-46,y:-25,a:0.5},{id:4122,x:-48,y:-65},{id:3979,x:-29,y:-50}]},
          {c:[{id:6079,x:-38,y:-25,a:0.5},{id:4124,x:-39,y:-51},{id:3981,x:-29,y:-50},{id:56,x:17,y:-10,s:4/3,a:1/3}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5},{id:4126,x:-39,y:-53},{id:3983,x:-26,y:-49},{id:56,x:17,y:-10,s:5/3,a:2/3}]},
          {c:[{id:6083,x:-40,y:-25,a:0.5},{id:4128,x:-41,y:-68},{id:3985,x:-29,y:-48},{id:56,x:17,y:-10,s:2}]},
          {c:[{id:6085,x:-57,y:-39,a:0.5},{id:4130,x:-59,y:-103},{id:3987,x:-30,y:-45},{id:56,x:21,y:-7,s:2}]},
          {c:[{id:6087,x:-48,y:-34,a:0.5},{id:4132,x:-51,y:-105},{id:3989,x:-30,y:-47},{id:56,x:24,y:-13,s:2}]},
          {c:[{id:6087,x:-48,y:-34,a:0.5},{id:4132,x:-51,y:-105},{id:3989,x:-30,y:-47},{id:56,x:24,y:-13,s:2}]},
          {c:[{id:6089,x:-60,y:-44,a:0.5},{id:4134,x:-67,y:-112},{id:3991,x:-30,y:-50}]},
          {c:[{id:6055,x:-70,y:-40,a:0.5},{id:3955,x:-71,y:-101},{id:3957,x:-29,y:-52}]},
          // S Block
          {c:[{id:6077,x:-46,y:-25,a:0.5},{id:4122,x:-48,y:-65},{id:3979,x:-29,y:-50}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5},{id:4126,x:-39,y:-53},{id:3983,x:-26,y:-49}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5},{id:4126,x:-39,y:-53},{id:3983,x:-26,y:-49}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5},{id:4126,x:-39,y:-53},{id:3983,x:-26,y:-49}]},
          {c:[{id:6077,x:-46,y:-25,a:0.5},{id:4122,x:-48,y:-65},{id:3979,x:-29,y:-50}]},
          {c:[{id:6055,x:-70,y:-40,a:0.5},{id:3955,x:-71,y:-101},{id:3957,x:-29,y:-52}]},
          // S Hatch
          {c:[{id:6079,x:-38,y:-25,a:0.5},{id:4124,x:-39,y:-51},{id:3981,x:-29,y:-50}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5},{id:4126,x:-39,y:-53},{id:3983,x:-26,y:-49}]},
          {c:[{id:6083,x:-40,y:-25,a:0.5},{id:4128,x:-41,y:-68},{id:3985,x:-29,y:-48}]},
          {c:[{id:6077,x:-46,y:-25,a:0.5},{id:4122,x:-48,y:-65},{id:3979,x:-29,y:-50}]},
          {c:[{id:6085,x:-57,y:-39,a:0.5},{id:4130,x:-59,y:-103},{id:3987,x:-30,y:-45}]},
          {c:[{id:6087,x:-48,y:-34,a:0.5},{id:4132,x:-51,y:-105},{id:3989,x:-30,y:-47}]},
          {c:[{id:6085,x:-57,y:-39,a:0.5},{id:4130,x:-59,y:-103},{id:3987,x:-30,y:-45}]},
          {c:[{id:6055,x:-70,y:-40,a:0.5},{id:3955,x:-71,y:-101},{id:3957,x:-29,y:-52}]},
          // W Still
          {c:[{id:6091,x:-26,y:-45,a:0.5},{id:4136,x:-26,y:-102},{id:3993,x:-21,y:-54}]},
          // W Turn
          {c:[{id:6093,x:-70,y:-35,a:0.5},{id:4138,x:-72,y:-113},{id:3995,x:-29,y:-54}]},
          // W Move
          {c:[{id:6095,x:-26,y:-38,a:0.5},{id:4140,x:-26,y:-105},{id:3997,x:-22,y:-51}]},
          {c:[{id:6097,x:-26,y:-33,a:0.5},{id:4142,x:-26,y:-108},{id:3999,x:-22,y:-49}]},
          {c:[{id:6099,x:-49,y:-43,a:0.5},{id:4144,x:-49,y:-75},{id:4001,x:-26,y:-54}]},
          {c:[{id:6101,x:-53,y:-35,a:0.5},{id:4146,x:-53,y:-83},{id:4003,x:-28,y:-55}]},
          {c:[{id:6093,x:-70,y:-35,a:0.5},{id:4138,x:-72,y:-113},{id:3995,x:-29,y:-54}]},
          {c:[{id:6103,x:-33,y:-18,a:0.5},{id:4148,x:-33,y:-107},{id:4005,x:-30,y:-53}]},
          {c:[{id:6105,x:-54,y:-36,a:0.5},{id:4150,x:-54,y:-109},{id:4007,x:-31,y:-52}]},
          {c:[{id:6107,x:-78,y:-24,a:0.5},{id:4152,x:-79,y:-77},{id:4009,x:-36,y:-62}]},
          {c:[{id:6109,x:-61,y:-13,a:0.5},{id:4154,x:-61,y:-103},{id:4011,x:-46,y:-83}]},
          {c:[{id:6111,x:-70,y:-9,a:0.5},{id:4156,x:-71,y:-117},{id:4013,x:-51,y:-94}],a:0.5},
          ,
          ,
          ,
          ,
          {c:[{id:6107,x:-78,y:-24,a:0.5},{id:4152,x:-79,y:-77},{id:4009,x:-36,y:-62}],a:0.5},
          {c:[{id:6105,x:-54,y:-36,a:0.5},{id:4150,x:-54,y:-109},{id:4007,x:-31,y:-52}]},
          {c:[{id:6103,x:-33,y:-18,a:0.5},{id:4148,x:-33,y:-107},{id:4005,x:-30,y:-53}]},
          {c:[{id:6093,x:-70,y:-35,a:0.5},{id:4138,x:-72,y:-113},{id:3995,x:-29,y:-54}]},
          {c:[{id:6101,x:-53,y:-35,a:0.5},{id:4146,x:-53,y:-83},{id:4003,x:-28,y:-55}]},
          {c:[{id:6099,x:-49,y:-43,a:0.5},{id:4144,x:-49,y:-75},{id:4001,x:-26,y:-54}]},
          {c:[{id:6097,x:-26,y:-33,a:0.5},{id:4142,x:-26,y:-108},{id:3999,x:-22,y:-49}]},
          {c:[{id:6095,x:-26,y:-38,a:0.5},{id:4140,x:-26,y:-105},{id:3997,x:-22,y:-51}]},
          {c:[{id:6091,x:-26,y:-45,a:0.5},{id:4136,x:-26,y:-102},{id:3993,x:-21,y:-54}]},
          // W Attack
          {c:[{id:6113,x:-54,y:-30,a:0.5},{id:4158,x:-55,y:-75},{id:4015,x:-20,y:-50}]},
          {c:[{id:6115,x:-34,y:-25,a:0.5},{id:4160,x:-34,y:-56},{id:4017,x:-19,y:-50},{id:56,x:-17,y:-10,s:4/3,a:1/3}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5},{id:4162,x:-37,y:-59},{id:4019,x:-19,y:-49},{id:56,x:-17,y:-10,s:5/3,a:2/3}]},
          {c:[{id:6119,x:-49,y:-25,a:0.5},{id:4164,x:-50,y:-70},{id:4021,x:-20,y:-48},{id:56,x:-17,y:-10,s:2}]},
          {c:[{id:6121,x:-30,y:-38,a:0.5},{id:4166,x:-31,y:-102},{id:4023,x:-25,y:-45},{id:56,x:-18,y:-7,s:2}]},
          {c:[{id:6123,x:-32,y:-31,a:0.5},{id:4168,x:-32,y:-100},{id:4025,x:-30,y:-47},{id:56,x:-24,y:-13,s:2}]},
          {c:[{id:6123,x:-32,y:-31,a:0.5},{id:4168,x:-32,y:-100},{id:4025,x:-30,y:-47},{id:56,x:-24,y:-13,s:2}]},
          {c:[{id:6125,x:-28,y:-42,a:0.5},{id:4170,x:-28,y:-109},{id:4027,x:-25,y:-50}]},
          {c:[{id:6091,x:-26,y:-45,a:0.5},{id:4136,x:-26,y:-102},{id:3993,x:-21,y:-54}]},
          // W Block
          {c:[{id:6113,x:-54,y:-30,a:0.5},{id:4158,x:-55,y:-75},{id:4015,x:-20,y:-50}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5},{id:4162,x:-37,y:-59},{id:4019,x:-19,y:-49}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5},{id:4162,x:-37,y:-59},{id:4019,x:-19,y:-49}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5},{id:4162,x:-37,y:-59},{id:4019,x:-19,y:-49}]},
          {c:[{id:6113,x:-54,y:-30,a:0.5},{id:4158,x:-55,y:-75},{id:4015,x:-20,y:-50}]},
          {c:[{id:6091,x:-26,y:-45,a:0.5},{id:4136,x:-26,y:-102},{id:3993,x:-21,y:-54}]},
          // W Hatch
          {c:[{id:6115,x:-34,y:-25,a:0.5},{id:4160,x:-34,y:-56},{id:4017,x:-19,y:-50}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5},{id:4162,x:-37,y:-59},{id:4019,x:-19,y:-49}]},
          {c:[{id:6119,x:-49,y:-25,a:0.5},{id:4164,x:-50,y:-70},{id:4021,x:-20,y:-48}]},
          {c:[{id:6113,x:-54,y:-30,a:0.5},{id:4158,x:-55,y:-75},{id:4015,x:-20,y:-50}]},
          {c:[{id:6121,x:-30,y:-38,a:0.5},{id:4166,x:-31,y:-102},{id:4023,x:-25,y:-45}]},
          {c:[{id:6123,x:-32,y:-31,a:0.5},{id:4168,x:-32,y:-100},{id:4025,x:-30,y:-47}]},
          {c:[{id:6121,x:-30,y:-38,a:0.5},{id:4166,x:-31,y:-102},{id:4023,x:-25,y:-45}]},
          {c:[{id:6091,x:-26,y:-45,a:0.5},{id:4136,x:-26,y:-102},{id:3993,x:-21,y:-54}]},
          // N Still
          {c:[{id:6055,x:-70,y:-40,a:0.5,f:'B',w:112,h:58},{id:4172,x:-43,y:-65},{id:4029,x:-26,y:-61}]},
          // N Turn
          {c:[{id:6057,x:-53,y:-36,a:0.5,f:'B',w:124,h:82},{id:4174,x:-71,y:-123},{id:4031,x:-27,y:-68}]},
          // N Move
          {c:[{id:6059,x:-57,y:-38,a:0.5,f:'B',w:99,h:56},{id:4176,x:-43,y:-62},{id:4033,x:-26,y:-58}]},
          {c:[{id:6061,x:-51,y:-31,a:0.5,f:'B',w:94,h:49},{id:4178,x:-44,y:-70},{id:4035,x:-26,y:-56}]},
          {c:[{id:6063,x:-68,y:-33,a:0.5,f:'B',w:135,h:65},{id:4180,x:-69,y:-59},{id:4037,x:-23,y:-64}]},
          {c:[{id:6065,x:-54,y:-32,a:0.5,f:'B',w:107,h:66},{id:4182,x:-54,y:-82},{id:4039,x:-27,y:-67}]},
          {c:[{id:6057,x:-53,y:-36,a:0.5,f:'B',w:124,h:82},{id:4174,x:-71,y:-123},{id:4031,x:-27,y:-68}]},
          {c:[{id:6067,x:-28,y:-28,a:0.5,f:'B',w:71,h:50},{id:4184,x:-44,y:-113},{id:4041,x:-29,y:-68}]},
          {c:[{id:6069,x:-56,y:-36,a:0.5,f:'B',w:109,h:71},{id:4186,x:-53,y:-114},{id:4043,x:-31,y:-68}]},
          {c:[{id:6071,x:-35,y:-29,a:0.5,f:'B',w:110,h:81},{id:4188,x:-79,y:-83},{id:4045,x:-36,y:-84}]},
          {c:[{id:6073,x:-19,y:-23,a:0.5,f:'B',w:79,h:63},{id:4190,x:-61,y:-121},{id:4047,x:-46,y:-117}]},
          {c:[{id:6075,x:-14,y:-24,a:0.5,f:'B',w:83,h:70},{id:4192,x:-71,y:-139},{id:4049,x:-52,y:-135}],a:0.5},
          ,
          ,
          ,
          ,
          {c:[{id:6071,x:-35,y:-29,a:0.5,f:'B',w:110,h:81},{id:4188,x:-79,y:-83},{id:4045,x:-36,y:-84}],a:0.5},
          {c:[{id:6069,x:-56,y:-36,a:0.5,f:'B',w:109,h:71},{id:4186,x:-53,y:-114},{id:4043,x:-31,y:-68}]},
          {c:[{id:6067,x:-28,y:-28,a:0.5,f:'B',w:71,h:50},{id:4184,x:-44,y:-113},{id:4041,x:-29,y:-68}]},
          {c:[{id:6057,x:-53,y:-36,a:0.5,f:'B',w:124,h:82},{id:4174,x:-71,y:-123},{id:4031,x:-27,y:-68}]},
          {c:[{id:6065,x:-54,y:-32,a:0.5,f:'B',w:107,h:66},{id:4182,x:-54,y:-82},{id:4039,x:-27,y:-67}]},
          {c:[{id:6063,x:-68,y:-33,a:0.5,f:'B',w:135,h:65},{id:4180,x:-69,y:-59},{id:4037,x:-23,y:-64}]},
          {c:[{id:6061,x:-51,y:-31,a:0.5,f:'B',w:94,h:49},{id:4178,x:-44,y:-70},{id:4035,x:-26,y:-56}]},
          {c:[{id:6059,x:-57,y:-38,a:0.5,f:'B',w:99,h:56},{id:4176,x:-43,y:-62},{id:4033,x:-26,y:-58}]},
          {c:[{id:6055,x:-70,y:-40,a:0.5,f:'B',w:112,h:58},{id:4172,x:-43,y:-65},{id:4029,x:-26,y:-61}]},
          // N Attack
          {c:[{id:6077,x:-46,y:-25,a:0.5,f:'B',w:104,h:62},{id:4194,x:-60,y:-87},{id:4051,x:-26,y:-56}]},
          {c:[{id:6079,x:-38,y:-25,a:0.5,f:'B',w:80,h:48},{id:56,x:-17,y:-32,s:4/3,a:1/3},{id:4196,x:-43,y:-64},{id:4053,x:-26,y:-52}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5,f:'B',w:80,h:50},{id:56,x:-17,y:-32,s:5/3,a:2/3},{id:4198,x:-43,y:-68},{id:4055,x:-26,y:-51}]},
          {c:[{id:6083,x:-40,y:-25,a:0.5,f:'B',w:89,h:57},{id:56,x:-17,y:-32,s:2},{id:4200,x:-48,y:-70},{id:4057,x:-26,y:-52}]},
          {c:[{id:6085,x:-57,y:-39,a:0.5,f:'B',w:99,h:61},{id:56,x:-17,y:-32,s:2},{id:4202,x:-43,y:-67},{id:4059,x:-25,y:-55}]},
          {c:[{id:6087,x:-48,y:-34,a:0.5,f:'B',w:90,h:55},{id:56,x:-21,y:-42,s:2},{id:4204,x:-43,y:-59},{id:4061,x:-27,y:-55}]},
          {c:[{id:6087,x:-48,y:-34,a:0.5,f:'B',w:90,h:55},{id:56,x:-21,y:-42,s:2},{id:4204,x:-43,y:-59},{id:4061,x:-27,y:-55}]},
          {c:[{id:6089,x:-60,y:-44,a:0.5,f:'B',w:102,h:63},{id:4206,x:-43,y:-58},{id:4063,x:-25,y:-58}]},
          {c:[{id:6055,x:-70,y:-40,a:0.5,f:'B',w:112,h:58},{id:4172,x:-43,y:-65},{id:4029,x:-26,y:-61}]},
          // N Block
          {c:[{id:6077,x:-46,y:-25,a:0.5,f:'B',w:104,h:62},{id:4194,x:-60,y:-87},{id:4051,x:-26,y:-56}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5,f:'B',w:80,h:50},{id:4198,x:-43,y:-68},{id:4055,x:-26,y:-51}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5,f:'B',w:80,h:50},{id:4198,x:-43,y:-68},{id:4055,x:-26,y:-51}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5,f:'B',w:80,h:50},{id:4198,x:-43,y:-68},{id:4055,x:-26,y:-51}]},
          {c:[{id:6077,x:-46,y:-25,a:0.5,f:'B',w:104,h:62},{id:4194,x:-60,y:-87},{id:4051,x:-26,y:-56}]},
          {c:[{id:6055,x:-70,y:-40,a:0.5,f:'B',w:112,h:58},{id:4172,x:-43,y:-65},{id:4029,x:-26,y:-61}]},
          // N Hatch
          {c:[{id:6079,x:-38,y:-25,a:0.5,f:'B',w:80,h:48},{id:4196,x:-43,y:-64},{id:4053,x:-26,y:-52}]},
          {c:[{id:6081,x:-38,y:-25,a:0.5,f:'B',w:80,h:50},{id:4198,x:-43,y:-68},{id:4055,x:-26,y:-51}]},
          {c:[{id:6083,x:-40,y:-25,a:0.5,f:'B',w:89,h:57},{id:4200,x:-48,y:-70},{id:4057,x:-26,y:-52}]},
          {c:[{id:6077,x:-46,y:-25,a:0.5,f:'B',w:104,h:62},{id:4194,x:-60,y:-87},{id:4051,x:-26,y:-56}]},
          {c:[{id:6085,x:-57,y:-39,a:0.5,f:'B',w:99,h:61},{id:4202,x:-43,y:-67},{id:4059,x:-25,y:-55}]},
          {c:[{id:6087,x:-48,y:-34,a:0.5,f:'B',w:90,h:55},{id:4204,x:-43,y:-59},{id:4061,x:-27,y:-55}]},
          {c:[{id:6085,x:-57,y:-39,a:0.5,f:'B',w:99,h:61},{id:4202,x:-43,y:-67},{id:4059,x:-25,y:-55}]},
          {c:[{id:6055,x:-70,y:-40,a:0.5,f:'B',w:112,h:58},{id:4172,x:-43,y:-65},{id:4029,x:-26,y:-61}]},
          // E Still
          {c:[{id:6091,x:-26,y:-45,a:0.5,f:'B',w:86,h:73},{id:4208,x:-61,y:-83},{id:4065,x:-21,y:-56}]},
          // E Turn
          {c:[{id:6093,x:-70,y:-35,a:0.5,f:'B',w:123,h:82},{id:4210,x:-55,y:-120},{id:4067,x:-16,y:-67}]},
          // E Move
          {c:[{id:6095,x:-26,y:-38,a:0.5,f:'B',w:82,h:66},{id:4212,x:-59,y:-71},{id:4069,x:-23,y:-53}]},
          {c:[{id:6097,x:-26,y:-33,a:0.5,f:'B',w:72,h:62},{id:4214,x:-49,y:-91},{id:4071,x:-24,y:-50}]},
          {c:[{id:6099,x:-49,y:-43,a:0.5,f:'B',w:99,h:72},{id:4216,x:-52,y:-63},{id:4073,x:-22,y:-62}]},
          {c:[{id:6101,x:-53,y:-35,a:0.5,f:'B',w:101,h:70},{id:4218,x:-50,y:-83},{id:4075,x:-18,y:-66}]},
          {c:[{id:6093,x:-70,y:-35,a:0.5,f:'B',w:123,h:82},{id:4210,x:-55,y:-120},{id:4067,x:-16,y:-67}]},
          {c:[{id:6103,x:-33,y:-18,a:0.5,f:'B',w:75,h:47},{id:4220,x:-43,y:-114},{id:4077,x:-15,y:-68}]},
          {c:[{id:6105,x:-54,y:-36,a:0.5,f:'B',w:109,h:71},{id:4222,x:-56,y:-114},{id:4079,x:-13,y:-68}]},
          {c:[{id:6107,x:-78,y:-24,a:0.5,f:'B',w:123,h:75},{id:4224,x:-46,y:-83},{id:4081,x:-8,y:-84}]},
          {c:[{id:6109,x:-61,y:-13,a:0.5,f:'B',w:96,h:53},{id:4226,x:-36,y:-121},{id:4083,x:-6,y:-117}]},
          {c:[{id:6111,x:-70,y:-9,a:0.5,f:'B',w:106,h:55},{id:4228,x:-38,y:-139},{id:4085,x:-3,y:-135}],a:0.5},
          ,
          ,
          ,
          ,
          {c:[{id:6107,x:-78,y:-24,a:0.5,f:'B',w:123,h:75},{id:4224,x:-46,y:-83},{id:4081,x:-8,y:-84}],a:0.5},
          {c:[{id:6105,x:-54,y:-36,a:0.5,f:'B',w:109,h:71},{id:4222,x:-56,y:-114},{id:4079,x:-13,y:-68}]},
          {c:[{id:6103,x:-33,y:-18,a:0.5,f:'B',w:75,h:47},{id:4220,x:-43,y:-114},{id:4077,x:-15,y:-68}]},
          {c:[{id:6093,x:-70,y:-35,a:0.5,f:'B',w:123,h:82},{id:4210,x:-55,y:-120},{id:4067,x:-16,y:-67}]},
          {c:[{id:6101,x:-53,y:-35,a:0.5,f:'B',w:101,h:70},{id:4218,x:-50,y:-83},{id:4075,x:-18,y:-66}]},
          {c:[{id:6099,x:-49,y:-43,a:0.5,f:'B',w:99,h:72},{id:4216,x:-52,y:-63},{id:4073,x:-22,y:-62}]},
          {c:[{id:6097,x:-26,y:-33,a:0.5,f:'B',w:72,h:62},{id:4214,x:-49,y:-91},{id:4071,x:-24,y:-50}]},
          {c:[{id:6095,x:-26,y:-38,a:0.5,f:'B',w:82,h:66},{id:4212,x:-59,y:-71},{id:4069,x:-23,y:-53}]},
          {c:[{id:6091,x:-26,y:-45,a:0.5,f:'B',w:86,h:73},{id:4208,x:-61,y:-83},{id:4065,x:-21,y:-56}]},
          // E Attack
          {c:[{id:6113,x:-54,y:-30,a:0.5,f:'B',w:92,h:69},{id:4230,x:-40,y:-90},{id:4087,x:-23,y:-52}]},
          {c:[{id:6115,x:-34,y:-25,a:0.5,f:'B',w:71,h:53},{id:56,x:17,y:-32,s:4/3,a:1/3},{id:4232,x:-39,y:-62},{id:4089,x:-23,y:-50}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5,f:'B',w:74,h:53},{id:56,x:17,y:-32,s:5/3,a:2/3},{id:4234,x:-39,y:-66},{id:4091,x:-23,y:-49}]},
          {c:[{id:6119,x:-49,y:-25,a:0.5,f:'B',w:86,h:58},{id:56,x:17,y:-32,s:2},{id:4236,x:-39,y:-71},{id:4093,x:-22,y:-50}]},
          {c:[{id:6121,x:-30,y:-38,a:0.5,f:'B',w:88,h:66},{id:56,x:17,y:-32,s:2},{id:4238,x:-61,y:-66},{id:4095,x:-17,y:-54}]},
          {c:[{id:6123,x:-32,y:-31,a:0.5,f:'B',w:84,h:59},{id:56,x:24,y:-42,s:2},{id:4240,x:-53,y:-63},{id:4097,x:-19,y:-53}]},
          {c:[{id:6123,x:-32,y:-31,a:0.5,f:'B',w:84,h:59},{id:56,x:24,y:-42,s:2},{id:4240,x:-53,y:-63},{id:4097,x:-19,y:-53}]},
          {c:[{id:6125,x:-28,y:-42,a:0.5,f:'B',w:93,h:70},{id:4242,x:-70,y:-70},{id:4099,x:-19,y:-55}]},
          {c:[{id:6091,x:-26,y:-45,a:0.5,f:'B',w:86,h:73},{id:4208,x:-61,y:-83},{id:4065,x:-21,y:-56}]},
          // E Block
          {c:[{id:6113,x:-54,y:-30,a:0.5,f:'B',w:92,h:69},{id:4230,x:-40,y:-90},{id:4087,x:-23,y:-52}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5,f:'B',w:74,h:53},{id:4234,x:-39,y:-66},{id:4091,x:-23,y:-49}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5,f:'B',w:74,h:53},{id:4234,x:-39,y:-66},{id:4091,x:-23,y:-49}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5,f:'B',w:74,h:53},{id:4234,x:-39,y:-66},{id:4091,x:-23,y:-49}]},
          {c:[{id:6113,x:-54,y:-30,a:0.5,f:'B',w:92,h:69},{id:4230,x:-40,y:-90},{id:4087,x:-23,y:-52}]},
          {c:[{id:6091,x:-26,y:-45,a:0.5,f:'B',w:86,h:73},{id:4208,x:-61,y:-83},{id:4065,x:-21,y:-56}]},
          // E Hatch
          {c:[{id:6115,x:-34,y:-25,a:0.5,f:'B',w:71,h:53},{id:4232,x:-39,y:-62},{id:4089,x:-23,y:-50}]},
          {c:[{id:6117,x:-37,y:-25,a:0.5,f:'B',w:74,h:53},{id:4234,x:-39,y:-66},{id:4091,x:-23,y:-49}]},
          {c:[{id:6119,x:-49,y:-25,a:0.5,f:'B',w:86,h:58},{id:4236,x:-39,y:-71},{id:4093,x:-22,y:-50}]},
          {c:[{id:6113,x:-54,y:-30,a:0.5,f:'B',w:92,h:69},{id:4230,x:-40,y:-90},{id:4087,x:-23,y:-52}]},
          {c:[{id:6121,x:-30,y:-38,a:0.5,f:'B',w:88,h:66},{id:4238,x:-61,y:-66},{id:4095,x:-17,y:-54}]},
          {c:[{id:6123,x:-32,y:-31,a:0.5,f:'B',w:84,h:59},{id:4240,x:-53,y:-63},{id:4097,x:-19,y:-53}]},
          {c:[{id:6121,x:-30,y:-38,a:0.5,f:'B',w:88,h:66},{id:4238,x:-61,y:-66},{id:4095,x:-17,y:-54}]},
          {c:[{id:6091,x:-26,y:-45,a:0.5,f:'B',w:86,h:73},{id:4208,x:-61,y:-83},{id:4065,x:-21,y:-56}]}
        ]
      }
    ],
    colors: [
      0,
      0,
      0xFF0000,//0xFF6057,
      0,
      0,
      0,
      0,
      0xFFEE00,//0xFCEE5C,
      0x88FF00,//0xC4FE7C,
      0,
      0x0088FF//0x789EFF
    ]
  });

  return self;
})();
