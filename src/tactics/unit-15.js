(function () {
  Tactics.units[15].extend = function (self) {
    var data   = Tactics.units[self.type];
    var sounds = $.extend({},Tactics.sounds,data.sounds);
    var game   = Tactics.game;
    var stage  = game.stage;
    var board  = game.board;

    $.extend(self, {
      title: '...sleeps...',

      phase: function () {
        let teamsData = game.getWinningTeams().reverse();
        let colorId = null;

        if (teamsData.length)
          colorId = game.teams[teamsData[0].id].colorId;

        if (colorId === self.team.colorId)
          return Promise.resolve();

        return self.animPhase(colorId).play();
      },
      animPhase: function (colorId) {
        let old_color = self.color;
        let new_color = colorId === null ? 0xFFFFFF : Tactics.colors[colorId];

        return new Tactics.Animation({frames: [
          () => {
            sounds.phase.play();
            self.team.colorId = colorId;
            self.color = new_color;
          },
          {
            script: frame => {
              let step = frame.repeat_index + 1;
              self.frame.children[2].tint = Tactics.utils.getColorStop(old_color, new_color, step / 12);
            },
            repeat: 12,
          }
        ]});
      },
      getCounterAction: function (attacker, result) {
        if (result.miss) {
          // Blocked
          let units;
          if (attacker.color === self.color)
            units = attacker.team.units;
          else {
            units = board.teamsUnits.find((units, teamId) =>
              teamId !== self.team.id && units.length && units[0].color === self.color
            );

            if (!units) return;
          }

          let target_units = units.filter(unit => unit.mHealth < 0);
          if (!target_units.length) return;

          let target_unit = target_units.random();

          return {
            type: 'heal',
            unit: self.assignment,
            tile: target_unit.assignment,
            results: [{
              unit:    target_unit.assignment,
              notice:  'Nice',
              changes: { mHealth:Math.min(0, target_unit.mHealth + self.power) },
            }],
          };
        }
        else if (result.changes && 'mHealth' in result.changes) {
          if (result.changes.mHealth > -self.health) {
            // Cracked
            let units;
            if (attacker.color === self.color) {
              let teamsData = game.getWinningTeams()
                // Don't count the team that just attacked.
                .filter(teamData => teamData.id !== attacker.team.id);
              let choices = teamsData
                .filter(teamData => teamData.score === teamsData[0].score);

              units = game.teams[choices.random().id].units;
            }
            else
              units = attacker.team.units;

            let target_unit = units.random();
            let power       = self.power + self.mPower;
            let armor       = target_unit.armor + target_unit.mArmor;
            let mHealth     = target_unit.mHealth - Math.round(power * (1 - armor / 100));

            return {
              type: 'attack',
              unit: self.assignment,
              tile: target_unit.assignment,
              results: [{
                unit:    target_unit.assignment,
                changes: { mHealth:Math.max(-target_unit.health, mHealth) },
              }],
            };
          }
          else {
            // Hatched
            return {
              type:    'hatch',
              unit:    self.assignment,
              tile:    attacker.assignment,
              results: [{
                unit:    attacker.assignment,
                changes: { mHealth: -attacker.health },
              }],
            };
          }
        }
      },
      attack: function (action) {
        let anim  = new Tactics.Animation();
        let winds = ['wind1','wind2','wind3','wind4','wind5'].shuffle();
        let target_unit = action.tile.assigned;

        anim
          .addFrames([
            { // 0 - 12
              script: frame => {
                let step = frame.repeat_index + 1;
                self.brightness(1 + (step * 0.2));
                self.frame.tint = Tactics.utils.getColorStop(0xFFFFFF, self.color, step / 12);

                // Shadow
                self.frame.children[0].scale.x     = 1 - (step * 0.025);
                self.frame.children[0].scale.y     = 1 - (step * 0.025);
                self.frame.children[0].position.x += 0.3;
                self.frame.children[0].position.y += 0.2;

                // Base
                self.frame.children[1].position.y -= 3;

                // Trim
                self.frame.children[2].position.y -= 3;
              },
              repeat: 12,
            },
            { // 12 - 18
              script: frame => {
                let step = 11 - frame.repeat_index;
                self.brightness(1 + (step * 0.2));
              },
              repeat: 6,
            },
            { // 18 - 24
              script: frame => {
                let step = 7 + frame.repeat_index;
                self.brightness(1 + (step * 0.2), (step - 6) * 0.6);
              },
              repeat: 6,
            }
          ])
          // Lightning strike started 2 frames earlier
          .addFrames([
            { // 24 - 30
              script: frame => {
                let step = 11 - frame.repeat_index;
                self.brightness(1 + (step * 0.2), (step - 6) * 0.6);
              },
              repeat: 6,
            },
            { // 30 - 36
              script: frame => {
                let step = 7 + frame.repeat_index;
                self.brightness(1 + (step * 0.2));
              },
              repeat: 6,
            },
            { // 36 - 48
              script: frame => {
                let step = 11 - frame.repeat_index;
                self.brightness(1 + (step * 0.2));
                self.frame.tint = Tactics.utils.getColorStop(0xFFFFFF, self.color, step / 12);

                // Shadow
                self.frame.children[0].scale.x = 1 - (step * 0.025);
                self.frame.children[0].scale.y = 1 - (step * 0.025);
                self.frame.children[0].position.x -= 0.3;
                self.frame.children[0].position.y -= 0.2;

                // Base
                self.frame.children[1].position.y += 3;

                // Trim
                self.frame.children[2].position.y += 3;
              },
              repeat: 12,
            },
          ])
          .splice( 0, () => sounds.wind.fade(0, 0.25, 500, sounds.wind.play(winds.shift())))
          .splice( 4, () => sounds.wind.play(winds.shift()))
          .splice( 8, () => sounds.wind.play(winds.shift()))
          .splice(12, () => sounds.roar.play('roar'))
          .splice(16, () => sounds.wind.play(winds.shift()))
          .splice(20, () => sounds.wind.fade(1, 0, 1700, sounds.wind.play(winds.shift())))
          .splice(22, self.animLightning(target_unit.assignment));
        
        return anim.play();
      },
      heal: function (action) {
        let anim        = new Tactics.Animation();
        let target_unit = action.tile.assigned;
        let pixi        = self.pixi;
        let filter      = new PIXI.filters.ColorMatrixFilter();
        pixi.filters = [filter];

        anim
          .addFrame({
            script: frame => {
              let step = 1 + frame.repeat_index;

              filter.brightness(1 + (step * 0.2));
              self.frame.children[1].tint = Tactics.utils.getColorStop(0xFFFFFF, self.color, step / 12);

              if (step === 8) sounds.heal.play();
            },
            repeat: 12,
          })
          .splice(self.animHeal(target_unit))
          .addFrame({
            script: frame => {
              let step = 11 - frame.repeat_index;

              filter.brightness(1 + (step * 0.2));
              self.frame.children[1].tint = Tactics.utils.getColorStop(0xFFFFFF, self.color, step / 12);

              if (step === 0) pixi.filters = null;
            },
            repeat: 12,
          });

        return anim.play();
      },
      animStagger: function (attacker) {
        let anim      = new Tactics.Animation();
        let direction = board.getDirection(attacker.assignment, self.assignment, self.direction);

        anim.addFrames([
          () => sounds.crack.play(),
          () => self.offsetFrame(0.06,  direction),
          () => self.offsetFrame(-0.06, direction),
          () => self.offsetFrame(-0.06, direction),
          () => self.offsetFrame(0.06,  direction),
        ]);

        return anim;
      },
      animBlock: function (attacker) {
        let direction = board.getDirection(self.assignment, attacker.assignment, self.direction);

        return new Tactics.Animation({frames: [
          () => 
            self.direction = direction,
          () => {
            sounds.block.play();
            self.shock(direction, 0);
          },
          () =>
            self.shock(direction, 1),
          () =>
            self.shock(direction, 2),
          () =>
            self.shock(),
        ]});
      },
      hatch: function (action) {
        let anim        = new Tactics.Animation();
        let assignment  = self.assignment;
        let direction   = board.getDirection(assignment, action.tile);
        let target_unit = action.tile.assigned;
        let frames      = target_unit.walks[direction];
        let step        = 0;
        let step2       = 0;
        let myPos       = assignment.getCenter();
        let pos         = target_unit.pixi.position.clone();
        let caption;
        let dragon;
        let hatch       = Tactics.units[22].animations[direction].hatch;
        let team        = self.team;
        let tint        = self.color;
        let death       = new PIXI.Container();
        let winds       = ['wind1','wind2','wind3','wind4','wind5'];

        if (direction === 'S')
          caption = {x:9};
        else if (direction === 'N')
          caption = {y:-9, x:-9};
        else if (direction === 'E')
          caption = {y:-9, x:9};
        else
          caption = {x:-9};

        anim
          .splice({ // 0
            script: () => {
              if (step === 0) sounds.phase.play();
              self.whiten(++step / 12);
              self.frame.children[2].tint = Tactics.utils.getColorStop(tint, 0xFFFFFF, step / 12);
            },
            repeat: 12,
          })
          .splice({ // 12
            script: () =>
              self.whiten(--step / 12),
            repeat: 12,
          })
          .splice({ // 24
            script: () => {
              if (step === 0) sounds.phase.play();
              self.alpha = 1 - (++step / 12);
            },
            repeat: 12,
          })
          .splice(36, () => {
            board
              .dropUnit(self)
              .addUnit({
                type:      'ChaosDragon',
                tile:      assignment,
                direction: direction,
              }, self.team);

            dragon = team.units[0];
            dragon.color = 0xFFFFFF;
            dragon.drawFrame(hatch.s);
          })
          .splice(36, {
            script: () => dragon.frame.alpha = 1 - (--step / 12),
            repeat: 12
          })
          .splice(22, target_unit.animTurn(direction))
          .splice(24, {
            script: () => {
              let offset = ((step2 / (frames.length*3)) * 0.45) + 0.12;
              offset = new PIXI.Point(Math.round(88*offset),Math.round(56*offset));

              if ((step2 % frames.length) === 0 || (step2 % frames.length) === 4)
                Tactics.units[0].sounds.step.play();

              target_unit.drawFrame(frames[step2++ % frames.length]);

              // Opposite of what you expect since we're going backwards.
              if (direction === 'S') {
                target_unit.pixi.position.x = pos.x - offset.x;
                target_unit.pixi.position.y = pos.y - offset.y;
              }
              else if (direction === 'N') {
                target_unit.pixi.position.x = pos.x + offset.x;
                target_unit.pixi.position.y = pos.y + offset.y;
              }
              else if (direction === 'E') {
                target_unit.pixi.position.x = pos.x - offset.x;
                target_unit.pixi.position.y = pos.y + offset.y;
              }
              else {
                target_unit.pixi.position.x = pos.x + offset.x;
                target_unit.pixi.position.y = pos.y - offset.y;
              }
            },
            repeat: frames.length*3,
          })
          .splice(22, target_unit.animCaption('Ugh!',caption))
          .splice(() => { // 48
            // Change the mHealth so bots know not to move or turn after dying.
            target_unit.mHealth = -target_unit.health;
            board.dropUnit(target_unit);
          })
          .splice({ // 49
            script: function () {
              if (step === 0) sounds.phase.play();
              dragon.whiten(++step / 12);
              if (step < 7) dragon.alpha = step / 6;
            },
            repeat: 12,
          })
          .splice({ // 61
            script: () => {
              dragon.whiten(--step / 12);
            },
            repeat: 12
          })
          .splice({ // 73
            script:function ()
            {
              dragon.drawFrame(hatch.s + ++step);
            },
            repeat:hatch.l-3
          })
          .splice({ // 78
            script: frame => {
              let step = 11 - frame.repeat_index;
              dragon.frame.children[2].tint = Tactics.utils.getColorStop(tint, 0xFFFFFF, step / 12);
            },
            repeat: 12,
          })
          .splice({
            script: () => {
              dragon.color = tint;
              dragon.drawFrame(hatch.s + ++step);
            },
            repeat: 2,
          });

        // Layer in the cloud
        anim.splice( 0, () => self.pixi.addChild(death));
        anim.splice(36, () => dragon.pixi.addChild(death));
        anim.splice(51, () => dragon.pixi.removeChild(death));

        for (let i = 0; i < anim.frames.length; i++) {
          if (i === 51) break;

          let po = Math.min(1, Math.max(0.05, i / anim.frames.length) + 0.05);
          let ao = 0.5;

          if (i  <  20)
            ao  = (i +  1) * 0.025;
          else if (i > 40)
            ao -= (i - 40) * 0.05;

          [1, -1].forEach(xm => {
            [1, -1].forEach(ym => {
              let x = myPos.x + Math.round(Math.random() * 44 * po) * xm;
              let y = myPos.y + Math.round(Math.random() * 28 * po) * ym + 28;

              anim.splice(i, new Tactics.Animation.fromData(
                stage.children[1],
                Tactics.animations.death,
                {x:x, y:y, s:2, a:ao},
              ));
            });
          });
        }

        for (let i = 0; i < anim.frames.length; i++) {
          if (i  %   4) continue;
          if (i === 84) break;

          if (i === 0)
            anim.splice(i, () => sounds.wind.fade(0, 0.25, 500, sounds.wind.play(winds.random())));
          else if (i === 76)
            anim.splice(i, () => sounds.roar.play('roar'));
          else
            anim.splice(i, () => sounds.wind.play(winds.random()));
        }

        return anim.play();
      },
      canCounter: function () {
        return true;
      },
    });

    return self;
  };
})();
