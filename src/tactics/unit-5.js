(function () {
  'use strict';

  Tactics.units[5].extend = function (self) {
    var data   = Tactics.units[self.type];
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);

    Object.assign(self, {
      playAttack: function (target, results) {
        let anim        = new Tactics.Animation();
        let target_unit = target.assigned;
        let attackAnim  = self.animAttack(target);
        attackAnim.splice(5, () => sounds.attack.play());

        anim.splice(attackAnim);
        anim.splice(10, self.animLightning(target, results));

        return anim.play();
      },
      animStagger: function (attacker) {
        //do nothing. The Lightning Ward laughs at any feeble attempt to move it.
      },      
    });     
  };
})();
