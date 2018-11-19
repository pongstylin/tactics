Tactics = (function ()
{
	var self = {};
	var vw,vh,bw,bh;
	var renderer;
	var stage;
	var rendering = false;
	var render = () => {
		self.emit({type:'render'});

    // This is a hammer.  Without it, the mouse cursor will not change to a
    // pointer and back when needed without moving the mouse.
    renderer.plugins.interaction.update();

    //console.log('pixi render',+new Date());
    renderer.render(stage);
		rendering = false;
	};

	utils.addEvents.call(self);

	$.extend(self, {
		width:22+(88*9)+22,
		height:38+4+(56*9)+4,
		utils:{},

		init:function ($viewport) {
      // We don't need an infinite loop, thanks.
      PIXI.ticker.shared.autoStart = false;

			var $canvas;
			renderer = PIXI.autoDetectRenderer(bw = self.width,bh = self.height);
			self.$viewport = $viewport;
			stage = self.stage = new PIXI.Container();

			$canvas = self.$canvas = $(renderer.view).attr('id','board').appendTo('#field');

			self.renderer = renderer instanceof PIXI.CanvasRenderer ? 'canvas' : 'webgl';
			self.board = new Tactics.Board();

			$canvas
				// TODO:
				//   1) Why does zooming out go slower than zooming in (unless it is a
				//   continuous zoom in-out)
				//   2) Consider transforming the canvas content instead of the canvas.
				.on('touchy-pinch',function (event,$target,data)
				{
					var otransform = $target.data('transform');
					var transform = $.extend({},otransform);
					var minScale = 1;
					var maxScale = 1 / (vw / bw);
					var offset = $('#field').offset();

					transform.sx  = data.startPoint.x - offset.left;
					transform.sy  = data.startPoint.y - offset.top;
					transform.cx  = data.currentPoint.x - offset.left;
					transform.cy  = data.currentPoint.y - offset.top;

					// Adjust scale, origin, and translation
					transform.s  += data.scale - data.previousScale;
					transform.s   = Math.max(minScale,Math.min(transform.s,maxScale));
					transform.ox += transform.cx/otransform.s - transform.cx/transform.s;
					transform.oy += transform.cy/otransform.s - transform.cy/transform.s;
					transform.tx += otransform.ox - transform.ox;
					transform.ty += otransform.oy - transform.oy;

					// Adjust position
					if (otransform.cx != transform.cx)
					{
						// Save position if user has lifted fingers and placed them someplace else.
						if (otransform.sx != transform.sx)
							transform.tx += transform.px;

						transform.px = (transform.cx - transform.sx) / otransform.s;
					}
					if (otransform.cy != transform.cy)
					{
						// Save position if user has lifted fingers and placed them someplace else.
						if (otransform.sy != transform.sy)
							transform.ty += transform.py;

						transform.py = (transform.cy - transform.sy) / otransform.s;
					}

					// It might be better to snap to the edge upon pinch release.  But how to detect?
					var minX = (vw / transform.s) - vw;
					var maxX = 0;
					var minY = (vh / transform.s) - vh;
					var maxY = 0;

					if (transform.tx+transform.px > maxX)
						transform.tx = maxX - transform.px;
					if (transform.tx+transform.px < minX)
						transform.tx = minX - transform.px;
					if (transform.ty+transform.py > maxY)
						transform.ty = maxY - transform.py;
					if (transform.ty+transform.py < minY)
						transform.ty = minY - transform.py;

					$target
						.data('transform',transform)
						.css
						({
							transform:'scale('+transform.s+') translate('+(transform.tx+transform.px)+'px,'+(transform.ty+transform.py)+'px)',
							transformOrigin:'0 0'
						});
				})
				.on('touchy-drag',function (event,phase,$target,data)
				{
					if (phase != 'move') return;

					var transform = $target.data('transform');
					var minX = (vw / transform.s) - vw;
					var maxX = 0;
					var minY = (vh / transform.s) - vh;
					var maxY = 0;

					transform.tx += (data.movePoint.x - data.lastMovePoint.x) / transform.s;
					transform.ty += (data.movePoint.y - data.lastMovePoint.y) / transform.s;

					if (transform.tx+transform.px > maxX)
						transform.tx = maxX - transform.px;
					if (transform.tx+transform.px < minX)
						transform.tx = minX - transform.px;
					if (transform.ty+transform.py > maxY)
						transform.ty = maxY - transform.py;
					if (transform.ty+transform.py < minY)
						transform.ty = minY - transform.py;

					$target
						.data('transform',transform)
						.css
						({
							transform:'scale('+transform.s+') translate('+(transform.tx+transform.px)+'px,'+(transform.ty+transform.py)+'px)',
							transformOrigin:'0 0'
						});
				});
		},
		resize:function (width,height)
		{
			vw = width;
			vh = height;

			// shrink the view dimensions to maximum bounds.
			if (vw > bw) vw = bw;
			if (vh > bh) vh = bh;

			// shrink a dimension to maintain proportion.
			if (vw / bw > vh / bh)
			{
				vw = bw * (vh / bh);
			}
			else
			{
				vh = bh * (vw / bw);
			}

			self.$canvas
				.data('transform',{sx:0,sy:0,cx:0,cy:0,s:1,tx:0,ty:0,ox:0,oy:0,px:0,py:0})
				.css({width:vw,height:vh,transform:'',transformOrigin:''});

			return self;
		},
		draw:function (data)
		{
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
		renderAnim:function (anim,fps)
		{
			var self = this;
			var throttle = 1000 / fps;
			var running;
			var start;
			var delay = 0;
			var count = 0;
			var skip = 0;

			var loop = function (now)
			{
				skip = 0;

				// stop the loop if anim returned false
				if (running !== false)
				{
					if (count)
					{
						delay = (now - start) - (count * throttle);

						if (delay > throttle)
						{
							skip = Math.floor(delay / throttle);
							count += skip;

							requestAnimationFrame(loop);
						}
						else
						{
							setTimeout(function () { requestAnimationFrame(loop); },throttle-delay);
						}
					}
					else
					{
						start = now;
						setTimeout(function () { requestAnimationFrame(loop); },throttle);
					}

					running = anim(skip);
					render();
					count++;
				}
			}
			requestAnimationFrame(loop);
		},
		images:
		[
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
		sounds:
		{
			focus:'sound15',
			select:'sound14',
			strike:'sound6'
		},
		animations:
		{
			death:
			[
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
				ability:'Melee Attack',
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
					step:'sound13',
					attack1:'sound809',
					attack2:'sound2021',
					block:'sound12'
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
				}
			},
			{name:'Pyromancer'},
			{name:'Scout'},
			{name:'Cleric'},
			{name:'Barrier Ward'},
			{name:'Lightning Ward'},
			{name:'Witch'},
			{
				name:'Assassin',
				ability:'Melee Attack',
				power:18,
				armor:12,
				health:35,
				recovery:1,
				blocking:70,
				aType:'melee',
				aRadius:1,
				mRadius:4,
				sounds:
				{
					step:'sound13',
					attack1:'sound809',
					attack2:'sound2021',
					block:'sound12'
				},
				stills:{S:1,W:55,N:109,E:163},
				turns:{S:11,W:65,N:119,E:173},
				animations:
				{
					S:{backup:{s:  2,l:6},moveup:{s:  8,l:3},deploy:{s: 12,l:9},attack:{s: 21,l:11},explode:{s: 32,l:15},block:{s: 47,l:8}},
					W:{backup:{s: 56,l:6},moveup:{s: 62,l:3},deploy:{s: 66,l:9},attack:{s: 75,l:11},explode:{s: 86,l:15},block:{s:101,l:8}},
					N:{backup:{s:110,l:6},moveup:{s:116,l:3},deploy:{s:120,l:9},attack:{s:129,l:11},explode:{s:140,l:15},block:{s:155,l:8}},
					E:{backup:{s:164,l:6},moveup:{s:170,l:3},deploy:{s:174,l:9},attack:{s:183,l:11},explode:{s:194,l:15},block:{s:209,l:8}}
				},
        frames:
        [
					// Junk
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:1734,x:-25,y:-64},
						{id:1736,x:-14,y:-54,n:'trim'}
					]},
					// S Still
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:1734,x:-25,y:-64},
						{id:1736,x:-14,y:-54,n:'trim'}
					]},
					// S Back Step
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:1997,x:14,y:-29,w:45,f:'H'},     // shape 1998
						{id:1738,x:25,y:-21,w:30,f:'H',n:'trim'} // shape 1739
					],x:-44,y:-28},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:1999,x:-28,y:-61},
						{id:1740,x:-23,y:-52,n:'trim'}
					],f:'H'},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2001,x:6-44,y:-39-28}, // shape 2002
						{id:1742,x:-29,y:-57,n:'trim'}      // shape 1743
					],f:'H'},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2003,x:9-44,y:-40-28},
						{id:1744,x:-30,y:-59,n:'trim'}
					],f:'H'},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2005,x:-49,y:-71},
						{id:1746,x:3-44,y:-35-28,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:1734,x:-47,y:-78},
						{id:1736,x:-36,y:-68,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2003,x:9-44,y:-40-28},
						{id:1744,x:-30,y:-59,n:'trim'}
					],f:'H'},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2001,x:6-44,y:-39-28},
						{id:1742,x:-29,y:-57,n:'trim'}
					],f:'H'},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:1999,x:-28,y:-61},
						{id:1740,x:-23,y:-52,n:'trim'}
					],f:'H'},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:1997,x:-30,y:-57},
						{id:1738,x:25-44,y:-21-28,n:'trim'}
					],f:'H'},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2008,x:-24,y:-54},
						{id:1749,x:-19,y:-47,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2010,x:-16,y:-53},
						{id:1751,x:-14,y:-45,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2012,x:-12,y:-47},
						{id:1753,x:-8,y:-39,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2005,x:-5,y:-43},
						{id:1746,x:3,y:-35,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2003,x:9,y:-40},
						{id:1744,x:14,y:-31,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2001,x:6,y:-39},
						{id:1742,x:15,y:-29,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:1999,x:16,y:-33},
						{id:1740,x:21,y:-24,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:1997,x:14,y:-29},         // shape2016 (14,-29)[45x59] | image1997 48x62
						{id:1738,x:25,y:-21,n:'trim'} // shape
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:1997,x:14,y:-29},
						{id:1738,x:25,y:-21,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2017,x:-18,y:-61},
						{id:1758,x:-9,y:-50,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2019,x:-27,y:-59},
						{id:1760,x:-14,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2022,x:-10,y:-63},
						{id:1762,x:-10,y:-48,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2024,x:-50,y:-53},
						{id:1764,x:-35,y:-48,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2026,x:-33,y:-66},
						{id:1766,x:-32,y:-66,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2028,x:-45,y:-61},
						{id:1768,x:-31,y:-60,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2030,x:-43,y:-55},
						{id:1770,x:-26,y:-55,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2032,x:-36,y:-69},
						{id:1772,x:-36,y:-55,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2034,x:-32,y:-58},
						{id:1774,x:-28,y:-49,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2036,x:-27,y:-62},
						{id:1776,x:-19,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2036,x:-27,y:-62},
						{id:1776,x:-19,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:1734,x:-25,y:-64},
						{id:1736,x:-14,y:-54,n:'trim'},
						//{id:1367,x:-30,y:-30-31,s:1.150,a:2.00}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:1734,x:-25,y:-64},
						{id:1736,x:-14,y:-54,n:'trim'},
						//{id:1366,x:-30,y:-30-31,s:1.150,a:3.50}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:1734,x:-25,y:-64},
						{id:1736,x:-14,y:-54,n:'trim'},
						//{id:1367,x:-30,y:-30-31,s:1.379,a:1.94}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2038,x:-17  ,y:-55},
						{id:1778,x:-9,y:-48,n:'trim'},
						{id:2038,x:-17+1,y:-55-3         ,a:0.39},
						{id:1778,x:-9 +1,y:-48-3         ,a:0.39,n:'trim'},
						{id:2038,x:-17-4,y:-55+1         ,a:0.39},
						{id:1778,x:-9 -4,y:-48+1         ,a:0.39,n:'trim'},
						//{id:1366,x:-30  ,y:-30-31,s:1.551,a:0.77}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2040,x:-12  ,y:-50},
						{id:1780,x:-10,y:-45,n:'trim'},
						{id:2040,x:-12+2,y:-50-6         ,a:0.30},
						{id:1780,x:-10+2,y:-45-6         ,a:0.30,n:'trim'},
						{id:2040,x:-12-8,y:-50+2         ,a:0.30},
						{id:1780,x:-10-8,y:-45+2         ,a:0.30,n:'trim'},
						//{id:1367,x:-30  ,y:-30-31,s:1.667,a:0}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2042,x:-12  ,y:-50},
						{id:1782,x:-11,y:-44,n:'trim'},
						{id:2042,x:-12+2,y:-50-6         ,a:0.19},
						{id:1782,x:-11+2,y:-44-6         ,a:0.19,n:'trim'},
						{id:2042,x:-12-8,y:-50+2         ,a:0.19},
						{id:1782,x:-11-8,y:-44+2         ,a:0.19,n:'trim'},
						//{id:1366,x:-30  ,y:-30-31,s:1.667,a:0}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2044,x:-12,y:-52},
						{id:1784,x:-11,y:-44,n:'trim'},
						{id:2044,x:-12+1,y:-52-3         ,a:0.1},
						{id:1784,x:-11+1,y:-44-3         ,a:0.1,n:'trim'},
						{id:2044,x:-12-4,y:-52+1         ,a:0.1},
						{id:1784,x:-11-4,y:-44+1         ,a:0.1,n:'trim'},
						{id:56  ,x:-12  ,y:-12-41,s:1.5  ,a:0}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2046,x:-13  ,y:-58},
						{id:1786,x:-9,y:-47,n:'trim'},
						{id:56  ,x:-12  ,y:-12-41,s:1.778,a:0.1}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2048,x:-16  ,y:-62},
						{id:1788,x:-10,y:-57,n:'trim'},
						{id:56  ,x:-12  ,y:-12-41,s:2.611,a:0.44}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2050,x:-35  ,y:-69},
						{id:1790,x:-27,y:-67,n:'trim'},
						{id:56  ,x:-12  ,y:-12-41,s:4}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2052,x:-28  ,y:-69},
						{id:1792,x:-28,y:-59,n:'trim'},
						{id:56  ,x:-12  ,y:-12-41,s:5.111,a:0.44}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2054,x:-26  ,y:-67},
						{id:1794,x:-26,y:-55,n:'trim'},
						{id:56  ,x:-12  ,y:-12-41,s:5.778,a:0.10}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2056,x:-22  ,y:-63},
						{id:1796,x:-22,y:-53,n:'trim'},
						{id:56  ,x:-12  ,y:-12-41,s:6    ,a:0}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2058,x:-22,y:-63},
						{id:1798,x:-19,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2058,x:-22,y:-63},
						{id:1798,x:-19,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2060,x:-16,y:-64},
						{id:1800,x:-9,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2062,x:-12,y:-62},
						{id:1802,x:-10,y:-51,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2062,x:-12,y:-62},
						{id:1802,x:-10,y:-51,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2062,x:-12,y:-62},
						{id:1802,x:-10,y:-51,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2064,x:-12,y:-63},
						{id:1804,x:-9,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2060,x:-16,y:-64},
						{id:1800,x:-9,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2060,x:-16,y:-64},
						{id:1800,x:-9,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2017,x:-18,y:-61},
						{id:1758,x:-9,y:-50,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2066,x:-19,y:-64},
						{id:1806,x:-16,y:-54,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2005,x:-17,y:-57},
						{id:1746,x:-59,y:-21,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2012,x:-16,y:-61},
						{id:1753,x:-16,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2010,x:-57+44,y:-39-28},
						{id:1751,x:-13,y:-59,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2008,x:-48+44,y:-40-28},
						{id:1749,x:-48,y:-33,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:1997,x:7,y:-71},
						{id:1738,x:11,y:-63,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2066,x:-19+22,y:-64-14},
						{id:1806,x:6,y:-68,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2008,x:-48+44,y:-40-28},
						{id:1749,x:-48,y:-33,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2010,x:-57+44,y:-39-28},
						{id:1751,x:-13,y:-59,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2012,x:-16,y:-61},
						{id:1753,x:-16,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2005,x:-17,y:-57},
						{id:1746,x:-59,y:-21,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2003,x:-18,y:-54},
						{id:1744,x:-17,y:-45,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2001,x:-29,y:-53},
						{id:1742,x:-24,y:-43,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:1999,x:-29,y:-47},
						{id:1740,x:-27,y:-38,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:1997,x:-37,y:-43},
						{id:1738,x:-33,y:-35,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2008,x:-48,y:-40},
						{id:1749,x:-48,y:-33,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2010,x:-57,y:-39},
						{id:1751,x:-57,y:-31,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2012,x:-60,y:-33},
						{id:1753,x:-60,y:-25,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2005,x:-61,y:-29},
						{id:1746,x:-59,y:-21,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2005,x:-61,y:-29},
						{id:1746,x:-59,y:-21,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2079,x:-31,y:-59},
						{id:1820,x:-18,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2081,x:-15,y:-52},
						{id:1822,x:-15,y:-48,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2083,x:-34,y:-54},
						{id:1824,x:-21,y:-48,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2085,x:-18,y:-75},
						{id:1826,x:-17,y:-63,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2087,x:-42,y:-66},
						{id:1828,x:-26,y:-66,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2089,x:-37,y:-70},
						{id:1830,x:-22,y:-63,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2091,x:-31,y:-74},
						{id:1832,x:-30,y:-62,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2093,x:-25,y:-67},
						{id:1834,x:-23,y:-67,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2095,x:-32,y:-58},
						{id:1836,x:-24,y:-46,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2097,x:-18,y:-61},
						{id:1838,x:-15,y:-51,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2097,x:-18,y:-61},
						{id:1838,x:-15,y:-51,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2066,x:-19,y:-64},
						{id:1806,x:-16,y:-54,n:'trim'},
						//{id:1367,x:-30,y:-30-31,s:1.150,a:2}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2066,x:-19,y:-64},
						{id:1806,x:-16,y:-54,n:'trim'},
						//{id:1366,x:-30,y:-30-31,s:1.150,a:3.5}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2066,x:-19,y:-64},
						{id:1806,x:-16,y:-54,n:'trim'},
						//{id:1367,x:-30,y:-30-31,s:1.379,a:1.94}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2099,x:-28,y:-55},
						{id:1840,x:-28,y:-49,n:'trim'},
						{id:2099,x:-28+1,y:-55+3,a:0.39},
						{id:1840,x:-28,y:-49,n:'trim'},
						{id:2099,x:-28-4,y:-55+1,a:0.39},
						{id:1840,x:-28,y:-49,n:'trim'},
						//{id:1366,x:-30,y:-30-31,s:1.551,a:0.77}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2101,x:-33,y:-50},
						{id:1842,x:-23,y:-46,n:'trim'},
						{id:2101,x:-33-2,y:-50-6,a:0.30},
						{id:1842,x:-23,y:-46,n:'trim'},
						{id:2101,x:-33+8,y:-50+2,a:0.30},
						{id:1842,x:-23,y:-46,n:'trim'},
						//{id:1367,x:-30,y:-30-31,s:1.666,a:0}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2103,x:-31,y:-51},
						{id:1844,x:-20,y:-45,n:'trim'},
						{id:2103,x:-31-2,y:-51-6,a:0.19},
						{id:1844,x:-20,y:-45,n:'trim'},
						{id:2103,x:-31+8,y:-51+2,a:0.19},
						{id:1844,x:-20,y:-45,n:'trim'},
						//{id:1366,x:-30,y:-30-31,s:1.666,a:0}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2105,x:-30,y:-52},
						{id:1846,x:-20,y:-44,n:'trim'},
						{id:2105,x:-30-1,y:-52-3,a:0.10},
						{id:1846,x:-20,y:-44,n:'trim'},
						{id:2105,x:-30+4,y:-52+1,a:0.10},
						{id:1846,x:-20,y:-44,n:'trim'},
						{id:56,x:-12,y:-12-41,s:1.500,a:0}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2107,x:-35,y:-58},
						{id:1848,x:-22,y:-47,n:'trim'},
						{id:56,x:-12,y:-12-41,s:1.778,a:10}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2109,x:-50,y:-62},
						{id:1850,x:-35,y:-57,n:'trim'},
						{id:56,x:-12,y:-12-41,s:2.611,a:44}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2111,x:-32,y:-71},
						{id:1852,x:-31,y:-71,n:'trim'},
						{id:56,x:-12,y:-12-41,s:4}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2113,x:-18,y:-69},
						{id:1854,x:-16,y:-58,n:'trim'},
						{id:56,x:-12,y:-12-41,s:5.111,a:0.44}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2115,x:-17,y:-67},
						{id:1856,x:-17,y:-56,n:'trim'},
						{id:56,x:-12,y:-12-41,s:5.778,a:0.10}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2117,x:-17,y:-64},
						{id:1858,x:-17,y:-52,n:'trim'},
						{id:56,x:-12,y:-12-41,s:6,a:0}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2119,x:-15,y:-64},
						{id:1860,x:-15,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2119,x:-15,y:-64},
						{id:1860,x:-15,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2121,x:-25,y:-63},
						{id:1862,x:-23,y:-54,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2123,x:-22,y:-60},
						{id:1864,x:-22,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2123,x:-22,y:-60},
						{id:1864,x:-22,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2123,x:-22,y:-60},
						{id:1864,x:-22,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2125,x:-26,y:-61},
						{id:1866,x:-25,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2121,x:-25,y:-63},
						{id:1862,x:-23,y:-54,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2121,x:-25,y:-63},
						{id:1862,x:-23,y:-54,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2079,x:-31,y:-59},
						{id:1820,x:-18,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2127,x:-16,y:-65},
						{id:1868,x:-13,y:-54,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2129,x:-14,y:-62},
						{id:1870,x:-56,y:-80,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2131,x:-6,y:-59},
						{id:1872,x:-48,y:-77,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2133,x:-50+44,y:-84+28},
						{id:1874,x:-1,y:-44,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2135,x:-39+44,y:-80+28},
						{id:1876,x:5,y:-42,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2137,x:4,y:-48},
						{id:1878,x:-38,y:-65,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2127,x:6,y:-51},
						{id:1868,x:-13,y:-54,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2135,x:-39+44,y:-80+28},
						{id:1876,x:5,y:-42,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2133,x:-50+44,y:-84+28},
						{id:1874,x:-1,y:-44,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2131,x:-6,y:-59},
						{id:1872,x:-48,y:-77,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2129,x:-14,y:-62},
						{id:1870,x:-56,y:-80,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2140,x:-27,y:-67},
						{id:1880,x:-27,y:-56,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2142,x:-36,y:-71},
						{id:1882,x:-36,y:-60,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2144,x:-39,y:-73},
						{id:1884,x:-39,y:-63,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2137,x:-40,y:-76},
						{id:1878,x:-38,y:-65,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2135,x:-39,y:-80},
						{id:1876,x:-39,y:-70,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2133,x:-50,y:-84},
						{id:1874,x:-45,y:-72,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2131,x:-50,y:-87},
						{id:1872,x:-48,y:-77,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2129,x:-58,y:-90},
						{id:1870,x:-56,y:-80,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2129,x:-58,y:-90},
						{id:1870,x:-56,y:-80,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2149,x:-20,y:-63},
						{id:1888,x:-19,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2151,x:-37,y:-59},
						{id:1890,x:-21,y:-48,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2153,x:-27,y:-60},
						{id:1892,x:-20,y:-51,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2155,x:-47,y:-62},
						{id:1894,x:-34,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2157,x:-41,y:-72},
						{id:1896,x:-26,y:-62,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2159,x:-36,y:-67},
						{id:1898,x:-36,y:-58,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2161,x:-27,y:-65},
						{id:1900,x:-26,y:-65,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2163,x:-48,y:-60},
						{id:1902,x:-31,y:-51,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2165,x:-30,y:-62},
						{id:1904,x:-17,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2167,x:-27,y:-64},
						{id:1906,x:-25,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2167,x:-27,y:-64},
						{id:1906,x:-25,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2127,x:-16,y:-65},
						{id:1868,x:-13,y:-54,n:'trim'},
						//{id:1367,x:-30,y:-30-31,s:1.150,a:2}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2127,x:-16,y:-65},
						{id:1868,x:-13,y:-54,n:'trim'},
						//{id:1366,x:-30,y:-30-31,s:1.150,a:3.5}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2127,x:-16,y:-65},
						{id:1868,x:-13,y:-54,n:'trim'},
						//{id:1367,x:-30,y:-30-31,s:1.379,a:1.94}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2169,x:-25,y:-61},
						{id:1908,x:-25,y:-51,n:'trim'},
						{id:2169,x:-25+4,y:-61+0,a:0.39},
						{id:1908,x:-25,y:-51,n:'trim'},
						{id:2169,x:-25-1,y:-61+3,a:0.39},
						{id:1908,x:-25,y:-51,n:'trim'},
						//{id:1366,x:-30,y:-30-31,s:1.551,a:0.77}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2171,x:-33,y:-58},
						{id:1910,x:-22,y:-49,n:'trim'},
						{id:2171,x:-33+8,y:-58+0,a:0.30},
						{id:1910,x:-22,y:-49,n:'trim'},
						{id:2171,x:-33-2,y:-58+6,a:0.30},
						{id:1910,x:-22,y:-49,n:'trim'},
						//{id:1367,x:-30,y:-30-31,s:1.666,a:0}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2173,x:-30,y:-57},
						{id:1912,x:-21,y:-49,n:'trim'},
						{id:2173,x:-30+8,y:-57+0,a:0.19},
						{id:1912,x:-21,y:-49,n:'trim'},
						{id:2173,x:-30-2,y:-57+6,a:0.19},
						{id:1912,x:-21,y:-49,n:'trim'},
						//{id:1366,x:-30,y:-30-31,s:1.666,a:0}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2175,x:-30,y:-57},
						{id:1914,x:-22,y:-49,n:'trim'},
						{id:2175,x:-30+4,y:-57+0,a:0.10},
						{id:1914,x:-22,y:-49,n:'trim'},
						{id:2175,x:-30-1,y:-57+3,a:0.10},
						{id:1914,x:-22,y:-49,n:'trim'},
						{id:56,x:-12,y:-12-41,s:1.500,a:0}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2177,x:-33,y:-61},
						{id:1916,x:-24,y:-52,n:'trim'},
						{id:56,x:-12,y:-12-41,s:1.778,a:0.10}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2179,x:-50,y:-87},
						{id:1918,x:-35,y:-81,n:'trim'},
						{id:56,x:-12,y:-12-41,s:2.611,a:0.44}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2181,x:-32,y:-76},
						{id:1920,x:-31,y:-73,n:'trim'},
						{id:56,x:-12,y:-12-41,s:4}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2183,x:-18,y:-73},
						{id:1922,x:-15,y:-61,n:'trim'},
						{id:56,x:-12,y:-12-41,s:5.111,a:0.44}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2185,x:-17,y:-70},
						{id:1924,x:-16,y:-69,n:'trim'},
						{id:56,x:-12,y:-12-41,s:5.778,a:0.10}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2187,x:-15,y:-64},
						{id:1926,x:-16,y:-52,n:'trim'},
						{id:56,x:-12,y:-12-41,s:6,a:0}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2189,x:-13,y:-63},
						{id:1928,x:-14,y:-54,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2189,x:-13,y:-63},
						{id:1928,x:-14,y:-54,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2191,x:-29,y:-64},
						{id:1930,x:-29,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2193,x:-30,y:-64},
						{id:1932,x:-23,y:-62,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2193,x:-30,y:-64},
						{id:1932,x:-23,y:-62,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2193,x:-30,y:-64},
						{id:1932,x:-23,y:-62,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2195,x:-38,y:-63},
						{id:1934,x:-26,y:-60,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2191,x:-29,y:-64},
						{id:1930,x:-29,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2191,x:-29,y:-64},
						{id:1930,x:-29,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2149,x:-20,y:-63},
						{id:1888,x:-19,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2197,x:-21,y:-66},
						{id:1936,x:-17,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2137,x:-26,y:-62},
						{id:1878,x:-18,y:-51,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2144,x:-32,y:-59},
						{id:1884,x:16,y:-77,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2142,x:-37,y:-56},
						{id:1882,x:-35,y:-46,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2140,x:-1-44,y:-81+28},
						{id:1880,x:4,y:-70,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2129,x:-52,y:-48},
						{id:1870,x:2,y:-66,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2197,x:-43,y:-52},
						{id:1936,x:-17,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2140,x:-1-44,y:-81+28},
						{id:1880,x:4,y:-70,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2142,x:-37,y:-56},
						{id:1882,x:-35,y:-46,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2144,x:-32,y:-59},
						{id:1884,x:16,y:-77,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2137,x:-26,y:-62},
						{id:1878,x:-18,y:-51,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2135,x:-16,y:-66},
						{id:1876,x:-9,y:-56,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2133,x:-17,y:-70},
						{id:1874,x:-8,y:-58,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2131,x:-8,y:-73},
						{id:1872,x:-2,y:-63,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2129,x:-8,y:-76},
						{id:1870,x:2,y:-66,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2140,x:-1,y:-81},
						{id:1880,x:4,y:-70,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2142,x:7,y:-85},
						{id:1882,x:9,y:-74,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2144,x:12,y:-87},
						{id:1884,x:16,y:-77,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2137,x:18,y:-90},
						{id:1878,x:26,y:-79,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2137,x:18,y:-90},
						{id:1878,x:26,y:-79,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2212,x:-26,y:-66},
						{id:1948,x:-20,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2214,x:-25,y:-65},
						{id:1950,x:-17,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2216,x:-45,y:-63},
						{id:1952,x:-29,y:-50,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2218,x:-17,y:-76},
						{id:1954,x:-13,y:-65,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2220,x:-33,y:-72},
						{id:1956,x:-32,y:-62,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2222,x:-28,y:-67},
						{id:1958,x:-26,y:-67,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2224,x:-43,y:-59},
						{id:1960,x:-32,y:-51,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2226,x:-34,y:-64},
						{id:1962,x:-16,y:-56,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2228,x:-19,y:-62},
						{id:1964,x:-12,y:-51,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2230,x:-21,y:-65},
						{id:1966,x:-12,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2230,x:-21,y:-65},
						{id:1966,x:-12,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2197,x:-21,y:-66},
						{id:1936,x:-17,y:-53,n:'trim'},
						//{id:1367,x:-30,y:-30-31,s:1.150,a:2}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2197,x:-21,y:-66},
						{id:1936,x:-17,y:-53,n:'trim'},
						//{id:1366,x:-30,y:-30-31,s:1.150,a:3.50}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2197,x:-21,y:-66},
						{id:1936,x:-17,y:-53,n:'trim'},
						//{id:1367,x:-30,y:-30-31,s:1.379,a:1.94}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2232,x:-26,y:-61},
						{id:1968,x:-12,y:-50,n:'trim'},
						{id:2232,x:-26+1,y:-61+3,a:0.39},
						{id:1968,x:-12,y:-50,n:'trim'},
						{id:2232,x:-26-4,y:-61+0,a:0.39},
						{id:1968,x:-12,y:-50,n:'trim'},
						//{id:1366,x:-30,y:-30-31,s:1.551,a:0.77}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2234,x:-14,y:-58},
						{id:1970,x:-12,y:-48,n:'trim'},
						{id:2234,x:-14+2,y:-58+6,a:0.30},
						{id:1970,x:-12,y:-48,n:'trim'},
						{id:2234,x:-14-8,y:-58+0,a:0.30},
						{id:1970,x:-12,y:-48,n:'trim'},
						//{id:1367,x:-30,y:-30-31,s:1.666,a:0}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2236,x:-14,y:-57},
						{id:1972,x:-11,y:-48,n:'trim'},
						{id:2236,x:-14+2,y:-57+6,a:0.19},
						{id:1972,x:-11,y:-48,n:'trim'},
						{id:2236,x:-14-8,y:-57+0,a:0.19},
						{id:1972,x:-11,y:-48,n:'trim'},
						//{id:1366,x:-30,y:-30-31,s:1.666,a:0}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2238,x:-14,y:-57},
						{id:1974,x:-11,y:-49,n:'trim'},
						{id:2238,x:-14+1,y:-57+3,a:0.10},
						{id:1974,x:-11,y:-49,n:'trim'},
						{id:2238,x:-14-4,y:-57+0,a:0.10},
						{id:1974,x:-11,y:-49,n:'trim'},
						{id:56,x:-12,y:-12-41,s:1.500,a:0}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2240,x:-15,y:-61},
						{id:1976,x:-12,y:-52,n:'trim'},
						{id:56,x:-12,y:-12-41,s:1.778,a:0.10}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2242,x:-17,y:-89},
						{id:1978,x:-10,y:-80,n:'trim'},
						{id:56,x:-12,y:-12-41,s:2.611,a:0.44}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2244,x:-33,y:-73},
						{id:1980,x:-26,y:-70,n:'trim'},
						{id:56,x:-12,y:-12-41,s:4}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2246,x:-29,y:-72},
						{id:1982,x:-29,y:-61,n:'trim'},
						{id:56,x:-12,y:-12-41,s:5.111,a:0.44}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2248,x:-28,y:-70},
						{id:1984,x:-27,y:-57,n:'trim'},
						{id:56,x:-12,y:-12-41,s:5.778,a:0.10}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2250,x:-25,y:-63},
						{id:1986,x:-25,y:-53,n:'trim'},
						{id:56,x:-12,y:-12-41,s:6,a:0}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2252,x:-25,y:-63},
						{id:1988,x:-24,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2252,x:-25,y:-63},
						{id:1988,x:-24,y:-52,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2254,x:-14,y:-65},
						{id:1990,x:-12,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2256,x:-14,y:-64},
						{id:1992,x:-14,y:-61,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2256,x:-14,y:-64},
						{id:1992,x:-14,y:-61,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2256,x:-14,y:-64},
						{id:1992,x:-14,y:-61,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2258,x:-14,y:-66},
						{id:1994,x:-13,y:-67,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2254,x:-14,y:-65},
						{id:1990,x:-12,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2254,x:-14,y:-65},
						{id:1990,x:-12,y:-53,n:'trim'}
					]},
					{c:[
						{id:56,x:0,y:0,a:0},
						{id:2212,x:-26,y:-66},
						{id:1948,x:-20,y:-53,n:'trim'}
					]},
        ]
      },
			{name:'Enchantress'},
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
					// S Deploy
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
					// W Deploy
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
					// N Deploy
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
					// E Deploy
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
				name:'Chaos Seed',
				ability:'Chaos',
				specialty:'Awaken',
				power:24,
				armor:99,
				health:6,
				recovery:0,
				blocking:50,
				aType:'magic',
				aRadius:0,
				mRadius:0,
				directional:false,
				sounds:
				{
					crack:'crack',
					block:'sound8',
					heal:'sound1203',
					lightning:'sound1370',
					wind:{file:'chaos',volume:0.25,sprite:
					{
						wind1:[   0,1950],
						wind2:[2150,1950],
						wind3:[4300,1800],
						wind4:[6300,2500],
						wind5:[9000,1725]
					}},
					phase:{file:'sound4',rate:0.5},
					roar:{file:'chaos',sprite:
					{
						roar :[10925,1675]
					}}
				},
				stills:{S:0},
				frames:
				[
					{x:-2,y:12,c:[{id:6459,x:-12.5,y:-19.5},{id:1351,x:-21,y:-61},{id:1354,x:-20,y:-57}]}
				]
			},
			{name:'Wisp'},
			{name:'Furgon'},
			{name:'Shrub'},
			{
				name:'Champion',
				stills:{S:0,N:1},
				frames:
				[
					{x:-26,y:-67,c:[{id:6354},{id:4713,x:-1,y:-1}]},
					{x:-30,y:-102,c:[{id:6354,f:'B'},{id:4715,x:-1,y:-1}]}
				]
			},
			{name:'Ambusher'},
			{name:'Berserker'},
			{
				name:'Chaos Dragon',
				ability:'Lightning',
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
				sounds:
				{
					flap:'sound7',
					block:'sound11',
					heal:'sound1203',
					impact:'sound1602',
					charge:{file:'charge',rate:0.6},
					buzz:{file:'buzz',rate:0.6},
					phase:{file:'sound4',rate:0.5}
				},
				stills:{S:0,W:48,N:96,E:144},
				turns:{S:1,W:49,N:97,E:145},
				animations:
				{
					S:{deploy:{s:  2,l:23},attack:{s: 25,l:9},block:{s: 34,l:6},hatch:{s: 40,l:8}},
					W:{deploy:{s: 50,l:23},attack:{s: 73,l:9},block:{s: 82,l:6},hatch:{s: 88,l:8}},
					N:{deploy:{s: 98,l:23},attack:{s:121,l:9},block:{s:130,l:6},hatch:{s:136,l:8}},
					E:{deploy:{s:146,l:23},attack:{s:169,l:9},block:{s:178,l:6},hatch:{s:184,l:8}}
				},
				frames:
				[
					// S Still
					{c:[{id:6055,x:-70,y:-40,a:0.5},{id:3955,x:-71,y:-101},{id:3957,x:-29,y:-52}]},
					// S Turn
					{c:[{id:6057,x:-53,y:-36,a:0.5},{id:4102,x:-52,y:-109},{id:3959,x:-14,y:-54}]},
					// S Deploy
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
					// W Deploy
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
					// N Deploy
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
					// E Deploy
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
		colors:
		[
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
