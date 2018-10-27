(function ()
{
	Tactics.units[22].extend = function (self)
	{
		var data = Tactics.units[self.type];
		var sounds = $.extend({},Tactics.sounds,data.sounds);
		var board = Tactics.board;

		$.each(data.frames,function (i,frame)
		{
			if (!frame) return;

			$.each(frame.c,function (j,sprite)
			{
				if (j === 0)
				{
					sprite.n = 'shadow';
				}
				else if (j === 2 && (frame.c.length === 3 || i < 80))
				{
					sprite.n = 'trim';
				}
				else if (j === 3 && i > 80)
				{
					sprite.n = 'trim';
				}
			});
		});

		$.extend(self,
		{
			title:'Awakened!',
			banned:[],

			attack:function (target)
			{
				var deferred = $.Deferred();
				var anim = new Tactics.Animation({fps:10});
				var direction = board.getDirection(self.assignment,target);
				var tunit;
				var calc,changes;

				if (target === target.assigned)
					return self.special();

				// LOS might change the actual target.
				// self.calcAttack(target) should return data on all units affected by the attack as well as the unit being focused.
				target = self.targetLOS(target);
				tunit = target.assigned;

				if (tunit)
				{
					calc = self.calcAttack(tunit);

					changes	= {mHealth:tunit.mHealth - calc.damage};
					if (changes.mHealth < -tunit.health) changes.mHealth = -tunit.health;

					// jQuery does not extend undefined value
					changes.notice = null;
				}

				self.freeze();

				anim
					.splice(self.animTurn(direction))
					.splice(self.animAttack(target,false,changes));

				anim.play(function ()
				{
					self.attacked = {target:target,block:false,changes:changes};
					self.origin.adirection = self.direction;
					self.thaw();
					deferred.resolve();
				});

				return deferred.promise();
			},
			special:function ()
			{
				var deferred = $.Deferred();
				var anim = new Tactics.Animation({fps:12});
				var target = self.assignment;
				var tunit = self;
				var block = data.animations[self.direction].block;
				var changes;

				if (tunit)
				{
					changes = {mHealth:tunit.mHealth + self.power};
					if (changes.mHealth > 0) changes.mHealth = 0;

					// jQuery does not extend undefined value
					changes.notice = null;
				}

				self.freeze();

				anim
					.splice
					([
						function () { self.drawFrame(block.s); },
						function () { self.drawFrame(block.s+1); },
						function () {},
						function () { sounds.heal.play(); }
					])
					.splice(self.animHeal([tunit]))
					.splice(4,function ()
					{
						tunit.change(changes);
					})
					.splice
					([
						function () { self.drawFrame(block.s+4); },
						function () { self.drawFrame(block.s+5); }
					]);

				anim.play(function ()
				{
					self.attacked = {target:target,block:false,changes:changes};
					self.origin.adirection = self.direction;
					self.thaw();
					deferred.resolve();
				});

				return deferred.promise();
			},
			phase:function (color)
			{
				var deferred = $.Deferred();
				var teams = board.getWinningTeams();
				var choices = [];

				if (color === undefined)
				{
					if (teams.length > 1)
					{
						$.each(teams.reverse(),function (i,team)
						{
							if (team.units.length === 0) return;
							if (self.banned.indexOf(i) > -1) return;
							if (choices.length && team.score > choices[0].score) return false;

							choices.push(team);
						});

						color = choices.random().color;
					}
					else
					{
						color = null;
					}
				}

				if (color === board.teams[self.team].color)
					deferred.resolve();
				else
					self.animPhase(color).play(function () { deferred.resolve(); });

				return deferred.promise();
			},
			animPhase:function (color)
			{
				var step = 12;
				var fcolor = self.color;
				var tcolor = color === null ? 0xFFFFFF : Tactics.colors[color];

				return new Tactics.Animation({fps:12,frames:
				[
					function ()
					{
						sounds.phase.play();
						board.teams[self.team].color = color;
						self.color = tcolor;
					},
					{
						script:function ()
						{
							self.pixi.children[0].children[2].tint = Tactics.utils.getColorStop(fcolor,tcolor,--step / 12);
						},
						repeat:12
					}
				]});
			},
			animDeploy:function (assignment)
			{
				var anim = new Tactics.Animation({fps:10});
				var origin = self.assignment;
				var direction = board.getDirection(origin,assignment,1);
				var odirection = board.getRotation(self.direction,180);
				var deploy,frame=0;

				if (direction.length === 2)
					direction = direction.indexOf(self.direction) === -1 ? odirection : self.direction;

				deploy = data.animations[direction].deploy;

				anim
					.splice(self.animTurn(direction))
					.splice
					(
						new Tactics.Animation({frames:
						[
							{
								script:function ()
								{
									self.drawFrame(deploy.s+frame++);
								},
								repeat:deploy.l
							}
						]})
							.splice(10,function ()
							{
								self.assign(assignment);
							})
							.splice([2,7,11,16],function ()
							{
								sounds.flap.play();
							})
					);

				return anim;
			},
			animAttack:function (target,block,changes)
			{
				var anim = new Tactics.Animation();
				var tunit = target.assigned;
				var direction = board.getDirection(self.assignment,target,1);
				var attack=data.animations[direction].attack,frame=0;
				var whiten = [0.25,0.5,0];
				var source = direction === 'N' || direction === 'E' ?  1 : 3;
				var adjust = direction === 'N' ? {x:-5,y:0} : direction === 'W' ? {x:-5,y:3} : {x:5,y:3};
				var container = new PIXI.Container();
				var filter1 = new PIXI.filters.BlurFilter();
				var filter2 = new PIXI.filters.BlurFilter();
				var streaks1 = new PIXI.Graphics;
				var streaks2 = new PIXI.Graphics;
				var streaks3 = new PIXI.Graphics;

				//filter1.blur = 6;
				streaks1.filters = [filter1];
				container.addChild(streaks1);

				filter2.blur = 6;
				streaks2.filters = [filter2];
				container.addChild(streaks2);

				streaks3.filters = [filter2];
				container.addChild(streaks3);

				anim
					.addFrame
					({
						script:function ()
						{
							self.drawFrame(attack.s+frame++);
						},
						repeat:attack.l
					})
					.splice(0,function ()
					{
						sounds.charge.play().fade(0,1,500);
					})
					.splice(5,tunit.animStagger(self,direction,changes))
					.splice(5,function ()
					{
						sounds.buzz.play();
						sounds.charge.stop();
						sounds.impact.play();
					})
					.splice(5,
					{
						script:function ()
						{
							tunit.whiten(whiten.shift());
						},
						repeat:3
					})
					.splice(5,function ()
					{
						self.drawStreaks(container,target,source,adjust);
						Tactics.stage.addChild(container);
					})
					.splice(6,function ()
					{
						self.drawStreaks(container,target,source,adjust);
					})
					.splice(7,function ()
					{
						Tactics.stage.removeChild(container);
						sounds.buzz.stop();
					});

				if (changes)
				{
					if (changes.mHealth === -tunit.health)
						anim.splice(tunit.animDeath(self));

					anim.splice(5,function ()
					{
						tunit.change(changes);
					});
				}

				return anim;
			},
			drawStreaks:function (container,target,source,adjust)
			{
				var sprite,bounds,start,end,stops;
				var streaks1 = container.children[0];
				var streaks2 = container.children[1];
				var streaks3 = container.children[2];

				// Make sure bounds are set correctly.
				Tactics.stage.children[1].updateTransform();

				sprite = self.frame.children[source];
				bounds = sprite.getBounds();
				start = new PIXI.Point(bounds.x+adjust.x,bounds.y+adjust.y);
				end = target.getCenter().clone();

				start.x += Math.floor(sprite.width/2);
				start.y += Math.floor(sprite.height/2);
				end.y -= 14;

				// Determine the stops the lightning will make.
				stops =
				[
					{
						x:start.x + Math.floor((end.x - start.x) * 1/3),
						y:start.y + Math.floor((end.y - start.y) * 1/3)
					},
					{
						x:start.x + Math.floor((end.x - start.x) * 2/3),
						y:start.y + Math.floor((end.y - start.y) * 2/3)
					},
					{x:end.x,y:end.y}
				];

				streaks1.clear();
				streaks2.clear();
				streaks3.clear();

				$.each([1,2,3],function (i)
				{
					var alpha = i % 2 === 0 ? 0.5 : 1;
					var deviation = alpha === 1 ? 9 : 19;
					var midpoint = (deviation+1)/2;

					streaks1.lineStyle(1,0x8888FF,alpha);
					streaks2.lineStyle(2,0xFFFFFF,alpha);
					streaks3.lineStyle(2,0xFFFFFF,alpha);

					streaks1.moveTo(start.x,start.y);
					streaks2.moveTo(start.x,start.y);
					streaks3.moveTo(start.x,start.y);

					$.each(stops,function (j,stop)
					{
						var offset;
						var x = stop.x,y = stop.y;

						if (j < 2)
						{
							// Now add a random offset to the stops.
							offset = Math.floor(Math.random() * deviation) + 1;
							if (offset > midpoint) offset = (offset-midpoint) * -1;
							x += offset;

							offset = Math.floor(Math.random() * deviation) + 1;
							if (offset > midpoint) offset = (offset-midpoint) * -1;
							y += offset;
						}

						streaks1.lineTo(x,y);
						streaks2.lineTo(x,y);
						streaks3.lineTo(x,y);
					});
				});

				return self;
			},
			animStrike:function (attacker,direction)
			{
				return new Tactics.Animation({frames:
				[
					function ()
					{
						sounds.strike.play();
					},
					function ()
					{
						self.shock(direction,0);
					},
					function ()
					{
						self.shock(direction,1);
					},
					function ()
					{
						self.shock(direction,2);
					},
					function ()
					{
						self.shock();
					}
				]});
			},
			animStagger:function (attacker,direction)
			{
				var color;
				var anim = new Tactics.Animation({frames:
				[
					function ()
					{
						self
							.drawFrame(data.animations[self.direction].block.s)
							.offsetFrame(0.06,direction);
					},
					function ()
					{
						self
							.drawFrame(data.animations[self.direction].block.s)
							.offsetFrame(-0.02,direction);
					},
					function ()
					{
						self.drawFrame(data.stills[self.direction]);
					}
				]});

				if (attacker.color === self.color)
				{
					self.banned.push(attacker.team);

					$.each(board.getWinningTeams().reverse(),function (i,team)
					{
						if (self.banned.indexOf(i) > -1) return;

						anim.splice(self.animPhase(color = team.color));
						return false;
					});

					if (!color) anim.splice(self.animPhase());
				}

				return anim;
			},
			animBlock:function (attacker,direction)
			{
				var anim = new Tactics.Animation();
				var block = data.animations[direction].block;
				var frame = 0,shock = 0;

				anim
					.addFrames(
					[
						function ()
						{
							self.direction = direction;
						},
						function ()
						{
							sounds.block.play();
						}
					])
					.splice(0,
					{
						script:function ()
						{
							self.drawFrame(block.s+frame++);
						},
						repeat:block.l
					})
					.splice(1,
					[
						{
							script:function ()
							{
								self.shock(direction,shock++,1);
							},
							repeat:3
						},
						function ()
						{
							self.shock();
						}
					]);

				return anim;
			}
		});

		return self;
	};
})();
