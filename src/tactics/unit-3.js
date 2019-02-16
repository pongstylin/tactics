(function () {
  'use strict';

  Tactics.units[3].extend = function (self) {
    var _super = Object.assign({}, self);
    var board  = Tactics.board;
    var data   = Tactics.units[self.type];
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
      playAttack: function (action) {
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

        results.sort((a, b) => a.unit.y - b.unit.y || a.unit.x - b.unit.x);

        return results;
      },
    });

    return self;
  };

})();
