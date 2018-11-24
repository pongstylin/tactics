(function () {
  'use strict';

  Tactics.units[3].extend = function (self) {
    var board = Tactics.board;
    var data = Tactics.units[self.type];
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);
    var _super = Object.assign({}, self);

    Object.assign(self, {
      animDeploy: function (assignment) {
        return self.animWalk(assignment);
      },
      getAttackTiles: function () {
        return board.teams[self.team].units.map(unit => unit.assignment);
      },
      highlightAttack: function () {
        if (self.viewed)
          _super.highlightAttack();
        else
          self.getAttackTiles().forEach(target => self.highlightTarget(target));

        return self;
      },
      attack: function (target) {
        let anim             = new Tactics.Animation({fps: 12});
        let direction        = board.getDirection(self.assignment, target, self.direction);
        let all_target_units = board.teams[self.team].units;

        // The results are required to display the effect of an attack, whether it
        // is a miss or how much health was lost or gained.
        let results = self.calcAttackResults(all_target_units);

        let attackAnim = self.animAttack(target);
        attackAnim.splice(2, self.animHeal(all_target_units));

        anim.splice(self.animTurn(direction));
        anim.splice(attackAnim);

        results.sort((a, b) => a.unit.assignment.y - b.unit.assignment.y || a.unit.assignment.x - b.unit.assignment.x);

        return anim.play().then(() => result);
      },
      calcAttack: function (target_unit) {
        let calc = {
          damage:      -12 + Math.max(target_unit.mHealth + 12, 0),
          block:       0,
          chance:      target_unit.barriered ? 0 : 100,
          penalty:     0,
          bonus:       0,
          unblockable: !target_unit.barriered,
        };

        if (target_unit.team !== self.team) {
          calc.damage = 0;
          calc.block  = 100;
          calc.chance = 0;
          calc.unblockable = false;
        }

        return calc;
      },
      calcAttackResults: function (target_units) {
        return target_units.map(unit => {
          let result = {unit: unit};

          if (unit.barriered)
            return Object.assign(result, {miss: true});

          return Object.assign(result, {mHealth: Math.min(unit.mHealth + self.power, 0)});
        });
      },
    });

    return self;
  };

})();
