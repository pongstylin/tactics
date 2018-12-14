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

        return anim.play().then(() => 'ready');
      },
      calcAttack: function () {
        return {
          damage:      0,
          block:       0,
          chance:      100,
          penalty:     0,
          bonus:       0,
          unblockable: true,
          effect:      'paralyze',
        };
      },
      calcAttackResults: function (target) {
        let target_units = self.getTargetUnits(target);
        let results = [{
          unit:     self,
          focusing: target_units,
        }];

        target_units.forEach(unit => {
          let result = {unit: unit};
          let paralyzed = (unit.paralyzed || []).slice();
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
      playBreakFocus: function () {
        if (!self.focusing) return Promise.resolve();

        if (self.attacked)
          // Do not break focus when turning after attacking.
          if (self.activated === 'turn')
            return Promise.resolve();
          // Allow cancelling the attack by moving after attacking.
          else // self.activated === 'move'
            self.attacked = false;

        let anim = new Tactics.Animation();
        anim.splice( 0, self.animDefocus());
        anim.splice(-1, () => self.change({focusing: false}));

        self.focusing.forEach(unit => {
          if (unit.paralyzed.length === 1 && !unit.poisoned)
            anim.splice(0, unit.animDefocus());

          if (unit.paralyzed.length === 1)
            anim.splice(-1, () => unit.change({paralyzed: false}));
          else
            anim.splice(-1, () => unit.change({paralyzed: unit.paralyzed.filter(u => u !== self)}));
        });

        return anim.play();
      },
      reset: function (mode) {
        let origin = self.origin;
        let refocus = origin.focusing && !self.attacked && (self.deployed || self.turned);

        _super.reset(mode);

        if (refocus) {
          self.origin.focusing = origin.focusing;
          self
            .showFocus(0.5)
            .change({focusing: origin.focusing});

          self.focusing.forEach(unit => {
            let paralyzed = (unit.paralyzed || []).slice();
            paralyzed.push(self);

            unit
              .showFocus(0.5)
              .change({paralyzed: paralyzed});
          });
        }

        return self;
      },
    });

    return self;
  };

})();
