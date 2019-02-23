(function () {
  'use strict';

  Tactics.units[8].extend = function (self) {
    var _super = Object.assign({}, self);
    var data = Tactics.units[self.type];
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);
    var effects = Object.assign({}, Tactics.effects, data.effects);

    Object.assign(self, {
      attack: function (action) {
        let anim = new Tactics.Animation();

        let attackAnim = self.animAttack(action.direction);
        attackAnim.splice(0, () => sounds.paralyze.play())

        action.results.forEach(result => {
          let unit = result.unit.assigned;

          attackAnim.splice(0, self.animStreaks(unit));
        });

        anim.splice(self.animTurn(action.direction));
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
