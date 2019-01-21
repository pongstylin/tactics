(function () {
  Tactics.units[22].extend = function (self) {
    var data = Tactics.units[self.type];
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);
    var board = Tactics.board;

    data.frames.forEach((frame, i) => {
      if (!frame) return;
      let names = ['shadow', 'base', 'trim'];

      frame.c.forEach(shape => {
        if (names.length && shape.id !== 56)
          shape.n = names.shift();
      });
    });

    $.extend(self, {
      title:  'Awakened!',
      banned: [],

      getAttackResults: function (target) {
        let results = [];

        if (target === self.assignment)
          results.push({
            unit: self.assignment,
            changes: {
              mHealth: Math.min(0, self.mHealth + self.power),
            },
          });
        else if (target.assigned) {
          let direction = board.getDirection(self.assignment, target, self.direction);
          if (direction !== self.direction)
            results.push({
              unit: self.assignment,
              changes: {
                direction: board.getDirection(self.assignment, target, self.direction),
              },
            });

          let unit = target.assigned;
          let calc = self.calcAttack(unit);
          results.push({
            unit: target,
            changes: {
              mHealth: Math.max(unit.mHealth - calc.damage, -unit.health),
            },
          });
        }

        return results;
      },
      playAttack: function (target, results) {
        let anim      = new Tactics.Animation({fps:10});
        let direction = board.getDirection(self.assignment, target);

        if (target === self.assignment)
          return self.special();

        // Make sure we strike the actual target (LOS can change it).
        let target_unit = self.getTargetUnits(target)[0];
        if (target_unit)
          target = target_unit.assignment;

        anim
          .splice(self.animTurn(direction))
          .splice(self.animAttack(target));

        return anim.play();
      },
      special: function () {
        let anim  = new Tactics.Animation();
        let block = data.animations[self.direction].block;

        anim
          .splice([
            () => self.drawFrame(block.s),
            () => self.drawFrame(block.s+1),
            () => {},
          ])
          .splice(self.animHeal([self]))
          .splice([
            () => self.drawFrame(block.s+4),
            () => self.drawFrame(block.s+5),
          ]);

        return anim.play();
      },
      phase: function (action) {
        let banned   = action ? action.results[0].banned : self.banned;
        let color_id = null;
        let teams    = board.getWinningTeams().reverse().filter((team, t) =>
          banned.indexOf(t) === -1 && t !== self.team
        );

        if (teams.length > 1) {
          let choices  = teams.filter(team => {
            if (team.units.length === 0) return false;

            return team.score === teams[0].score;
          });

          if (choices.length)
            color_id = choices.random().color;
        }

        if (color_id === board.teams[self.team].color)
          return Promise.resolve();

        return self.animPhase(color_id).play();
      },
      animPhase: function (color_id) {
        let old_color = self.color;
        let new_color = color_id === null ? 0xFFFFFF : Tactics.colors[color_id];

        return new Tactics.Animation({frames: [
          () => {
            sounds.phase.play();
            board.teams[self.team].color = color_id;
            self.color = new_color;
          },
          {
            script: frame => {
              self.frame.children[2].tint =
                Tactics.utils.getColorStop(old_color, new_color, (11 - frame.repeat_index) / 12);
            },
            repeat: 12,
          }
        ]});
      },
      animMove: function (assignment) {
        let anim        = new Tactics.Animation({fps:10});
        let frame_index = 0;

        anim.addFrame(() => self.assignment.dismiss());

        // Turn frames are not typically required while walking unless the very
        // next tile is in the opposite direction of where the unit is facing.
        let direction = board.getDirection(self.assignment, assignment, self.direction);
        if (direction === board.getRotation(self.direction, 180))
          anim.splice(frame_index++, () => self.drawTurn(90));

        let move = data.animations[direction].move;
        anim
          .splice(frame_index,
            new Tactics.Animation({frames: [{
              script: frame => self.drawFrame(move.s + frame.repeat_index),
              repeat: move.l,
            }]})
              .splice(10, () => self.assign(assignment))
              .splice([2,7,11,16], () => sounds.flap.play())
          );
        anim.addFrame(() => self.stand(direction));

        return anim;
      },
      animAttack: function (target) {
        var anim      = new Tactics.Animation();
        var tunit     = target.assigned;
        var direction = board.getDirection(self.assignment, target, 1);
        var attack    = data.animations[direction].attack, frame=0;
        var whiten    = [0.25, 0.5, 0];
        var source    = direction === 'N' || direction === 'E' ?  1 : 3;
        var adjust    = direction === 'N' ? {x:-5,y:0} : direction === 'W' ? {x:-5,y:3} : {x:5,y:3};
        var container = new PIXI.Container();
        var filter1   = new PIXI.filters.BlurFilter();
        var filter2   = new PIXI.filters.BlurFilter();
        var streaks1  = new PIXI.Graphics;
        var streaks2  = new PIXI.Graphics;
        var streaks3  = new PIXI.Graphics;

        //filter1.blur = 6;
        streaks1.filters = [filter1];
        container.addChild(streaks1);

        filter2.blur = 6;
        streaks2.filters = [filter2];
        container.addChild(streaks2);

        streaks3.filters = [filter2];
        container.addChild(streaks3);

        anim
          .addFrame({
            script: () => self.drawFrame(attack.s + frame++),
            repeat: attack.l,
          })
          .splice(0, () => sounds.charge.play().fade(0,1,500))
          .splice(5, tunit.animStagger(self))
          .splice(5, () => {
            sounds.buzz.play();
            sounds.charge.stop();
            sounds.impact.play();
          })
          .splice(5, {
            script: () => tunit.whiten(whiten.shift()),
            repeat:3
          })
          .splice(5, () => {
            self.drawStreaks(container,target,source,adjust);
            Tactics.stage.addChild(container);
          })
          .splice(6, () => {
            self.drawStreaks(container,target,source,adjust);
          })
          .splice(7, () => {
            Tactics.stage.removeChild(container);
            sounds.buzz.stop();
          });

        return anim;
      },
      drawStreaks: function (container,target,source,adjust) {
        // Make sure bounds are set correctly.
        Tactics.stage.children[1].updateTransform();

        let sprite = self.frame.children[source];
        let bounds = sprite.getBounds();
        let start  = new PIXI.Point(bounds.x+adjust.x,bounds.y+adjust.y);
        let end    = target.getCenter().clone();

        start.x += Math.floor(sprite.width  / 2);
        start.y += Math.floor(sprite.height / 2);
        end.y   -= 14;

        // Determine the stops the lightning will make.
        let stops = [
          {
            x: start.x + Math.floor((end.x - start.x) * 1/3),
            y: start.y + Math.floor((end.y - start.y) * 1/3),
          },
          {
            x: start.x + Math.floor((end.x - start.x) * 2/3),
            y: start.y + Math.floor((end.y - start.y) * 2/3),
          },
          {x:end.x, y:end.y},
        ];

        let streaks1 = container.children[0];
        let streaks2 = container.children[1];
        let streaks3 = container.children[2];

        streaks1.clear();
        streaks2.clear();
        streaks3.clear();

        for (let i=0; i<3; i++) {
          let alpha     = i % 2 === 0 ? 0.5 : 1;
          let deviation = alpha === 1 ? 9 : 19;
          let midpoint  = (deviation + 1) / 2;

          streaks1.lineStyle(1, 0x8888FF, alpha);
          streaks2.lineStyle(2, 0xFFFFFF, alpha);
          streaks3.lineStyle(2, 0xFFFFFF, alpha);

          streaks1.moveTo(start.x, start.y);
          streaks2.moveTo(start.x, start.y);
          streaks3.moveTo(start.x, start.y);

          stops.forEach((stop, j) => {
            let offset;
            let x = stop.x;
            let y = stop.y;

            if (j < 2) {
              // Now add a random offset to the stops.
              offset = Math.floor(Math.random() * deviation) + 1;
              if (offset > midpoint) offset = (offset-midpoint) * -1;
              x += offset;

              offset = Math.floor(Math.random() * deviation) + 1;
              if (offset > midpoint) offset = (offset-midpoint) * -1;
              y += offset;
            }

            streaks1.lineTo(x, y);
            streaks2.lineTo(x, y);
            streaks3.lineTo(x, y);
          });
        }

        return self;
      },
      animBlock: function (attacker) {
        let anim      = new Tactics.Animation();
        let direction = board.getDirection(self.assignment, attacker.assignment, self.direction);
        let block     = data.animations[direction].block;

        anim
          .addFrames([
            () => self.direction = direction,
            () => sounds.block.play(),
          ])
          .splice(0, {
            script: frame => self.drawFrame(block.s + frame.repeat_index),
            repeat: block.l,
          })
          .splice(1, [
            {
              script: frame => self.shock(direction, frame.repeat_index, 1),
              repeat: 3,
            },
            () => self.shock(),
          ]);

        return anim;
      },
      canCounter: function () {
        return true;
      },
      getCounterAction: function (attacker, result) {
        if (attacker.color === self.color)
          return {
            type:    'phase',
            unit:    self.assignment,
            tile:    self.assignment,
            results: [{
              unit:   self.assignment,
              banned: [...self.banned, attacker.team],
            }],
          };
      },
    });

    return self;
  };
})();
