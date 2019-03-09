(function () {
  'use strict';

  Tactics.units[3].extend = function (self, data, board) {
    var _super = Object.assign({}, self);

    Object.assign(self, {
      getAttackTiles: function () {
        return self.team.units.map(unit => unit.assignment);
      },
      getTargetTiles: function (target) {
        return self.getAttackTiles();
      },
      getTargetUnits: function (target) {
        return self.team.units;
      },
      attack: function (action) {
        let anim         = new Tactics.Animation();
        let target_units = self.getTargetUnits(action.tile);

        let attackAnim = self.animAttack(action.direction);
        attackAnim.splice(2, self.animHeal(target_units));

        anim.splice(self.animTurn(action.direction));
        anim.splice(attackAnim);

        return anim.play();
      },
      getAttackResults: function (action) {
        let results = _super.getAttackResults(action);

        results.sort((a, b) =>
          a.unit.assignment.y - b.unit.assignment.y ||
          a.unit.assignment.x - b.unit.assignment.x
        );

        return results;
      },
    });

    return self;
  };

})();
