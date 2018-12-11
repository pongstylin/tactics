(function () {
  'use strict';

  Tactics.units[2].extend = function (self) {
    var board = Tactics.board;
    var data = Tactics.units[self.type];
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);

    Object.assign(self, {
      playAttack: function (target, results) {
        let anim      = new Tactics.Animation();
        let direction = board.getDirection(self.assignment, target, self.direction);

        let attackAnim = self.animAttack(target);
        attackAnim.splice(4, () => sounds.attack.play());
        attackAnim.addFrame(() => self.drawFrame(data.stills[direction]));

        // There should be zero or one result.
        results.forEach(result => {
          let unit = result.unit;

          // Simulate how long it takes for the arrow to travel.
          let index = 9 + Math.ceil(
            board.getDistance(self.assignment, unit.assignment) / 2,
          );

          // Animate the target unit's reaction.
          if (result.blocked)
            attackAnim
              .splice(index, unit.animBlock(self));
          else
            attackAnim
              .splice(index, self.animStrike(unit))
              .splice(index+1, unit.animStagger(self));
        });

        anim.splice(self.animTurn(direction));
        anim.splice(attackAnim);

        return anim.play();
      },
    });

    return self;
  };

})();
