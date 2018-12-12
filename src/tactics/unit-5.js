(function ()
{
	'use strict';
	Tactics.units[5].extend = function (self)
	{
		var data = Tactics.units[self.type];
		var sounds = Object.assign({}, Tactics.sounds, data.sounds);
		Object.assign(self, {
			playAttack: function (target) {
				let anim        = new Tactics.Animation();
				let target_unit =  target.assigned;
				let results     = [];
				let attackAnim = self.animAttack(target);
				attackAnim.splice(5, () => sounds.attack.play());

				if (target_unit) {
				  results = self.calcAttackResults(target_unit);
				}
				anim.splice(attackAnim);
				anim.splice(10,self.animLightning(target,results));
				return anim.play().then(() => results);
			  },
		}	);     

	}

})();
