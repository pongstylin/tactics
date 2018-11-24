(function () {
  'use strict';

  Tactics.units[1].extend = function (self) {
    var board = Tactics.board;
    var data = Tactics.units[self.type];
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);

    Object.assign(self, {
      onAttackSelect: function (event) {
        let target = event.target;

        board.clearHighlight();

        // This makes it possible to click the attack button to switch from target
        // mode to attack mode.
        self.activated = 'target';
        self._targets = [
          target,
          board.getTile(target.x - 1, target.y),
          board.getTile(target.x + 1, target.y),
          board.getTile(target.x, target.y - 1),
          board.getTile(target.x, target.y + 1),
        ].filter(target => !!target);

        self._targets.forEach(target => self.highlightTarget(target));
      },
      attack: function () {
        let targets          = self._targets;
        let anim             = new Tactics.Animation({fps: 12});
        let direction        = board.getDirection(self.assignment, targets[0], self.direction);

        let all_target_units = [];
        targets.forEach(target => {
          if (target.assigned)
            all_target_units.push(target.assigned);
        });

        // The results are required to display the effect of an attack, whether it
        // is a miss or how much health was lost or gained.
        let results = self.calcAttackResults(all_target_units);

        let attackAnim = self.animAttack(targets[0]);

        anim.splice(self.animTurn(direction));
        anim.splice(attackAnim);

        results.sort((a, b) => a.unit.assignment.y - b.unit.assignment.y || a.unit.assignment.x - b.unit.assignment.x);

        return anim.play().then(() => results);
      },
    });

    return self;
  };

})();
