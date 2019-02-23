(function () {
  'use strict';

  Tactics.units[5].extend = function (self) {
    var data   = Tactics.units[self.type];
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);

    Object.assign(self, {
      attack: function (action) {
        let anim       = new Tactics.Animation();
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
