(function () {
  'use strict';

  Tactics.units[2].extend = function (self) {
    var board = Tactics.board;
    var data = Tactics.units[self.type];
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);

    Object.assign(self, {
      attack: function (target) {
        let anim        = new Tactics.Animation();
        let direction   = board.getDirection(self.assignment, target, self.direction);
        let target_unit = self.getLOSTargetUnit(target);
        let results     = [];

        let attackAnim = self.animAttack(target);
        attackAnim.splice(4, () => sounds.attack.play());
        attackAnim.addFrame(() => self.drawFrame(data.stills[direction]));

        if (target_unit) {
          // The result is required to display the effect of an attack, whether it
          // is a miss or how much health was lost or gained.
          results = self.calcAttackResults(target_unit);

          // Simulate how long it takes for the arrow to travel.
          let index = 9 + Math.ceil(
            board.getDistance(self.assignment, target_unit.assignment) / 2,
          );

          // Animate the target unit's reaction starting with the 4th attack frame.
          if (results[0].blocked)
            attackAnim
              .splice(index, target_unit.animBlock(self));
          else
            attackAnim
              .splice(index, self.animStrike(target_unit))
              .splice(index+1, target_unit.animStagger(self));
        }

        anim.splice(self.animTurn(direction));
        anim.splice(attackAnim);

        return anim.play().then(() => results);
      },
    });

    return self;
  };

})();
