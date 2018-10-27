(function ()
{
	// Animation class.
  Tactics.Animation = function (options)
	{
		var self = this;
		var frames = [];
		var data = $.extend({skipFrames:'run-script'},options);

		$.extend(self,
		{
			frames:frames,

			isPlaying:function ()
			{
				return data.playing;
			},
			addFrame:function ()
			{
				var args = $.makeArray(arguments);
				var index = frames.length;
				var frame = {scripts:[],duration:1000/data.fps};
				var repeat;
				var i;

				if (args.length == 1)
				{
					if (typeof args[0] === 'function')
					{
						frame.scripts.push(args[0]);
					}
					else if (typeof args[0] === 'object')
					{
						$.extend(frame,args[0]);

						if (frame.script)
						{
							frame.scripts.push(frame.script);
							delete frame.script;
						}
					}
				}

				if (repeat = frame.repeat)
				{
					delete frame.repeat;

					for (i=0; i<repeat; i++)
						frames[frames.length++] = $.extend(true,{},frame,{index:index+i});
				}
				else
				{
					frames[frames.length++] = $.extend({},frame,{index:index});
				}

				return self;
			},
			addFrames:function (add)
			{
				var base = frames.length;
				var i;

				for (i=0; i<add.length; i++)
					self.addFrame(add[i]);

				return self;
			},
			splice:function ()
			{
				var args=$.makeArray(arguments),offsets,anim,i;

				if (args.length === 2)
				{
					offsets = $.isArray(args[0]) ? args[0] : [args[0]];
					anim = args[1];
				}
				else
				{
					offsets = [frames.length];
					anim = args[0];
				}

				if (!anim) return self;

				if ($.isArray(anim))
					anim = new Tactics.Animation({frames:anim});
				else if (!(anim instanceof Tactics.Animation))
					anim = new Tactics.Animation({frames:[anim]});

				$.each(offsets,function (i,offset)
				{
					if (offset > frames.length) throw 'Start index too high';

					for (i=0; i<anim.frames.length; i++)
						if (offset+i < frames.length)
							Array.prototype.push.apply(frames[offset+i].scripts,anim.frames[i].scripts);
						else
							self.addFrame(anim.frames[i]);
				});

				return self;
			},
			play:function (callback)
			{
				var f=0,s;
				var render;

				data.playing = true;
				if (callback) data.callback = callback;

				if (data.skipFrames === 'run-script')
				{
					// Yes, but run scripts for skipped frames.
					render = function (skip)
					{
						var frame;

						skip++;
						while (skip-- && f < frames.length)
						{
							frame = frames[f++];

							for (s=0; s<frame.scripts.length; s++)
								if (frame.scripts[s].call(self,frame) === false) return false;
						}
					};
				}
				else if (data.skipFrames)
				{
					render = function (skip)
					{
						var frame;

						f += skip;

						if (f < frames.length)
						{
							frame = frames[f++];

							for (s=0; s<frame.scripts.length; s++)
								if (frame.scripts[s].call(self,frame) === false) return false;
						}
					};
				}
				else
				{
					render = function ()
					{
						var frame = frames[f++];

						for (s=0; s<frame.scripts.length; s++)
							if (frame.scripts[s].call(self,frame) === false) return false;
					};
				}

				Tactics.renderAnim(function (skip)
				{
					if (!data.playing) return false;
					if (render(skip) === false || (f == frames.length && !data.loop))
					{
						if (data.callback) data.callback();
						return data.playing = false;
					}

					if (f == frames.length) f = 0;
				},data.fps);

				return self;
			},
			stop:function ()
			{
				data.playing = false;
				if (data.callback) data.callback();
			}
		});

		if (data.frames)
			self.addFrames(data.frames);

		return self;
	};

	Tactics.Animation.fromData = function (container,framesData,data)
	{
		var frames,frame;

		data = data || {};

		frames = $.map(framesData,function (dataObjs)
		{
			var frame = new PIXI.Container();

			if (data.x) frame.position.x = data.x;
			if (data.y) frame.position.y = data.y;
			if (data.s) frame.scale = new PIXI.Point(data.s,data.s);
			if (data.a) frame.alpha = data.a;

			$.each(dataObjs,function (i,obj)
			{
				var sprite = PIXI.Sprite.fromImage('http://www.taorankings.com/html5/images/'+obj.src);

				if (obj.pos)
				{
					sprite.position.x = obj.pos.x || 0;
					sprite.position.y = obj.pos.y || 0;
				}

				if (obj.scale)
				{
					sprite.pivot.x = (sprite.width  / 2) | 0;
					sprite.pivot.y = (sprite.height / 2) | 0;
					sprite.scale.x = obj.scale.x || 1;
					sprite.scale.y = obj.scale.y || 1;
				}

				sprite.alpha = obj.alpha || 1;

				frame.addChild(sprite);
			});

			return frame;
		});

		return new Tactics.Animation({frames:
		[
			{
				script:function ()
				{
					if (frame)
						container.removeChild(frame);

					if (frame = frames.shift())
						container.addChild(frame);
				},
				repeat:frames.length+1
			}
		]});
	};

})();
