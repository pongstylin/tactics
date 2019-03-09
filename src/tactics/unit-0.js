(function ()
{
  Tactics.units[0].extend = function (self, data, board) {
    var _super = Object.assign({}, self);
    var pixi;
    var type = self.type;
    var stills = {};
    var walks = {};
    var attacks = {};
    var blocks = {};
    var turns = {};

    $.extend(self,
    {
      /*
       * Before drawing a unit, it must first have an assignment and direction.
       */
      draw: function ()
      {
        pixi = self.pixi = new PIXI.Container();
        pixi.position = self.assignment.getCenter().clone();

        $.each(data.stills,function (direction,still)
        {
          stills[direction] = self.compileFrame(still);
        });

        if (data.walks)
        {
          $.each(data.walks,function (direction,walk)
          {
            var frames = [];

            $.each(walk,function (i,frame)
            {
              frames.push(self.compileFrame(frame));
            });

            walks[direction] = frames;
          });

          self.walks = walks;
        }

        if (data.attacks)
        {
          $.each(data.attacks,function (direction,attack)
          {
            var frames = [];

            $.each(attack,function (i,frame)
            {
              frames.push(self.compileFrame(frame));
            });

            attacks[direction] = frames;
          });
        }

        if (data.blocks)
        {
          $.each(data.blocks,function (direction,block)
          {
            var frames = [];

            $.each(block,function (i,frame)
            {
              frames.push(self.compileFrame(frame));
            });

            blocks[direction] = frames;
          });
        }

        $.each(data.turns,function (direction,turn)
        {
          turns[direction] = self.compileFrame(turn);
        });

        return self.drawStand();
      },
      compileFrame:function (data)
      {
        if (arguments.length > 1)
          return _super.compileFrame(arguments[0], arguments[1]);

        var imageBase = 'https://legacy.taorankings.com/units/'+type+'/';
        var frame = new PIXI.Container();
        var sprite;
        var anchor = data.anchor;
        var ishadow = data.shadow;
        var ibase = data.base;
        var icolor = data.color;

        if (ishadow)
        {
          sprite = PIXI.Sprite.fromImage(imageBase+'shadow/image'+ishadow.src+'.png');
          sprite.data = {name: 'shadow'};
          sprite.position = new PIXI.Point(ishadow.x-anchor.x,ishadow.y-anchor.y);
          sprite.scale.x = sprite.scale.y = ishadow.flip ? -1 : 1;
          sprite.alpha = 0.5;
          sprite.inheritTint = false;
        }
        else
        {
          sprite = PIXI.Sprite.fromImage(imageBase+'base/image'+ibase.src+'.png');
          sprite.data = {name: 'base'};
          sprite.position = new PIXI.Point(ibase.x-anchor.x,ibase.y-anchor.y);
        }
        frame.addChild(sprite);

        sprite = PIXI.Sprite.fromImage(imageBase+'base/image'+ibase.src+'.png');
        sprite.data = {name: 'base'};
        sprite.position = new PIXI.Point(ibase.x-anchor.x,ibase.y-anchor.y);
        frame.addChild(sprite);

        sprite = PIXI.Sprite.fromImage(imageBase+'color/image'+icolor.src+'.png');
        sprite.data = {name: 'trim'};
        sprite.position = new PIXI.Point(icolor.x-anchor.x,icolor.y-anchor.y);
        frame.addChild(sprite);

        return frame;
      },
      drawFrame: function (frame) {
        let focus;

        if (self.frame) {
          focus = self.hideFocus();
          pixi.removeChild(self.frame);
        }

        pixi.addChildAt(self.frame = frame,0);
        if (focus)
          self.showFocus(focus.alpha);

        // Reset Normal Appearance
        frame.filters = null;
        frame.tint = 0xFFFFFF;

        frame.children.forEach(sprite => {
          // Apply unit filters to the base and trim sprites.
          if (sprite.data.name === 'base' || sprite.data.name === 'trim')
            sprite.filters = Object.keys(self.filters).map(name => self.filters[name]);

          // Legacy
          if (sprite.data.t)
            sprite.tint = sprite.data.t;
          else if (sprite.data.name === 'trim')
            sprite.tint = self.color;
          else
            sprite.tint = 0xFFFFFF;
        });

        return self;
      },
      drawTurn: function (direction) {
        if (!direction) direction = self.direction;
        if (!isNaN(direction)) direction = board.getRotation(self.direction, direction);

        self.drawFrame(turns[direction]);
      },
      drawStand: function (direction) {
        if (!direction) direction = self.direction;
        if (!isNaN(direction)) direction = board.getRotation(self.direction, direction);

        self.drawFrame(stills[direction]);
      },
      drawAvatar: function () {
        var imageBase = 'https://legacy.taorankings.com/units/'+type+'/';
        var container = new PIXI.Container();
        var sprite;
        var frame = data.stills.S;
        var anchor = frame.anchor;
        var ibase = frame.base;
        var icolor = frame.color;

        container.position = new PIXI.Point(-anchor.x,-anchor.y);

        sprite = PIXI.Sprite.fromImage(imageBase+'base/image'+ibase.src+'.png');
        sprite.position = new PIXI.Point(ibase.x,ibase.y);
        container.addChild(sprite);

        if (frame.color) {
          sprite = PIXI.Sprite.fromImage(imageBase+'color/image'+icolor.src+'.png');
          sprite.position = new PIXI.Point(icolor.x,icolor.y);
          sprite.tint = self.color;
          container.addChild(sprite);
        }

        return container;
      },
      attack: function (action) {
        let anim       = new Tactics.Animation();
        let attackAnim = self.animAttack(action.direction);

        // Animate a target unit's reaction starting with the 4th attack frame.
        action.results.forEach(result => {
          let unit = result.unit;

          if (result.miss === 'blocked')
            attackAnim
              .splice(3, unit.animBlock(self));
          else
            attackAnim
              .splice(3, self.animStrike(unit))
              .splice(4, unit.animStagger(self));
        });

        anim.splice(self.animTurn(action.direction));
        anim.splice(attackAnim);

        return anim.play();
      },
      animMove: function (assignment) {
        var anim = new Tactics.Animation();
        var tiles = board.findPath(self, assignment);
        var origin = self.assignment;

        // Turn 90deg to the right before we start walking in the opposite direction.
        if (board.getRotation(self.direction,180) == board.getDirection(origin,tiles[0]))
        {
          anim.addFrame(function ()
          {
            self.walk(origin,board.getRotation(self.direction,90),-1);
          });
        }

        // Hack until Knight is upgraded to use SWF-exported JSON data.
        self._step_directions = [];

        $.each(tiles, i => {
          var ftile = tiles[i-1] || origin;

          anim.splice(animTravel(ftile, tiles[i], tiles[i+1]));
        });

        return anim;
      },
      animStepBack: function (direction) {
        let sounds = $.extend({}, Tactics.sounds, data.sounds);
        let step   = 7;

        return new Tactics.Animation({frames: [
          {
            script: frame => {
              if (step === 4) sounds.step.play();
              self.walk(self.assignment, direction, step--);
            },
            repeat: 5,
          },
          () => {
            sounds.step.play();
            self.stand(direction, 0.25);
          }
        ]});
      },
      animStepForward: function (direction) {
        let sounds = $.extend({}, Tactics.sounds, data.sounds);
        let step   = 4;

        return new Tactics.Animation({frames: [
          {
            script: frame => {
              if (step === 4) sounds.step.play();
              self.walk(self.assignment, direction, step++);
            },
            repeat: 4,
          },
          () => self.drawStand(),
        ]});
      },
      animAttack: function (direction) {
        let anim   = new Tactics.Animation();
        let sounds = $.extend({}, Tactics.sounds, data.sounds);
        let swing  = 0;

        if (!direction) direction = self.direction;

        anim.addFrames([
          {
            script: function (frame) {
              self.drawFrame(attacks[direction][swing++]);
            },
            repeat: attacks[direction].length
          },
          () => self.stand(direction),
        ]);

        anim.splice(0, () => sounds.attack1.play());
        anim.splice(2, () => sounds.attack2.play());

        return anim;
      },
      animBlock: function (attacker) {
        let sounds    = $.extend({}, Tactics.sounds, data.sounds);
        let direction = board.getDirection(self.assignment, attacker.assignment, self.direction);

        return new Tactics.Animation({frames:
        [
          function ()
          {
            self.direction = direction;
            self.block(0);
            sounds.block.play();
          },
          function ()
          {
            self.block(1).shock(direction,0,1);
          },
          function ()
          {
            self.shock(direction,1,1);
          },
          function ()
          {
            self.shock(direction,2,1);
          },
          function ()
          {
            self.shock();
          },
          function ()
          {
            self.block(0);
          },
          function ()
          {
            self.stand();
          }
        ]});
      },
      animStagger:function (attacker)
      {
        let anim = new Tactics.Animation({fps:12});
        let direction = board.getDirection(attacker.assignment, self.assignment, self.direction);

        anim.addFrames([
          () =>
            self.walk(self.assignment,self.direction,-1,0.06,direction),
          () =>
            self.walk(self.assignment,self.direction,-1,-0.02,direction),
          () =>
            self.stand(),
        ]);

        return anim;
      },
      stand: function (direction, offset) {
        if (!direction) direction = self.direction;
        if (!isNaN(direction)) direction = board.getRotation(self.direction, direction);

        if (self.pixi) {
          let center = self.assignment.getCenter();
          let offsetX;
          let offsetY;

          if (offset) {
            // This will actually offset the unit in the opposite direction.
            if (direction === 'S') {
              offsetX = -88 * offset;
              offsetY = -56 * offset;
            }
            else if (direction === 'N') {
              offsetX =  88 * offset;
              offsetY =  56 * offset;
            }
            else if (direction === 'E') {
              offsetX = -88 * offset;
              offsetY =  56 * offset;
            }
            else {
              offsetX =  88 * offset;
              offsetY = -56 * offset;
            }

            pixi.position.x = center.x + offsetX;
            pixi.position.y = center.y + offsetY;
          }
          else {
            pixi.position = center.clone();
          }

          self.drawStand(direction);
        }

        if (!offset)
          self.direction = direction;

        return self;
      },
      walk: function (target,direction,step,offset,odirection) {
        var pixi = self.pixi;
        var walk = walks[direction];
        var tpoint = target.getCenter();
        var distX,distY;

        while (step < 0) step = walk.length + step;

        // The tile we're coming from may not exist, so calc its center manually.
        if (direction === 'N') {
          distX = 44;
          distY = 28;
        }
        else if (direction === 'E') {
          distX = -44;
          distY = 28;
        }
        else if (direction == 'W') {
          distX = 44;
          distY = -28;
        }
        else {
          distX = -44;
          distY = -28;
        }

        self.drawFrame(walks[direction][step]);
        pixi.position.x = tpoint.x + Math.floor(distX * ((walk.length-step-1) / walk.length));
        pixi.position.y = tpoint.y + Math.floor(distY * ((walk.length-step-1) / walk.length));

        if (offset) {
          offset = {x:Math.round(88 * offset),y:Math.round(56 * offset)};

          // This is the opposite of what you would normally expect.
          if (odirection == 'N') {
            pixi.position.x -= offset.x;
            pixi.position.y -= offset.y;
          }
          else if (odirection == 'E') {
            pixi.position.x += offset.x;
            pixi.position.y -= offset.y;
          }
          else if (odirection == 'W') {
            pixi.position.x -= offset.x;
            pixi.position.y += offset.y;
          }
          else {
            pixi.position.x += offset.x;
            pixi.position.y += offset.y;
          }
        }

        return self;
      },
      block: function (frame) {
        return self.drawFrame(blocks[self.direction][frame]);
      },
    });

    function animTravel(ftile,dtile,ntile) {
      let anim      = new Tactics.Animation();
      let sounds    = $.extend({}, Tactics.sounds, data.sounds);
      let direction = board.getDirection(ftile,dtile);
      let edirection,ddirection;
      let funit,dunit;

      // Add the frames for walking from one tile to the next.
      anim.addFrame({
        script: frame => self.walk(dtile,direction, frame.repeat_index),
        repeat: walks[direction].length,
      });

      anim.splice([0, 4], () => {
        sounds.step.play();
      });

      if (!ntile)
        anim.addFrame(() => self.assign(dtile).stand(direction));

      // Move the unit behind us back into position.
      if ((funit = ftile.assigned) && funit !== self)
        anim.splice(3, funit.animStepForward(self._step_directions.pop()));

      if (dunit = dtile.assigned) {
        // These directions are not available.
        edirection = [direction, board.getDirection(ntile,dtile)];

        // One of these directions are available.  Sorted by preference.
        $.each([
          dunit.direction,
          board.getRotation(dunit.direction,  90),
          board.getRotation(dunit.direction, -90),
        ], (i, direction) => {
          if (edirection.indexOf(direction) === -1) {
            ddirection = direction;
            return false;
          }
        });

        self._step_directions.push(ddirection);
        anim.splice(0, dunit.animStepBack(ddirection));
      }

      return anim;
    }

    return self;
  };

})();
