Tactics.Board = function ()
{
	var self = this;
	var trophy = new Tactics.Unit(19);
	var seed = new Tactics.Unit(15);
	var units;
	var card =
	{
		renderer:new PIXI.CanvasRenderer(176,100,{transparent:true}),
		stage:new PIXI.Container(),
		rendering:false,
		render:function ()
		{
			if (card.rendering) return;
			card.rendering = true;

			requestAnimationFrame(function ()
			{
//console.log('card render',+new Date());
				card.renderer.render(card.stage);
				card.rendering = false;
			});
		}
	};

	card.$canvas = $(card.renderer.view)
		.attr('id','card')
		.insertAfter(Tactics.$canvas);

	card.stage.hitArea = new PIXI.Polygon([0,0, 175,0, 175,99, 0,99]);
	card.stage.interactive = card.stage.buttonMode = true;
	card.stage.click = card.stage.tap = function ()
	{
		var els = card.elements;

		if (els.layer1.visible)
		{
			els.layer1.visible = !(els.layer2.visible = true);
			return card.render();
		}
		else if (els.layer2.visible)
		{
			els.layer2.visible = !(els.layer3.visible = true);
			return card.render();
		}

		self.eraseCard();
	};

	var style = card.renderer.context.createLinearGradient(0,0,176,0);
	style.addColorStop(0,'#000000');
	style.addColorStop('0.1','#FFFFFF');
	style.addColorStop(1,'#000000');

	card.mask = new PIXI.Graphics();
	card.mask.drawRect(0,0,88,46);

	card.elements = Tactics.draw({
		textStyle: {
      fontFamily: 'Arial',
      fontSize:   '11px',
      fill:       'white',
    },
		context:card.stage,
		children: {
			upper: {
				type    :'C',
				children: {
					avatar: {type:'C',x:42,y:75},
					name  : {
            type: 'T',
            x:    88,
            y:    14,
            style: {
              fontFamily: 'Arial',
              fontSize:   '11px',
              fontWeight: 'bold',
            },
          },
					notice: {type:'T',x:92,y:34}
				}
			},
			divider: {
				type:'G',
				draw:function (pixi) {
					pixi.lineStyle(1,0xFFFFFF,1,style);
					pixi.moveTo(0,60.5);
					pixi.lineTo(176,60.5);
				}
			},
			lower: {
				type    :'C',
				x       :8,
				y       :66,
				children: {
					layer1: {
						type:'C',
						children: {
							hLabel:{type:'T',x:  0,y: 0,text:'Health'},
							health:{type:'T',x: 39,y: 0              },

							bLabel:{type:'T',x: 80,y: 0,text:'Block' },
							block :{type:'T',x:115,y: 0              },
							mBlock:{type:'T',x:143,y: 0              },

							pLabel:{type:'T',x:  0,y:16,text:'Power' },
							power :{type:'T',x: 39,y:16              },
							mPower:{type:'T',x: 70,y:16              },

							aLabel:{type:'T',x: 80,y:16,text:'Armor' },
							armor :{type:'T',x:115,y:16              },
							mArmor:{type:'T',x:143,y:16              }
						},
					},
					layer2:
					{
						type:'C',
						visible:false,
						children:
						{
							yLabel   :{type:'T',x: 0,y: 0,text:'Ability'},
							ability  :{type:'T',x:55,y: 0},
							sLabel   :{type:'T',x: 0,y:16,text:'Specialty'},
							specialty:{type:'T',x:55,y:16},
						},
					},
					layer3:
					{
						type:'C',
						visible:false,
						children:
						{
							recovery:{type:'T',x: 0,y: 0},
							notice1 :{type:'T',x:88,y: 0},
							notice2 :{type:'T',x: 0,y:16},
							notice3 :{type:'T',x:88,y:16},
						},
					}
				}
			}
		}
	});

	utils.addEvents.call(self);

	// Using a closure to organize variables.
	$.extend(self,
	{
		// Public properties
		tiles:null,
		pixi:undefined,
		locked:false,
		teams:[],
		turns:[],
		selected:null,
		viewed:null,
		focused:null,
		carded:null,
		notice:'',
		selectMode:'move',
		rotation:'N',

		// Property accessors
		getTile:function (x,y)
		{
			return self.tiles[x+y*11];
		},

		// Public functions
		getDistance:function (a,b)
		{
			// Return the distance between two tiles.
			return Math.abs(a.x-b.x) + Math.abs(a.y-b.y);
		},
		getBetween:function (a,b,empty)
		{
			var distance = self.getDistance(a,b);
			var dx = Math.abs(a.x-b.x);
			var dy = Math.abs(a.y-b.y);
			var x,y;
			var tile,tiles = [];

			for (x=a.x-dx; x<a.x+dx+1; x++)
			{
				for (y=a.y-dy; y<a.y+dy+1; y++)
				{
					if (x == a.x && y == a.y) continue;
					if (!(tile = self.getTile(x,y))) continue;

					if (!empty || !tile.assigned) tiles.push(tile);
				}
			}

			return tiles;
		},
		getNeighbors:function (a)
		{
			var neighbors = {};

			neighbors.N = self.getTile(a.x,a.y-1);
			neighbors.S = self.getTile(a.x,a.y+1);
			neighbors.W = self.getTile(a.x-1,a.y);
			neighbors.E = self.getTile(a.x+1,a.y);

			return neighbors;
		},
		getDirection:function (a,b,simple)
		{
			var xdist = a.x-b.x;
			var ydist = a.y-b.y;

			if (Math.abs(xdist) > Math.abs(ydist))
			{
				if (ydist === 0 || simple)
				{
					return xdist > 0 ? 'W' : 'E';
				}
				else
				{
					return (xdist > 0 ? 'W' : 'E') + (ydist > 0 ? 'N' : 'S');
				}
			}
			else if (Math.abs(ydist) > Math.abs(xdist))
			{
				if (xdist === 0 || simple)
				{
					return ydist > 0 ? 'N' : 'S';
				}
				else
				{
					return (ydist > 0 ? 'N' : 'S') + (xdist > 0 ? 'W' : 'E');
				}
			}

			return (ydist > 0 ? 'N' : 'S') + (xdist > 0 ? 'W' : 'E');
		},
		getRotation:function (direction,deg)
		{
			var directions = ['N','NE','E','SE','S','SW','W','NW'];
			// 90 = 360 / directions.length;
			var index = directions.indexOf(direction) + (deg / 45);

			// 3 = directions.length-1; 4 = directions.length;
			return directions.slice(index > 7 ? index-8 : index)[0];
		},
		getDegree:function (direction,rotation)
		{
			var directions = ['N','NE','E','SE','S','SW','W','NW'];

			return (directions.indexOf(rotation) - directions.indexOf(direction)) * 45;
		},
		getUnitRotation:function (degree,tile,direction)
		{
			var data = {};

			if (degree)
			{
				data.direction = self.getRotation(direction,degree);

				if (degree == 90 || degree == -270)
				{
					data.tile = self.getTile(10-tile.y,tile.x);
				}
				else if (degree == 180 || degree == -180)
				{
					data.tile = self.getTile(10-tile.x,10-tile.y);
				}
				else if (degree == 270 || degree == -90)
				{
					data.tile = self.getTile(tile.y,10-tile.x);
				}
			}
			else
			{
				data.direction = direction;
				data.tile = tile;
			}

			return data;
		},

		// Public methods
		draw:function ()
		{
			var pixi = self.pixi = PIXI.Sprite.fromImage('http://www.taorankings.com/html5/images/board.jpg');
			var tiles = self.tiles = new Array(11*11);
			var tile;
			var selectEvent,focusEvent;
			var sx = 6-88;       // padding-left, 1 tile  wide
			var sy = 4+(56*4)+1; // padding-top , 4 tiles tall, tweak
			var x,y,c;

			pixi.position = new PIXI.Point(18,38);

			selectEvent = function (event)
			{
				var tile = event.target;
				var selected = self.selected;
				var assigned;

				if (self.locked) return;
				if (tile.action) return;

				if (assigned = tile.assigned)
				{
					Tactics.sounds.select.play();
					self.select(assigned);
				}
				else if (self.viewed || (selected && selected.origin.tile === selected.assignment))
				{
					self.deselect();
				}
			};

			focusEvent = function (event)
			{
				var tile = event.target;
				var assigned = tile.assigned;
				var selected = self.selected;
				var focused = self.focused;
				var viewed;

				tile.pixi.buttonMode = !self.locked && (tile.action || assigned);

				if (!assigned) return;

				if (event.type === 'focus')
				{
					Tactics.sounds.focus.play();
					self.focused = assigned.focus
					(
						self.locked ||
						assigned.team > 0 ||
						assigned.mRecovery ||
						(selected && selected.attacked && selected != assigned)
					);
				}
				else
				{
					assigned.blur();

					if (assigned === focused)
						self.focused = null;
				}

				Tactics.render();

				if (focused != self.focused)
				{
					self.drawCard();
					self.emit({type:'focus-change',ovalue:focused,nvalue:self.focused});
				}
			};

			for (x=0; x<11; x++)
			{
				y = 0;
				c = 11;
				if (x == 0)  { y=2; c=9;  }
				if (x == 1)  { y=1; c=10; }
				if (x == 9)  { y=1; c=10; }
				if (x == 10) { y=2; c=9;  }

				for (; y<c; y++)
				{
					tile = tiles[x+y*11] = new Tactics.Tile();
					tile.id = x+'x'+y;
					tile.x = x;
					tile.y = y;
					tile.on('select',selectEvent);
					tile.on('focus',focusEvent);
					tile.on('blur',focusEvent);
					tile.draw();
					tile.pixi.position = new PIXI.Point(sx+(x*44)+(y*44),sy-(x*28)+(y*28));

					pixi.addChild(tile.pixi);
				}
			}

			Tactics.stage.addChild(pixi);
			Tactics.stage.addChild(units = new PIXI.Container());

			// Required to place units in the correct places.
			pixi.updateTransform();

			$.each(tiles,function (i,tile)
			{
				if (!tile) return;

				// Hack to avoid apparent bug where x/y offsets change
				tile.getCenter();

				tile.N = tile.y >  0 ? tiles[i-11] : null;
				tile.S = tile.y < 10 ? tiles[i+11] : null;
				tile.E = tile.x < 10 ? tiles[i+ 1] : null;
				tile.W = tile.x >  0 ? tiles[i- 1] : null;
			});

			// Make sure units always overlap naturally.
			Tactics.on('render',function ()
			{
				units.children.sort(function (a,b)
				{
					return a.y - b.y;
				});
			});

			return self;
		},
		drawCard:function (unit)
		{
			var carded = self.carded;
			var els = card.elements;
			var mask;
			var notice;
			var notices = [];
			var important = 0;

			if (carded)
				carded.off('change',card.listener);

			if (self.carded = unit = unit || self.focused || self.viewed || self.selected)
			{
				unit.on('change',card.listener = function ()
				{
					self.drawCard(unit);
				});

				mask = new PIXI.Graphics();
				mask.drawRect(0,0,88,60);

				//
				//	Status Detection
				//
				if (unit.mHealth === -unit.health)
				{
					notice = 'Dead!';
				}
				else
				{
					notice = unit.notice;
				}

				if (!notice && unit.mRecovery)
					notice = 'Wait '+unit.mRecovery+' Turn'+(unit.mRecovery > 1 ? 's' : '')+'!';

				if (unit.poisoned)
				{
					notices.push('Poisoned!');
					important++;
				}

				if (unit.paralyzed)
				{
					notices.push('Paralyzed!');
					important++;
				}

				if (unit.barriered)
				{
					notices.push('Barriered!');
					important++;
				}

				if (unit.mBlocking < 0)
					notices.push('Vulnerable!');

				if (unit.health + unit.mHealth < unit.health * 0.4)
				{
					notices.push('Dying!');
				}
				else if (unit.mHealth < 0)
				{
					notices.push('Hurt!');
				}
				else
				{
					notices.push(unit.title || 'Ready!');
				}

				if (!notice)
				{
					notice = notices.shift();
					important--;
				}

				if (important > 0)
					notice += ' +';

				//
				//	Draw the top part of the card.
				//
				if (els.avatar.children.length) els.avatar.removeChildren();
				els.avatar.addChild(unit.drawAvatar());
				els.avatar.children[0].mask = mask;

				els.name.text = unit.name;

				els.notice.text = notice;

				if (unit.notice)
					els.notice.style = Object.assign(els.notice.style, {
            fontFamily: 'Arial',
            fontSize:   '13px',
          });
				else
					els.notice.style = Object.assign(els.notice.style, {
            fontFamily: 'Arial',
            fontSize:   '11px',
          });

				//
				//	Draw the first layer of the bottom part of the card.
				//
				els.layer1.visible = true;

				els.health.text = (unit.health + unit.mHealth)+'/'+unit.health;

				if (unit.blocking)
				{
					if (unit.mBlocking)
					{
						els.block.text = unit.blocking;

						if (unit.mBlocking > 0)
						{
							els.mBlock.text = '+'+Math.round(unit.mBlocking)+'%';
							els.mBlock.style.fill = '#00FF00';
						}
						else
						{
							els.mBlock.text = Math.round(unit.mBlocking)+'%';
							els.mBlock.style.fill = '#FF0000';
						}

						els.block.updateText();
						els.mBlock.position.x = els.block.position.x + els.block.width;
					}
					else
					{
						els.block.text = unit.blocking+'%';
						els.mBlock.text = '';
					}
				}
				else
				{
					els.block.text = '---';
					els.mBlock.text = '';
				}

				els.power.text = unit.power || '--';

				if (unit.mPower)
				{
					if (unit.mPower > 0)
					{
						els.mPower.text = '+'+unit.mPower;
						els.mPower.style.fill = '#00FF00';
					}
					else
					{
						els.mPower.text = unit.mPower;
						els.mPower.style.fill = '#FF0000';
					}

					els.power.updateText();
					els.mPower.position.x = els.power.position.x + els.power.width;
				}
				else
				{
					els.mPower.text = '';
				}

				els.armor.text = unit.armor;

				if (unit.mArmor)
				{
					if (unit.mArmor > 0)
					{
						els.mArmor.text = '+'+unit.mArmor;
						els.mArmor.style.fill = '#00FF00';
					}
					else
					{
						els.mArmor.text = unit.mArmor;
						els.mArmor.style.fill = '#FF0000';
					}

					els.armor.updateText();
					els.mArmor.position.x = els.armor.position.x + els.armor.width;
				}
				else
				{
					els.mArmor.text = '';
				}

				//
				//	Draw the 2nd layer of the bottom part of the card.
				//
				els.layer2.visible = false;

				els.ability.text = unit.ability;
				els.specialty.text = unit.specialty || 'None';

				//
				//	Draw the 3rd layer of the bottom part of the card.
				//
				els.layer3.visible = false;

				els.recovery.text = 'Recovery  '+unit.mRecovery+'/'+unit.recovery;
				els.notice1.text = notices.length ? notices.shift() : '---';
				els.notice2.text = notices.length ? notices.shift() : '---';
				els.notice3.text = notices.length ? notices.shift() : '---';

				card.stage.buttonMode = true;
				card.render();
			}
			else if (self.notice)
			{
				unit = trophy;
				mask = new PIXI.Graphics();
				mask.drawRect(0,0,88,60);

				//
				//	Draw the top part of the card.
				//
				if (els.avatar.children.length) els.avatar.removeChildren();
				els.avatar.addChild(unit.drawAvatar());
				els.avatar.children[0].mask = mask;

				els.name.text = 'Champion';
				els.notice.text = self.notice;

				//
				// Hide the rest.
				//
				els.layer1.visible = false;
				els.layer2.visible = false;
				els.layer3.visible = false;

				card.stage.buttonMode = true;
				card.render();
			}
			else if (!carded)
			{
				return self;
			}

			self.carded = unit || null;

			return self.emit({type:'card-change',ovalue:carded,nvalue:unit});
		},
		eraseCard:function ()
		{
			card.stage.buttonMode = false;

			if (self.carded) self.carded.off('change',card.listener);
			self.emit({type:'card-change',ovalue:self.carded,nvalue:null});
			self.carded = null;

			return self;
		},

		addTeams:function (teams)
		{
			$.each(teams,function (i,team)
			{
				self.teams.push({color:team.c,units:[],bot:team.b ? new Tactics.Bot(team.b) : null});

				$.each(team.u,function (coords,uData)
				{
					var x = coords.charCodeAt(0)-97;
					var y = coords.charCodeAt(1)-97;
					var degree = self.getDegree('N',self.rotation);
					var data = $.extend({},uData,self.getUnitRotation(degree,self.getTile(x,y),uData.d));

					self.addUnit(i,data);
				});
			});

			return self;
		},
		dropTeams:function ()
		{
			var teams = self.teams,units;
			var i,j;

			for (i=teams.length-1; i>-1; i--)
			{
				units = teams[i].units;

				for (j=units.length-1; j>-1; j--)
				{
					self.dropUnit(units[j]);
				}
			}

			teams.length = 0;

			return self;
		},

		addUnit:function (teamId,udata)
		{
			var team = self.teams[teamId];
			var unit = new Tactics.Unit(udata.t);
			unit.team = teamId;

			unit.draw(udata.direction,udata.tile);
			units.addChild(unit.pixi);
			team.units.push(unit);

			if (udata.h)
				unit.mHealth = udata.h;

			if (udata.b)
				unit.mBlocking = udata.b;

			if (udata.r)
				unit.mRecovery = udata.r;

			return self;
		},
		dropUnit:function (unit)
		{
			var tUnits = self.teams[unit.team].units;

			if (unit == self.focused)
			{
				unit.blur();
				self.focused = null;
			}

			if (unit == self.viewed)
			{
				unit.deactivate();
				self.viewed = null;
			}

			if (unit == self.selected)
			{
				unit.deactivate();
				self.selected = null;
			}

			if (unit == self.carded)
				self.drawCard();

			tUnits.splice(tUnits.indexOf(unit),1);
			unit.assignment.dismiss();
			units.removeChild(unit.pixi);

			return self;
		},

		/*
			This does not actually rotate the board - that causes all kinds of
			complexity.  Rather, it rearranges the units so that it appears the
			board has rotated.  This means unit coordinates and directions must
			be translated to an API based on our current rotation.
		*/
		rotate:function (rotation)
		{
			var units = [];
			var degree = self.getDegree(self.rotation,rotation);

			$.each(self.teams,function (i,team)
			{
				Array.prototype.push.apply(units,team.units);
			});

			// First, reset all tiles.
			if (self.selected && !self.viewed) self.selected.hideMode();
			if (self.viewed) self.viewed.hideMode();

			$.each(units,function (i,unit)
			{
				unit.assignment.dismiss();
			});

			$.each(units,function (i,unit)
			{
				var origin = unit.origin;
				var data = self.getUnitRotation(degree,unit.assignment,unit.direction);
				var odata = self.getUnitRotation(degree,origin.tile,origin.direction);

				if (origin.adirection)
					odata.adirection = self.getRotation(origin.adirection,degree);

				unit.assignment = null;
				unit.assign(data.tile).turn(data.direction);
				unit.origin = odata;
			});

			if (self.selected && !self.viewed) self.selected.showMode();
			if (self.viewed) self.viewed.showMode();

			self.rotation = rotation;
			Tactics.render();

			return self;
		},

		setSelectMode:function (mode)
		{
			var team = self.teams[self.turns[0]];

			if (self.viewed)
				if (!team.bot)
					self.viewed.activate(mode,true);
				else
					self.viewed.activate();
			else if (self.selected)
				if (!team.bot)
					self.selected.activate(mode);
				else
					self.selected.activate();

			// I got tired of seeing button borders and glow changes during bot turns.
			if (!team || !team.bot)
				self.emit({type:'select-mode-change',ovalue:self.selectMode,nvalue:mode});
			self.selectMode = mode;

			return self;
		},
		//
		// A unit is only selectable if...
		//   1) The unit belongs to the team that is playing its turn.
		//   2) The unit has completely recovered.
		//   3) Another unit on the same team has not already attacked this turn.
		//
		select:function (unit)
		{
			var selected = self.selected;
			var viewed = self.viewed;
			var mode;

			if (unit == viewed) return self.drawCard();

			if (viewed)
			{
				viewed.deactivate();
				self.viewed = null;
			}

			if (unit == selected)
			{
				if (selected.activated == 'direction')
				{
					mode = 'turn';
				}
				else if (selected.activated == 'target')
				{
					mode = 'attack';
				}
				else
				{
					mode = selected.activated;

					if (viewed) unit.showMode();
				}
			}
			else
			{
				mode = self.selectMode;

				if (mode === 'move' && !unit.mRadius)
					mode = unit.aRadius ? 'attack' : null;
				else if (mode === 'attack' && !unit.aRadius)
					mode = unit.mRadius ? 'move'   : null;
				else if (mode === null && unit.mRadius)
					mode = 'move';
				else if (mode === null && unit.aRadius)
					mode = 'attack';

				if
				(
					!unit.mRecovery &&
					self.turns[0] == unit.team &&
					(!selected || !selected.attacked)
				)
				{
					if (selected) selected.reset();
					self.selected = unit;
				}
				else
				{
					if (selected && !viewed) selected.hideMode();
					self.viewed = unit;
				}
			}

			self.setSelectMode(mode);

			return self.drawCard();
		},
		deselect:function (reset)
		{
			var selected = self.selected;
			var viewed = self.viewed;
			var team = self.teams[self.turns[0]];

			if (reset)
			{
				if (selected) selected.deactivate();
				self.selected = null;

				if (viewed) viewed.deactivate();
				self.viewed = null;
			}
			else if (!team.bot)
			{
				if (viewed)
				{
					viewed.deactivate();
					self.viewed = null;

					if (selected)
						if (selected.activated == 'direction')
							selected.activate('turn');
						else if (selected.activated == 'target')
							selected.activate('attack');
						else
							selected.showMode();

					self.setSelectMode(selected ? selected.activated : self.selectMode);
				}
				else if (selected && !selected.attacked)
				{
					// Cancel any deployment or turning then deselect.
					selected.reset();
					self.selected = null;

					Tactics.render();
				}
				else
					return self;
			}
			else
			{
				if (selected) selected.deactivate();
				self.selected = null;
			}

			if (selected != self.selected || viewed != self.viewed)
				self.drawCard();

			return self;
		},

		startTurn:function ()
		{
			var teamId = self.turns[0];
			var bot = self.teams[teamId].bot;

			if (bot)
			{
				self.lock();

				// Give the page a chance to render the effect of locking the board.
				setTimeout(function ()
				{
					bot.startTurn(teamId).done(function (record)
					{
						self.record = record;

						if (Tactics.debug) return;
						self.endTurn();
					});
				},100);
			}
			else
			{
				self.unlock();
				self.notice = 'Your Turn!';
				self.drawCard();
			}
		},
		endTurn:function ()
		{
			var turns = self.turns;
			var teamId = turns[0];
			var decay,recovery;
			var selected = self.selected,attacked,deployed;

			self.notice = undefined;

			// First remove dead teams from turn order.
			$.each(self.teams,function(t,team)
			{
				var i;

				if (team.units.length) return;
				if (turns.indexOf(t) === -1) return;

				turns.splice(turns.indexOf(t),1);

				// If the player team was killed, he can take over for a bot team.
				if (!self.teams[t].bot)
				{
					for (i=0; i<self.teams.length; i++)
					{
						if (!self.teams[i].units.length) continue;
						self.teams[i].bot = 0;
						break;
					}
				}
			});

			// Recover and decay blocking modifiers
			decay = self.turns.length;
			if (self.teams[4] && self.teams[4].units.length) decay--;

			$.each(self.teams,function (t,team)
			{
				$.each(team.units,function (u,unit)
				{
					if (unit.mRecovery && t == teamId) unit.mRecovery--;
					if (teamId !== 4 && unit.mBlocking)
					{
						unit.mBlocking *= 1 - 0.2/decay;
						if (Math.abs(unit.mBlocking) < 2) unit.mBlocking = 0;
					}
				});
			});

			if (selected)
			{
				recovery = selected.recovery;
				attacked = selected.attacked;
				deployed = selected.deployed;

				selected.mRecovery =
					deployed && attacked ?            recovery      :
					deployed             ? Math.floor(recovery / 2) :
					            attacked ?  Math.ceil(recovery / 2) : 0;
			}

			self.deselect(true);
			self.setSelectMode('move');
			self.drawCard();

			// If this team killed itself, this can be false.
			if (teamId == turns[0])
				turns.push(turns.shift());

			// If all units were killed, this can be false.
			if (turns.length)
				self.startTurn();

			return self;
		},

		lock:function ()
		{
			if (self.locked) return;
			self.locked = true;

			$.each(self.tiles,function (i,tile)
			{
				if (!tile) return;
				tile.pixi.buttonMode = false;
			});

			self.emit({type:'lock-change',ovalue:false,nvalue:true});
		},
		unlock:function ()
		{
			if (!self.locked) return;
			self.locked = false;

			$.each(self.tiles,function (i,tile)
			{
				if (!tile || !tile.focused) return;
				tile.pixi.buttonMode = tile.action || tile.assigned;
			});

			self.emit({type:'lock-change',ovalue:true,nvalue:false});
		},

		calcTeams:function ()
		{
			var choices = [];

			$.each(self.teams,function (id,team)
			{
				var thp = 50*3,chp = 0;
				if (id === 4) return; // Team Chaos
				if (team.units.length === 0) return;

				$.each(team.units,function (i,unit)
				{
					chp += unit.health + unit.mHealth;
				});

				choices.push
				({
					id:id,
					color:team.color,
					units:team.units,
					score:chp / thp,
					size:team.units.length,
					random:Math.random()
				});
			});

			return choices;
		},
		getWinningTeams:function ()
		{
			var teams = self.calcTeams();

			teams.sort(function (a,b)
			{
				return (b.score - a.score) || (b.size - a.size) || (a.random - b.random);
			});

			return teams;
		},
		getLosingTeam:function ()
		{
			var teams = self.calcTeams();

			teams.sort(function (a,b)
			{
				return (a.score - b.score) || (a.size - b.size) || (a.random - b.random);
			});

			return self.teams[teams[0].id];
		},

		reset:function ()
		{
			self.dropTeams();
			self.eraseCard();

			return self.setSelectMode('move');
		},
		save:function ()
		{
			var teams = [];

			$.each(self.teams,function (i,team)
			{
				var tdata = {c:team.color,b:team.bot ? 1 : 0,u:{}};

				$.each(team.units,function (i,unit)
				{
					var udata = {t:unit.type,d:unit.direction};
					var tile = unit.assignment;
					var coords = String.fromCharCode(97+tile.x)+String.fromCharCode(97+tile.y);

					if (unit.mHealth) udata.h = unit.mHealth;
					if (unit.mBlocking) udata.b = unit.mBlocking;
					if (unit.mRecovery) udata.r = unit.mRecovery;

					tdata.u[coords] = udata;
				});

				teams.push(tdata);
			});

			return {teams:teams,turns:self.turns};
		}
	});

	return self;
};
