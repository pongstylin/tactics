(function () {
  'use strict';

  Tactics.units[8].extend = function (self) {
    var _super = Object.assign({}, self);
    var board = Tactics.board;
    var data = Tactics.units[self.type];
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);
    var effects = Object.assign({}, Tactics.effects, data.effects);

    Object.assign(self, {
      getTargetTiles: function () {
        return self.getAttackTiles();
      },
      highlightAttack: function () {
        if (self.viewed)
          _super.highlightAttack();
        else {
          self.targeted = self.getTargetTiles(self.assignment);
          self.targeted.forEach(target => self.highlightTarget(target));
        }

        return self;
      },
      playAttack: function (target, results) {
        let anim      = new Tactics.Animation();
        let direction = board.getDirection(self.assignment, target, self.direction);

        let attackAnim = self.animAttack(target);
        attackAnim.addFrame(() => self.drawFrame(data.stills[direction]));
        attackAnim.splice(0, () => sounds.paralyze.play())

        results.forEach(result => {
          let unit = result.unit;
          if (unit === self) return;

          attackAnim.splice(0, self.animStreaks(unit));
        });

        anim.splice(self.animTurn(direction));
        anim.splice(attackAnim)

        return anim.play();
      },
      calcAttackResults: function (target) {
        let target_units = self.getTargetUnits(target);
        let results = [{
          unit:     self,
          focusing: target_units,
        }];

        target_units.forEach(unit => {
          let result = {unit: unit};
          let paralyzed = unit.paralyzed || [];
          paralyzed.push(self);

          results.push(Object.assign(result, {paralyzed: paralyzed}));
        });

        return results;
      },
      animStreaks: function (target_unit) {
        let anim = new Tactics.Animation();
        let parent = target_unit.frame.parent;
        let lightness = [0.1, 0.2, 0.3, 0.4, 0.3, 0.2, 0.1, 0];
        let frames = data.effects.streaks.frames.map(frame => self.compileFrame(frame, data.effects.streaks));

        let index = 0;
        frames.forEach(frame => {
          anim.splice(index, [
            () => parent.addChild(frame),
            () => parent.removeChild(frame),
          ]);

          index++;
        });

        anim.splice(4, {
          script: () => target_unit.colorize(0xFFFFFF, lightness.shift()),
          repeat: lightness.length,
        });

        return anim;
      },
      animBreakFocus: function () {
        let anim = new Tactics.Animation();
        let units = [self, ...self.focusing];

        units.forEach(u => {
          if (u === self) {
            if (!u.paralyzed && !u.poisoned)
              anim.splice(0, u.animDefocus());

            anim.splice(-1, () => u.change({focusing: false}));
          }
          else {
            if (u.paralyzed.length === 1 && !u.poisoned)
              anim.splice(0, u.animDefocus());

            if (u.paralyzed.length === 1)
              anim.splice(-1, () => u.change({paralyzed: false}));
            else
              anim.splice(-1, () => u.change({paralyzed: u.paralyzed.filter(u => u !== self)}));
          }
        });

        return anim;
      },
      reset: function () {
        var origin = self.origin;

        if (self.deployed || self.turned) {
          self.assign(origin.tile).turn(origin.direction);
          self.deployed = false;
          self.turned = false;

          if (origin.focusing) {
            self
              .showFocus(0.5)
              .change({focusing: origin.focusing});

            self.focusing.forEach(unit => {
              let paralyzed = unit.paralyzed || [];
              paralyzed.push(self);

              unit
                .showFocus(0.5)
                .change({paralyzed: paralyzed});
            });
          }
        }

        return self.deactivate();
      },
    });

    return self;
  };

})();
