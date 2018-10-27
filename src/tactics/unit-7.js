(function ()
{
	Tactics.units[7].extend = function (self)
	{
		var data = Tactics.units[self.type];

		$.extend(self,
		{
			animDeploy:function (assignment)
			{
				var anim = new Tactics.Animation({fps:10});

				$.each(data.frames,function (i) {
					anim.addFrame(function ()
					{
						self.drawFrame(i);
					});
				});

				anim.addFrame(function (i) {
					self.drawFrame(data.stills[self.direction]+1);
				});

				return anim;
			},
			animAttack:function (direction,block,changes)
			{
				return self.animDeploy();
			}
		});

		return self;
	};

})();
