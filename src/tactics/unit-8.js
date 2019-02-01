(function () {
  'use strict';

  Tactics.units[8].extend = function (self) {
    var _super = Object.assign({}, self);
    var board = Tactics.board;
    var data = Tactics.units[self.type];
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);
    var effects = Object.assign({}, Tactics.effects, data.effects);

    Object.assign(self, {
      playAttack: function (target, results) {
        let anim      = new Tactics.Animation();
        let direction = board.getDirection(self.assignment, target, self.direction);

        let attackAnim = self.animAttack(target);
        attackAnim.splice(0, () => sounds.paralyze.play())

        results.forEach(result => {
          let unit = result.unit.assigned;
          if (unit === self) return;

          attackAnim.splice(0, self.animStreaks(unit));
        });

        anim.splice(self.animTurn(direction));
        anim.splice(attackAnim);

        return anim.play();
      },
      getBreakFocusResults: function () {
        return [
          {
            unit: self.assignment,
            changes: {
              focusing: false,
            },
            results: [
              ...self.focusing.map(tile => ({
                unit: tile,
                changes: {
                  paralyzed: false,
                },
              })),
            ],
          },
        ];
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
    });

    return self;
  };

})();
