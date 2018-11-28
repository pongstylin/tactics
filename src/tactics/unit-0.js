(function ()
{
  Tactics.units[0].extend = function (self)
  {
    var data = Tactics.units[self.type];
    var sounds = $.extend({},Tactics.sounds,data.sounds);
    var board = Tactics.board;
    var pixi = self.pixi;
    var type = self.type;
    var stills = {};
    var walks = {};
    var attacks = {};
    var blocks = {};
    var turns = {};

    $.extend(self,
    {
      draw:function (direction,assignment)
      {
        self.color = Tactics.colors[board.teams[self.team].color];

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

        self.assign(assignment);
        self.origin = {tile:assignment,direction:direction};
        self.direction = direction;

        return self.drawFrame(stills[self.directional === false ? 'S' : direction]);
      },
      compileFrame:function (data)
      {
        var imageBase = 'http://www.taorankings.com/html5/units/'+type+'/';
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
      drawFrame:function (frame)
      {
        if (self.frame) pixi.removeChild(self.frame);
        pixi.addChildAt(self.frame = frame,0);

        // Reset Normal Appearance
        frame.filters = null;
        frame.tint = 0xFFFFFF;
        frame.children[0].filters = null;
        frame.children[0].tint = 0xFFFFFF;
        frame.children[1].filters = null;
        frame.children[1].tint = 0xFFFFFF;
        frame.children[2].filters = null;
        frame.children[2].tint = self.color;

        self.filters = {};

        return self;
      },
      drawTurn: function () {
        self.drawFrame(turns[self.direction]);
      },
      drawStand: function () {
        self.drawFrame(stills[self.direction]);
      },
      drawAvatar:function ()
      {
        var imageBase = 'http://www.taorankings.com/html5/units/'+type+'/';
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

        if (frame.color)
        {
          sprite = PIXI.Sprite.fromImage(imageBase+'color/image'+icolor.src+'.png');
          sprite.position = new PIXI.Point(icolor.x,icolor.y);
          sprite.tint = self.color;
          container.addChild(sprite);
        }

        return container;
      },
      attack:function (target) {
        let anim = new Tactics.Animation({fps:12});
        let direction = board.getDirection(self.assignment,target);
        let target_unit = target.assigned;
        let results = [];

        let attackAnim = self.animAttack(direction);

        if (target_unit) {
          results = self.calcAttackResults(target_unit);

          // Animate the target unit's reaction starting with the 4th attack frame.
          if (results[0].blocked) {
            attackAnim
              .splice(3, target_unit.animBlock(self));
          }
          else {
            attackAnim
              .splice(3, self.animStrike(target_unit))
              .splice(4, target_unit.animStagger(self));
          }
        }

        anim.splice(self.animTurn(direction));
        anim.splice(attackAnim);

        return anim.play().then(() => results);
      },
      animTurn:function (direction)
      {
        var anim = new Tactics.Animation();

        if (direction === self.direction) return;

        if (direction === board.getRotation(self.direction,180))
        {
          anim.splice
          ([
            function ()
            {
              self.walk(self.assignment,board.getRotation(self.direction,90),-1);
            },
            function ()
            {
              self.drawFrame(stills[direction]);
              self.direction = direction;
            }
          ]);
        }
        else
        {
          anim.splice(function ()
          {
            self.drawFrame(stills[direction]);
            self.direction = direction;
          });
        }

        return anim;
      },
      animDeploy:function (assignment)
      {
        var anim = new Tactics.Animation({fps:12});
        var tiles = self.findPath(assignment);
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

        $.each(tiles,function (i)
        {
          var ftile = tiles[i-1] || origin;

          anim.splice(animTravel(ftile,tiles[i],tiles[i+1]));
        });

        return anim;
      },
      animStepBack:function (direction)
      {
        var step = 7;

        return new Tactics.Animation({frames:
        [
          {
            script:function (frame)
            {
              if (step === 4) sounds.step.play();
              self.walk(self.assignment,direction,step--);
            },
            repeat:5,
          },
          function (frame)
          {
            sounds.step.play();
            self.stand(direction,0.25);
          }
        ]});
      },
      animStepForward:function ()
      {
        var step = 4;

        return new Tactics.Animation({frames:
        [
          {
            script:function (frame)
            {
              if (step === 4) sounds.step.play();
              self.walk(self.assignment,self._direction,step++);
            },
            repeat:4
          },
          function (frame)
          {
            self.stand();
          }
        ]});
      },
      animAttack: function (direction) {
        var anim = new Tactics.Animation();
        var swing = 0;

        anim.addFrames([
          {
            script: function (frame) {
              self.drawFrame(attacks[direction][swing++]);
            },
            repeat: attacks[direction].length
          },
          () => self.stand(),
        ]);

        anim.splice(0, () => sounds.attack1.play());
        anim.splice(2, () => sounds.attack2.play());

        return anim;
      },
      animBlock: function (attacker) {
        let direction = board.getDirection(self.assignment, attacker.assignment, self.direction);

        return new Tactics.Animation({frames:
        [
          function ()
          {
            self.origin.direction = self.direction = direction;
            self.block(0);
          },
          function ()
          {
            sounds.block.play();
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
      stand:function (direction,offset)
      {
        var center = self.assignment.getCenter();
        var offsetX,offsetY;

        direction = direction || self.direction;

        if (offset)
        {
          // This will actually offset the unit in the opposite direction.
          if (direction === 'S')
          {
            offsetX = -88 * offset;
            offsetY = -56 * offset;
          }
          else if (direction === 'N')
          {
            offsetX =  88 * offset;
            offsetY =  56 * offset;
          }
          else if (direction === 'E')
          {
            offsetX = -88 * offset;
            offsetY =  56 * offset;
          }
          else
          {
            offsetX =  88 * offset;
            offsetY = -56 * offset;
          }

          pixi.position.x = center.x + offsetX;
          pixi.position.y = center.y + offsetY;
        }
        else
        {
          pixi.position = center.clone();
        }

        self.drawFrame(stills[direction]);

        // The visual direction as opposed to the deployed direction.
        self._direction = direction;
        return self;
      },
      walk:function (target,direction,step,offset,odirection)
      {
        var pixi = self.pixi;
        var walk = walks[direction];
        var tpoint = target.getCenter();
        var distX,distY;

        while (step < 0) step = walk.length + step;

        // The tile we're coming from may not exist, so calc its center manually.
        if (direction === 'N')
        {
          distX = 44;
          distY = 28;
        }
        else if (direction === 'E')
        {
          distX = -44;
          distY = 28;
        }
        else if (direction == 'W')
        {
          distX = 44;
          distY = -28;
        }
        else
        {
          distX = -44;
          distY = -28;
        }

        self.drawFrame(walks[direction][step]);
        pixi.position.x = tpoint.x + Math.floor(distX * ((walk.length-step-1) / walk.length));
        pixi.position.y = tpoint.y + Math.floor(distY * ((walk.length-step-1) / walk.length));

        if (offset)
        {
          offset = {x:Math.round(88 * offset),y:Math.round(56 * offset)};

          // This is the opposite of what you would normally expect.
          if (odirection == 'N')
          {
            pixi.position.x -= offset.x;
            pixi.position.y -= offset.y;
          }
          else if (odirection == 'E')
          {
            pixi.position.x += offset.x;
            pixi.position.y -= offset.y;
          }
          else if (odirection == 'W')
          {
            pixi.position.x -= offset.x;
            pixi.position.y += offset.y;
          }
          else
          {
            pixi.position.x += offset.x;
            pixi.position.y += offset.y;
          }
        }

        // The visual direction as opposed to the deployed direction.
        self._direction = direction;
        return self;
      },
      block:function (frame)
      {
        return self.drawFrame(blocks[self.direction][frame]);
      },
      turn:function (direction)
      {
        if (self.directional === false) return;

        if (!isNaN(direction)) direction = board.getRotation(self.direction,direction);
        self.direction = direction;

        self.drawFrame(stills[direction]);

        Tactics.render();

        return self;
      }
    });

    function animTravel(ftile,dtile,ntile)
    {
      var anim = new Tactics.Animation();
      var direction = board.getDirection(ftile,dtile);
      var edirection,ddirection;
      var funit,dunit;
      var step = 0;

      // Add the frames for walking from one tile to the next.
      anim.addFrame
      ({
        script:function (frame)
        {
          self.walk(dtile,direction,step++);
        },
        repeat:walks[direction].length
      });

      anim.splice([0,4],function ()
      {
        sounds.step.play();
      });

      if (!ntile)
        anim.addFrame(() => self.assign(dtile).turn(direction));

      // Move the unit behind us back into position.
      if ((funit = ftile.assigned) && funit !== self)
      {
        anim.splice(3,funit.animStepForward(self._step_directions.pop()));
      }

      if (dunit = dtile.assigned)
      {
        // These directions are not available.
        edirection = [direction,board.getDirection(ntile,dtile)];

        // One of these directions are available.  Sorted by preference.
        $.each
        ([
          dunit.direction,
          board.getRotation(dunit.direction,90),
          board.getRotation(dunit.direction,270)
        ],function (i,direction)
        {
          if (edirection.indexOf(direction) === -1)
          {
            ddirection = direction;
            return false;
          }
        });

        self._step_directions.push(ddirection);
        anim.splice(0,dunit.animStepBack(ddirection));
      }

      return anim;
    }

    return self;
  };

})();
