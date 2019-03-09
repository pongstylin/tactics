(function () {
  'use strict';

  Tactics.units[2].extend = function (self, data, board) {
    Object.assign(self, {
      attack: function (action) {
        let anim   = new Tactics.Animation();
        let sounds = Object.assign({}, Tactics.sounds, data.sounds);

        let attackAnim = self.animAttack(action.direction);
        attackAnim.splice(4, () => sounds.attack.play());

        // Zero or one result expected.
        action.results.forEach(result => {
          let unit = result.unit;

          // Simulate how long it takes for the arrow to travel.
          let index = 9 + Math.ceil(
            board.getDistance(self.assignment, unit.assignment) / 2,
          );

          // Animate the target unit's reaction.
          if (result.miss === 'blocked')
            attackAnim
              .splice(index, unit.animBlock(self));
          else
            attackAnim
              .splice(index, self.animStrike(unit))
              .splice(index+1, unit.animStagger(self));
        });

        anim.splice(self.animTurn(action.direction));
        anim.splice(attackAnim);

        return anim.play();
      },
    });

    return self;
  };

})();
