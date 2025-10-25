(function ()
{
  'use strict';

  // Animation class.
  Tactics.Animation = function (options) {
    let self = this;
    let frames = [];

    let data = Object.assign({
      /*
       * Animations typically run at 12 frames-per-second.
       */
      fps: 12,
      /*
       * By default, the animation ends when all frames are rendered.
       * But, loop can be used to restart the animation from a specific index.
       */
      loop: null,
      /*
       * Animation state contains arbitrary data that can help track the status
       * of the animation as it runs or when it is stopped.
       */
      state: {},
      /*
       * By default, frames are skipped to maintain animation speed on low-end
       * hardware.  But, all scripts are run to guarantee logical integrity.
       *
       * May be set to "true" for skipping scripts as well, which is useful for
       * animations of idempotent frames (frames that can render correctly even
       * if previous frames are skipped).
       *
       * May be set to "false" for potentially laggy, but complete, animations.
       */
      skipFrames: 'run-script',
    }, options);

    if (data.loop === true)
      data.loop = 0;

    if (data.speed)
      data.fps *= data.speed;

    utils.addEvents.call(self);

    Object.assign(self, {
      frames: frames,
      state: data.state,

      /*
       * Append a frame to the animation.
       *
       * Frame may be a function, which serves as frame script.
       * The frame may be an object with these members:
       * {
       *   duration: (default: 1000 / fps) Length of the frame in milliseconds.
       *   scripts: Array of functions that are called to render the frame.
       *   script: A function.  Shorthand for "scripts: [script]".
       *   repeat: (default: 1) Shorthand for "addFrames([frame, frame, ...])".
       * }
       */
      addFrame: function (frame) {
        let index = frames.length;
        let template = {
          scripts:  [],
          duration: 1000/data.fps
        };

        if (typeof frame === 'function') {
          frame = Object.assign(template, { scripts:[frame] });
        } else if (Array.isArray(frame)) {
          frame = Object.assign(template, { scripts:frame });
        } else if (frame instanceof Tactics.Animation) {
          frame.frames.forEach(f => this.addFrame(f));
          return self;
        } else if (typeof frame === 'object') {
          frame = Object.assign(template, frame);

          if (frame.script) {
            frame.scripts.push(frame.script);
            delete frame.script;
          }
        }

        let repeat;
        if (repeat = frame.repeat) {
          delete frame.repeat;

          for (let i = 0; i < repeat; i++) {
            let repeat_frame = Object.assign({}, frame.clone(), { index:index + i });

            repeat_frame.scripts = repeat_frame.scripts.map(s => s.bind(this,
              Object.assign({repeat_index: i}, repeat_frame)
            ));
            frames.push(repeat_frame);
          }
        } else {
          frame = Object.assign({}, frame, {
            index: index,
          });

          frame.scripts = frame.scripts.map(s => s.bind(this, frame));
          frames.push(frame);
        }

        return self;
      },
      /*
       * Append more than one frame to the animation by passing a frame array
       */
      addFrames: function (new_frames) {
        for (let i = 0; i < new_frames.length; i++)
          self.addFrame(new_frames[i]);

        return self;
      },
      /*
       * Combine (splice) multiple animations in powerful ways.
       *
       * Usage: splice([offset,] animation)
       *   offset: (optional)
       *     One or more target animation frame indexes.
       *     The index may be negative where -1 is the last frame.
       *     The index may be the next index at the end.
       *   animation:
       *     One or more frames and/or animation objects.
       *
       * Note: When merging frames, the original frame duration is unchanged.
       *
       * Examples:
       *   // Modify anim1 by appending anim2.
       *   anim1.splice(anim2);
       *
       *   // Modify anim1 by merging (splicing) anim2 from the beginning.
       *   // Playing anim1 would play the frames from anim1 and anim2 in parallel.
       *   anim1.splice(0, anim2);
       *
       *   // Modify anim1 by duplicating (splicing) anim2 starting at frame offsets 0, 5, and 10.
       *   // Playing anim1 may show overlapping anim2 frames if anim2 is more than 5 frames in length.
       *   anim1.splice([0, 5, 10], anim2);
       *
       *   // Less idiomatic way of doing anim1.addFrames([frame1, frame2]).
       *   anim1.splice([frame1, frame2]);
       *
       */
      splice: function () {
        let args = Array.from(arguments);
        let offsets;
        let anim;

        if (args.length === 2) {
          offsets = Array.isArray(args[0]) ? args[0] : [args[0]];
          anim = args[1];
        } else {
          offsets = [frames.length];
          anim = args[0];
        }

        if (!anim) return self;

        if (Array.isArray(anim))
          anim = new Tactics.Animation({frames:anim});
        else if (!(anim instanceof Tactics.Animation))
          anim = new Tactics.Animation({frames:[anim]});

        offsets.forEach(offset => {
          if (offset > frames.length) throw 'Start index too high';
          if (offset < 0) {
            offset = frames.length + offset;
            if (offset < 0) throw 'Start index too low';
          }

          for (let i = 0; i < anim.frames.length; i++)
            if (offset+i < frames.length)
              Array.prototype.push.apply(frames[offset+i].scripts, anim.frames[i].scripts);
            else
              self.addFrame(anim.frames[i]);
        });

        return self;
      },
      /*
       * The play method accepts an optional callback and returns a promise that
       * is resolved when the animation ends or is stopped.  If a callback is
       * supplied it is called first before the promise chain is resolved.
       *
       * Note: The callback argument is deprecated.
       */
      play: function (callback) {
        // The cursor points to the current frame index while playing an animation.
        let cursor = 0;
        let render;

        data.playing = true;
        self.emit({type:'play', state:self.state});

        if (data.skipFrames === 'run-script') {
          // Frames are skipped, but all scripts are run to maintain logical consistency.
          render = skip => {
            var frame;

            skip++;
            while (skip-- && cursor < frames.length) {
              frame = frames[cursor++];

              for (let s = 0; s < frame.scripts.length; s++)
                if (frame.scripts[s].call(self, self.state) === false)
                  return false;
            }
          };
        }
        else if (data.skipFrames) {
          // Skip frames and scripts.
          render = skip => {
            var frame;

            cursor += skip;

            if (cursor < frames.length) {
              frame = frames[cursor++];

              for (let s = 0; s < frame.scripts.length; s++)
                if (frame.scripts[s].call(self, self.state) === false)
                  return false;
            }
          };
        }
        else {
          // Skip nothing.
          render = () => {
            var frame = frames[cursor++];

            for (let s = 0; s < frame.scripts.length; s++)
              if (frame.scripts[s].call(self, self.state) === false)
                return false;
          };
        }

        return new Promise((resolve, reject) => {
          data.resolver = resolve;

          Tactics.game.renderAnim(skip => {
            if (!data.playing) return false;
            if (render(skip) === false || (cursor == frames.length && data.loop === null)) {
              self.stop();
              return false;
            }

            if (cursor == frames.length)
              cursor = data.loop || 0;
          }, data.fps);
        }).then(callback);
      },
      /*
       * Stop an animation.  Useful for animations that loop indefinitely.
       */
      stop: function () {
        data.playing = false;
        self.emit({type:'stop', state:self.state});

        if (data.resolver) data.resolver(self.state);
      }
    });

    Object.defineProperty(self, 'fps', {
      value: data.fps,
      enumerable: true,
    });

    if (data.frames)
      self.addFrames(data.frames);

    return self;
  };

  Tactics.Animation.fromData = function (container, framesData, data = {}) {
    const frames = framesData.map(dataObjs => {
      const frame = new PIXI.Container();

      if (data.x) frame.position.x = data.x;
      if (data.y) frame.position.y = data.y;
      if (data.s) frame.scale = new PIXI.Point(data.s,data.s);
      if (data.a) frame.alpha = data.a;

      dataObjs.forEach(obj => {
        const sprite = PIXI.Sprite.from(obj.src);

        if (obj.pos) {
          sprite.position.x = obj.pos.x || 0;
          sprite.position.y = obj.pos.y || 0;
        }

        if (obj.scale) {
          sprite.anchor.x = 0.5;
          sprite.anchor.y = 0.5;
          sprite.scale.x = obj.scale.x || 1;
          sprite.scale.y = obj.scale.y || 1;
        }

        sprite.alpha = obj.alpha || 1;

        frame.addChild(sprite);
      });

      return frame;
    });

    let frame;

    return new Tactics.Animation({frames: [
      {
        script: () => {
          if (frame)
            container.removeChild(frame);

          if (frame = frames.shift())
            container.addChild(frame);
        },
        repeat: frames.length + 1,
      }
    ]});
  };

})();
