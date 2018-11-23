(function () {
  'use strict';

  Tactics.units[7].extend = function (self) {
    var board = Tactics.board;
    var data = Tactics.units[self.type];
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);
    var _super = Object.assign({}, self);

    Object.assign(self, {
      animDeploy: function (assignment) {
        return self.animWalk(assignment);
      },
      highlightAttack: function () {
        if (self.viewed)
          _super.highlightAttack();
        else {
          self.activated = 'target';
          self.getAttackTiles().forEach(target => self.highlightTarget(target));
        }

        return self;
      },
      attack: function (target) {
        let anim             = new Tactics.Animation({fps: 12});
        let direction        = board.getDirection(self.assignment, target, self.direction);
        let all_target_units = [];

        self.getAttackTiles().forEach(tile => {
          if (tile.assigned)
            all_target_units.push(tile.assigned);
        });

        // The result is required to display the effect of an attack, whether it
        // is a miss or how much health was lost or gained.
        let results = self.calcAttackResults(all_target_units);

        let attackAnim = self.animAttack(target);
        attackAnim.splice(1, () => sounds.attack1.play());
        attackAnim.splice(3, () => sounds.attack2.play());
        attackAnim.addFrame(() => self.drawFrame(data.stills[direction]));

        results.forEach(result => {
          let target_unit = result.unit;

          // Animate the target unit's reaction starting with the 4th attack frame.
          if (result.blocked)
            attackAnim
              .splice(3, target_unit.animBlock(self));
          else
            attackAnim
              .splice(3, self.animStrike(target_unit))
              .splice(4, target_unit.animStagger(self));
        });

        anim.splice(self.animTurn(direction));
        anim.splice(attackAnim)

        return anim.play().then(() => results);
      },
      can_special: function () {
        if (!self.can_attack())
          return false;
        else
          return (self.health + self.mHealth) < 5;
      },
    });

    return self;
  };

})();
