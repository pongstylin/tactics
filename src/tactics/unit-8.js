(function () {
  'use strict';

  Tactics.units[8].extend = function (self, data, board) {
    var _super = Object.assign({}, self);

    Object.assign(self, {
      attack: function (action) {
        let anim   = new Tactics.Animation();
        let sounds = Object.assign({}, Tactics.sounds, data.sounds);

        let attackAnim = self.animAttack(action.direction);
        attackAnim.splice(0, () => sounds.paralyze.play())

        action.results.forEach(result => {
          let unit = result.unit;

          attackAnim.splice(0, self.animStreaks(unit));
        });

        anim.splice(self.animTurn(action.direction));
        anim.splice(attackAnim);

        return anim.play();
      },
      getBreakFocusResults: function () {
        return [
          {
            unit: self,
            changes: {
              focusing: false,
            },
            results: [
              ...self.focusing.map(tUnit => ({
                unit: tUnit,
                changes: {
                  paralyzed: tUnit.paralyzed.length === 1
                    ? false
                    : tUnit.paralyzed.filter(t => t !== self),
                },
              })),
            ],
          },
        ];
      },
      animStreaks: function (target_unit) {
        let anim = new Tactics.Animation();
        let effects = Object.assign({}, Tactics.effects, data.effects);
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
