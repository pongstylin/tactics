(function () {
  'use strict';

  Tactics.units[3].extend = function (self) {
    var _super = Object.assign({}, self);
    var board = Tactics.board;
    var data = Tactics.units[self.type];
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);

    Object.assign(self, {
      getAttackTiles: function () {
        return board.teams[self.team].units.map(unit => unit.assignment);
      },
      getTargetTiles: function (target) {
        return self.getAttackTiles();
      },
      getTargetUnits: function (target) {
        return board.teams[self.team].units;
      },
      highlightAttack: function () {
        if (self.viewed)
          _super.highlightAttack();
        else
          self.getAttackTiles().forEach(target => self.highlightTarget(target));

        return self;
      },
      playAttack: function (target, results) {
        let anim         = new Tactics.Animation();
        let direction    = board.getDirection(self.assignment, target, self.direction);
        let target_units = self.getTargetUnits(target);

        let attackAnim = self.animAttack(target);
        attackAnim.splice(2, self.animHeal(target_units));

        anim.splice(self.animTurn(direction));
        anim.splice(attackAnim);

        return anim.play();
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
      calcAttackResults: function (target) {
        let target_units = self.getTargetUnits(target);
        let results = target_units.map(unit => {
          let result = {unit: unit};

          if (unit.barriered)
            return Object.assign(result, {miss: true});

          return Object.assign(result, {mHealth: Math.min(unit.mHealth + self.power, 0)});
        });

        results.sort((a, b) => a.unit.assignment.y - b.unit.assignment.y || a.unit.assignment.x - b.unit.assignment.x);

        return results;
      },
    });

    return self;
  };

})();
