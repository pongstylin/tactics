(function () {
  'use strict';

  Tactics.units[5].extend = function (self, data, board) {
    Object.assign(self, {
      attack: function (action) {
        let anim   = new Tactics.Animation();
        let sounds = Object.assign({}, Tactics.sounds, data.sounds);

        let attackAnim = self.animAttack();
        attackAnim.splice(5, () => sounds.attack.play());

        anim.splice(attackAnim);
        anim.splice(10, self.animLightning(action.tile, action.results));

        return anim.play();
      },
      animStagger: function (attacker) {
        //do nothing. The Lightning Ward laughs at any feeble attempt to move it.
      },      
    });     
  };
})();
