Tactics.Board = function ()
{
  var self = this;
  var trophy;
  var units;
  var card = {
    renderer:  new PIXI.CanvasRenderer(176,100,{transparent:true}),
    stage:     new PIXI.Container(),
    rendering: false,
    render:    () => {
      if (card.rendering) return;
      card.rendering = true;

      requestAnimationFrame(() => {
//console.log('card render',+new Date());
        card.renderer.render(card.stage);
        card.rendering = false;
      });
    }
  };
  var highlighted = [];

  card.$canvas = $(card.renderer.view)
    .attr('id','card')
    .insertAfter(Tactics.$canvas);

  card.stage.hitArea = new PIXI.Polygon([0,0, 175,0, 175,99, 0,99]);
  card.stage.interactive = card.stage.buttonMode = true;
  card.stage.click = card.stage.tap = function () {
    var els = card.elements;

    if (els.layer1.visible) {
      els.layer1.visible = !(els.layer2.visible = true);
      return card.render();
    }
    else if (els.layer2.visible) {
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
          layer2: {
            type:'C',
            visible:false,
            children: {
              yLabel   :{type:'T',x: 0,y: 0,text:'Ability'},
              ability  :{type:'T',x:55,y: 0},
              sLabel   :{type:'T',x: 0,y:16,text:'Specialty'},
              specialty:{type:'T',x:55,y:16},
            },
          },
          layer3: {
            type:'C',
            visible:false,
            children: {
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
    /*
     * From the position of tile a, return the direction of tile b.
     * Consider this matrix:
     *   NW  NNW  N  NNE  NE
     *   WNW NW   N   NE ENE
     *   W   W    A    E   E
     *   WSW SW   s   SE ESE
     *   SW  SSW  S  SSE  SE
     *
     *   When "simple" is falsey, triple directions are reduced to double
     *   directions, e.g. NNW = NW.
     *
     *   When "simple" is true, triple directions are reduced to the strongest
     *   direction, e.g. NNW = N.
     *
     *   When "simple" is a direction, triple and double directions are
     *   reduced to a single direction using this priority order:
     *   1) The strongest direction.
     *   2) The "simple" direction.
     *   3) The direction to the right of the "simple" direction.
     *   4) The direction to the left of the "simple" direction.
     */
    getDirection: function (a, b, simple) {
      let xdist = a.x - b.x;
      let ydist = a.y - b.y;

      if (Math.abs(xdist) > Math.abs(ydist)) {
        // EW is stronger than NS
        if (ydist === 0 || simple) {
          // The only or strongest direction
          return xdist > 0 ? 'W' : 'E';
        }
        else {
          // Triple direction reduced to double direction.
          return (xdist > 0 ? 'W' : 'E') + (ydist > 0 ? 'N' : 'S');
        }
      }
      else if (Math.abs(ydist) > Math.abs(xdist)) {
        // NS is stronger than EW
        if (xdist === 0 || simple) {
          // The only or strongest direction
          return ydist > 0 ? 'N' : 'S';
        }
        else {
          // Triple direction reduced to double direction.
          return (ydist > 0 ? 'N' : 'S') + (xdist > 0 ? 'W' : 'E');
        }
      }

      // a and b is the same or at a double direction.
      let direction
      if (a === b)
        direction = 'NSEW';
      else
        direction = (ydist > 0 ? 'N' : 'S') + (xdist > 0 ? 'W' : 'E');

      if (simple && typeof simple === 'string')
        // Reduce direction to a single direction.
        direction = [
          simple,
          self.getRotation(simple, 90),
          self.getRotation(simple, -90),
        ].find(d => direction.indexOf(d) > -1);

      return direction;
    },
    getRotation: function (direction, deg) {
      var directions = ['N','NE','E','SE','S','SW','W','NW'];
      // 90 = 360 / directions.length;
      var index = directions.indexOf(direction) + (deg / 45);

      // 3 = directions.length-1; 4 = directions.length;
      return directions.slice(index > 7 ? index-8 : index)[0];
    },
    getDegree: function (direction, rotation) {
      var directions = ['N','NE','E','SE','S','SW','W','NW'];

      return (directions.indexOf(rotation) - directions.indexOf(direction)) * 45;
    },
    getUnitRotation: function (degree, tile, direction) {
      var data = {};

      if (degree) {
        data.direction = self.getRotation(direction,degree);

        if (degree == 90 || degree == -270) {
          data.tile = self.getTile(10-tile.y,tile.x);
        }
        else if (degree == 180 || degree == -180) {
          data.tile = self.getTile(10-tile.x,10-tile.y);
        }
        else if (degree == 270 || degree == -90) {
          data.tile = self.getTile(tile.y,10-tile.x);
        }
      }
      else {
        data.direction = direction;
        data.tile = tile;
      }

      return data;
    },

    // Public methods
    draw: function () {
      var pixi = self.pixi = PIXI.Sprite.fromImage('http://www.taorankings.com/html5/images/board.jpg');
      var tiles = self.tiles = new Array(11*11);
      var tile;
      var sx = 6-88;       // padding-left, 1 tile  wide
      var sy = 4+(56*4)+1; // padding-top , 4 tiles tall, tweak
      var x,y,c;

      // The board itself is interactive since we want to detect a click or tap
      // on a blank tile to cancel current selection, if sensible.
      pixi.interactive = true;
      pixi.click = pixi.tap = () => {
        if (self.locked) return;

        let selected = self.selected;
        if (self.viewed || (selected && selected.origin.tile === selected.assignment))
          self.deselect();

        Tactics.render();
      };
      pixi.position = new PIXI.Point(18,38);

      /*
       * A select event occurs when a unit or an action tile is selected.
       */
      var selectEvent = event => {
        if (self.locked) return;

        let tile = event.target;
        if (tile.action) return;

        Tactics.sounds.select.play();
        self.select(tile.assigned);
      };

      var focusEvent = event => {
        let assigned = event.target.assigned;
        let old_focused = self.focused;

        if (event.type === 'focus')
          self.focused = assigned;
        else // event.type === 'blur'
          if (assigned === old_focused)
            self.focused = null;

        if (old_focused !== self.focused && !self.locked) {
          if (old_focused)
            old_focused.blur();

          if (self.focused) {
            let selected = self.selected;
            let view_only = self.focused.team !== self.turns[0]
              || self.focused.mRecovery > 0
              || self.focused.paralyzed !== false
              || (selected && selected.attacked && selected !== self.focused);

             Tactics.sounds.focus.play();
             self.focused.focus(view_only);
          }

          self.drawCard();
          self.emit({
            type:   'focus-change',
            ovalue: old_focused,
            nvalue: self.focused,
          });
        }
      };

      for (x=0; x<11; x++) {
        y = 0;
        c = 11;
        if (x == 0)  { y=2; c=9;  }
        if (x == 1)  { y=1; c=10; }
        if (x == 9)  { y=1; c=10; }
        if (x == 10) { y=2; c=9;  }

        for (; y<c; y++) {
          tile = tiles[x+y*11] = new Tactics.Tile(x, y);
          tile.on('select',     selectEvent);
          tile.on('focus blur', focusEvent);
          tile.draw();
          tile.pixi.position = new PIXI.Point(sx+(x*44)+(y*44),sy-(x*28)+(y*28));

          pixi.addChild(tile.pixi);
        }
      }

      Tactics.stage.addChild(pixi);
      Tactics.stage.addChild(units = new PIXI.Container());

      // Required to place units in the correct places.
      pixi.updateTransform();

      tiles.forEach((tile, i) => {
        if (!tile) return;

        // Hack to avoid apparent bug where x/y offsets change
        tile.getCenter();

        tile.N = tile.y >  0 ? tiles[i-11] : null;
        tile.S = tile.y < 10 ? tiles[i+11] : null;
        tile.E = tile.x < 10 ? tiles[i+ 1] : null;
        tile.W = tile.x >  0 ? tiles[i- 1] : null;
      });

      // Make sure units always overlap naturally.
      Tactics.on('render', () => {
        units.children.sort((a, b) => a.y - b.y);
      });

      return self;
    },
    /*
     * Draw an information card based on these priorities:
     *   1) The provided 'unit' argument (optional)
     *   2) The unit that the user is currently focused upon
     *   3) The unit that the user has selected for viewing.
     *   4) The unit that the user has selected for control.
     *   5) The trophy avatar with the board notice.
     */
    drawCard: function (unit) {
      let els = card.elements;
      let mask;
      let notice;
      let notices = [];
      let important = 0;

      if (unit === undefined)
        unit = self.focused || self.viewed || self.selected;

      let old_carded = self.carded;
      self.carded = unit || null;

      if (old_carded !== unit) {
        if (old_carded)
          old_carded.off('change', card.listener);
        if (unit)
          unit.on('change', card.listener = () => self.drawCard(unit));
      }

      if (unit) {
        mask = new PIXI.Graphics();
        mask.drawRect(0,0,88,60);

        //
        //  Status Detection
        //
        if (unit.mHealth === -unit.health) {
          notice = 'Dead!';
        }
        else {
          notice = unit.notice;
        }

        if (!notice && unit.mRecovery)
          notice = 'Wait '+unit.mRecovery+' Turn'+(unit.mRecovery > 1 ? 's' : '')+'!';

        if (unit.poisoned) {
          notices.push('Poisoned!');
          important++;
        }

        if (unit.paralyzed) {
          notices.push('Paralyzed!');
          important++;
        }

        if (unit.canSpecial())
          notices.push('Enraged!');

        if (unit.barriered) {
          notices.push('Barriered!');
          important++;
        }

        if (unit.focusing) {
          notices.push('Focused!');
          important++;
        }

        if (unit.mBlocking < 0)
          notices.push('Vulnerable!');

        if (unit.health + unit.mHealth < unit.health * 0.4) {
          notices.push('Dying!');
        }
        else if (unit.mHealth < 0) {
          notices.push('Hurt!');
        }
        else {
          notices.push(unit.title || 'Ready!');
        }

        if (!notice) {
          notice = notices.shift();
          important--;
        }

        if (important > 0)
          notice += ' +';

        //
        //  Draw the top part of the card.
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
        //  Draw the first layer of the bottom part of the card.
        //
        els.layer1.visible = true;

        els.health.text = (unit.health + unit.mHealth)+'/'+unit.health;

        if (unit.blocking) {
          if (unit.mBlocking) {
            els.block.text = unit.blocking;

            if (unit.mBlocking > 0) {
              els.mBlock.text = '+'+Math.round(unit.mBlocking)+'%';
              els.mBlock.style.fill = '#00FF00';
            }
            else {
              els.mBlock.text = Math.round(unit.mBlocking)+'%';
              els.mBlock.style.fill = '#FF0000';
            }

            els.block.updateText();
            els.mBlock.position.x = els.block.position.x + els.block.width;
          }
          else {
            els.block.text = unit.blocking+'%';
            els.mBlock.text = '';
          }
        }
        else {
          els.block.text = '---';
          els.mBlock.text = '';
        }

        els.power.text = unit.power || '--';

        if (unit.mPower) {
          if (unit.mPower > 0) {
            els.mPower.text = '+'+unit.mPower;
            els.mPower.style.fill = '#00FF00';
          }
          else {
            els.mPower.text = unit.mPower;
            els.mPower.style.fill = '#FF0000';
          }

          els.power.updateText();
          els.mPower.position.x = els.power.position.x + els.power.width;
        }
        else {
          els.mPower.text = '';
        }

        els.armor.text = unit.armor;

        if (unit.mArmor) {
          if (unit.mArmor > 0) {
            els.mArmor.text = '+'+unit.mArmor;
            els.mArmor.style.fill = '#00FF00';
          }
          else {
            els.mArmor.text = unit.mArmor;
            els.mArmor.style.fill = '#FF0000';
          }

          els.armor.updateText();
          els.mArmor.position.x = els.armor.position.x + els.armor.width;
        }
        else {
          els.mArmor.text = '';
        }

        //
        //  Draw the 2nd layer of the bottom part of the card.
        //
        els.layer2.visible = false;

        els.ability.text = unit.ability;
        els.specialty.text = unit.specialty || 'None';

        //
        //  Draw the 3rd layer of the bottom part of the card.
        //
        els.layer3.visible = false;

        els.recovery.text = 'Recovery  '+unit.mRecovery+'/'+unit.recovery;
        els.notice1.text = notices.length ? notices.shift() : '---';
        els.notice2.text = notices.length ? notices.shift() : '---';
        els.notice3.text = notices.length ? notices.shift() : '---';

        card.stage.buttonMode = true;
        card.render();
      }
      else if (self.notice) {
        if (trophy === undefined)
          trophy = new Tactics.Unit(19);

        unit = trophy;
        mask = new PIXI.Graphics();
        mask.drawRect(0,0,88,60);

        //
        //  Draw the top part of the card.
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
      else if (!old_carded) {
        return self;
      }

      return self.emit({
        type:   'card-change',
        ovalue: old_carded,
        nvalue: unit,
      });
    },
    eraseCard: function () {
      card.stage.buttonMode = false;

      if (self.carded) self.carded.off('change',card.listener);
      self.emit({type:'card-change',ovalue:self.carded,nvalue:null});
      self.carded = null;

      return self;
    },

    addTeams: function (teams) {
      teams.forEach((team, i) => {
        self.teams.push({color:team.c,units:[],bot:team.b ? new Tactics.Bot(team.b) : null});

        Object.keys(team.u).forEach(coords => {
          var uData = team.u[coords];
          var x = coords.charCodeAt(0)-97;
          var y = coords.charCodeAt(1)-97;
          var degree = self.getDegree('N',self.rotation);
          var data = Object.assign({},
            uData,self.getUnitRotation(degree, self.getTile(x,y), uData.d)
          );

          self.addUnit(i,data);
        });
      });

      return self;
    },
    dropTeams: function () {
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

    addUnit: function (teamId,udata) {
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
    dropUnit: function (unit) {
      var tUnits = self.teams[unit.team].units;

      if (unit == self.focused) {
        unit.blur();
        self.focused = null;
      }

      if (unit == self.viewed) {
        unit.deactivate();
        self.viewed = null;
      }

      if (unit == self.selected) {
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
    rotate: function (rotation) {
      var units = [];
      var degree = self.getDegree(self.rotation,rotation);

      self.teams.forEach(t => Array.prototype.push.apply(units, t.units));

      // First, reset all tiles.
      if (self.selected && !self.viewed) self.selected.hideMode();
      if (self.viewed) self.viewed.hideMode();

      units.forEach(u => u.assignment.dismiss());

      units.forEach(unit => {
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

    setSelectMode: function (mode) {
      var team = self.teams[self.turns[0]];

       if (self.viewed)
         if (!team.bot)
           self.viewed.activate(mode, true);
         else
           self.viewed.activate();
       else if (self.selected)
         if (!team.bot)
           self.selected.activate(mode);
         else
           self.selected.activate();

      // I got tired of seeing button borders and glow changes during bot turns.
      if (!team || !team.bot)
        self.emit({
          type:   'select-mode-change',
          ovalue: self.selectMode,
          nvalue: mode,
        });

      self.selectMode = mode;

      return self;
    },
    //
    // A unit is only selectable if...
    //   1) The unit belongs to the team that is playing its turn.
    //   2) The unit has completely recovered.
    //   3) Another unit on the same team has not already attacked this turn.
    //
    select: function (unit) {
      var selected = self.selected;
      var viewed = self.viewed;
      var mode;

      if (unit === viewed) return self.drawCard();

      if (viewed) {
        viewed.deactivate();
        self.viewed = null;
      }

      if (unit == selected) {
        if (selected.activated == 'direction') {
          mode = 'turn';
        }
        else if (selected.activated == 'target') {
          mode = 'attack';
        }
        else {
          mode = selected.activated;

          if (viewed) unit.showMode();
        }
      }
      else {
        // Do what a unit can can[].
        let can = [];
        if (unit.canMove())
          can.push('move');
        if (unit.canAttack())
          can.push('attack');
        if (unit.canTurn())
          can.push('turn');

        mode = self.selectMode;
        if (mode === null || can.indexOf(mode) === -1)
          mode = can.shift();

        let view_only = unit.team !== self.turns[0]
          || unit.mRecovery > 0
          || unit.paralyzed !== false
          || (selected && selected.attacked && selected !== unit);

        if (view_only) {
          if (selected && !viewed) selected.hideMode();
          self.viewed = unit;
        }
        else {
          if (selected) selected.reset();
          self.selected = unit;
        }
      }

      self.setSelectMode(mode);

      return self.drawCard();
    },
    deselect: function (reset) {
      var selected = self.selected;
      var viewed = self.viewed;
      var team = self.teams[self.turns[0]];

      if (reset) {
        if (selected) selected.deactivate();
        self.selected = null;

        if (viewed) viewed.deactivate();
        self.viewed = null;
      }
      else if (team.bot) {
        if (selected) selected.deactivate();
        self.selected = null;
      }
      else if (viewed) {
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
      else if (selected && !selected.attacked) {
        // Cancel any deployment or turning then deselect.
        selected.reset();
        self.selected = null;

        if (selected.activated !== 'move')
          self.setSelectMode('move');
      }
      else
        return self;

      if (selected !== self.selected || viewed !== self.viewed)
        self.drawCard();

      return self;
    },

    startTurn: function () {
      var teamId = self.turns[0];
      var bot = self.teams[teamId].bot;

      if (bot) {
        self.lock();

        // Give the page a chance to render the effect of locking the board.
        setTimeout(() => {
          bot.startTurn(teamId).then(record => {
            self.record = record;

            if (Tactics.debug) return;
            self.endTurn();
          });
        }, 100);
      }
      else {
        self.unlock();
        self.notice = 'Your Turn!';
        self.drawCard();
      }
    },
    endTurn: function () {
      var turns = self.turns;
      var teamId = turns[0];
      var decay,recovery;
      var selected = self.selected,attacked,deployed;

      self.notice = undefined;

      // First remove dead teams from turn order.
      self.teams.forEach((team, t) => {
        if (team.units.length) return;
        if (turns.indexOf(t) === -1) return;

        turns.splice(turns.indexOf(t),1);

        // If the player team was killed, he can take over for a bot team.
        if (!self.teams[t].bot) {
          for (let i = 0; i < self.teams.length; i++) {
            if (!self.teams[i].units.length) continue;
            self.teams[i].bot = 0;
            break;
          }
        }
      });

      // Recover and decay blocking modifiers
      decay = self.turns.length;
      if (self.teams[4] && self.teams[4].units.length) decay--;

      self.teams.forEach((team, t) => {
        team.units.forEach(unit => {
          if (unit.mRecovery && t == teamId) unit.mRecovery--;
          if (teamId !== 4 && unit.mBlocking) {
            unit.mBlocking *= 1 - 0.2/decay;
            if (Math.abs(unit.mBlocking) < 2) unit.mBlocking = 0;
          }
        });
      });

      if (selected) {
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

    lock: function () {
      if (self.locked) return;
      self.locked = true;

      self.tiles.forEach(tile => tile.set_interactive(false));

      self.emit({
        type:   'lock-change',
        ovalue: false,
        nvalue: true,
      });
    },
    unlock: function () {
      if (!self.locked) return;
      self.locked = false;

      self.tiles.forEach(tile => {
        tile.set_interactive(!!(tile.action || tile.assigned));

        if (tile.focused && tile.assigned) {
          tile.assigned.focus();
        }
      });

      self.emit({
        type:   'lock-change',
        ovalue: true,
        nvalue: false,
      });
    },

    calcTeams: function () {
      var choices = [];

      self.teams.forEach((team, id) => {
        var thp = 50*3,chp = 0;
        if (id === 4) return; // Team Chaos
        if (team.units.length === 0) return;

        team.units.forEach(unit => 
          chp += unit.health + unit.mHealth
        );

        choices.push({
          id:     id,
          color:  team.color,
          units:  team.units,
          score:  chp / thp,
          size:   team.units.length,
          random: Math.random()
        });
      });

      return choices;
    },
    getWinningTeams: function () {
      var teams = self.calcTeams();

      teams.sort((a, b) => (b.score - a.score) || (b.size - a.size) || (a.random - b.random));

      return teams;
    },
    getLosingTeam: function () {
      var teams = self.calcTeams();

      teams.sort((a, b) => (a.score - b.score) || (a.size - b.size) || (a.random - b.random));

      return self.teams[teams[0].id];
    },

    reset: function () {
      self.dropTeams();
      self.eraseCard();

      return self.setSelectMode('move');
    },
    save: function () {
      var teams = [];

      self.teams.forEach(team => {
        var tdata = {c:team.color,b:team.bot ? 1 : 0,u:{}};

        team.units.forEach(unit => {
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

      return {
        teams: teams,
        turns: self.turns,
      };
    },

    showResults: function (results) {
      if (!Array.isArray(results))
        results = [results];

      let showResult = result => {
        let anim = new Tactics.Animation();
        let unit = result.unit;

        self.drawCard(unit);

        let change = Object.assign({}, result);

        // Changed later
        change.notice = null;
        delete change.mHealth;

        // Not changes
        delete change.miss;

        unit.change(change);

        if (result.miss) {
          unit.change({notice: 'Miss!'});
          let caption = result.notice || 'Miss!';
          return unit.animCaption(caption).play();
        }

        if (result.focusing) {
          let caption = result.notice;
          let index = anim.frames.length;
          if (caption)
            anim.splice(index, unit.animCaption(caption, options));
          anim.splice(index, unit.animFocus());

          return anim.play();
        }

        // Detect and animate a loss of focus
        if (unit.focusing)
          if (result.poisoned || result.paralyzed || (result.mHealth && result.mHealth < unit.mHealth))
            anim.splice(unit.animBreakFocus());

        if (result.paralyzed) {
          let caption = result.notice || 'Paralyzed!';
          let index = anim.frames.length;
          anim.splice(index, unit.animCaption(caption, options));
          anim.splice(index, unit.animFocus());

          return anim.play();
        }

        if (result.poisoned) {
          let caption = result.notice || 'Poisoned!';
          let index = anim.frames.length;
          anim.splice(index, unit.animCaption(caption, options));
          anim.splice(index, unit.animFocus());

          return anim.play();
        }

        if ('mHealth' in result) {
          let increment;
          let options = {};

          if (result.mHealth > unit.mHealth)
            options.color = '#00FF00';
          else if (result.mHealth < unit.mHealth && result.mHealth !== -unit.health)
            options.color = '#FFBB44';

          // Die if the unit is dead.
          if (result.mHealth === -unit.health) {
            let caption = result.notice || 'Nooo...';
            anim
              .splice(unit.animCaption(caption, options))
              .splice(unit.animDeath(self));

            return anim.play();
          }

          let diff = unit.mHealth - result.mHealth;
          let caption = result.notice || Math.abs(diff).toString();
          anim.splice(0, unit.animCaption(caption, options));

          // Animate a change in health over 1 second (12 frames)
          if (result.mHealth !== unit.mHealth) {
            let progress = unit.mHealth;

            anim.splice(0, [
              {
                script: () => {
                  progress += (diff / 8) * -1;
                  unit.change({
                    mHealth: Math.round(progress),
                    notice:  Math.round(unit.health + progress),
                  });
                },
                repeat: 8,
              },
              // Pause to reflect upon the new health amount
              {
                script: () => {},
                repeat: 4,
              },
            ]);
          }

          return anim.play();
        }
      };

      return results.reduce(
        (promise, result) => promise.then(() =>
          showResult(result))
            .then(() => result.unit.change({notice: null})),
        Promise.resolve(),
      ).then(() => self.drawCard());
    },

    clearHighlight: function () {
      highlighted.forEach(highlight => {
        var tile = highlight.tile;

        if (tile.focused && tile.assigned && !self.locked)
          tile.paint('focus', 0.3);
        else
          tile.strip();

        // Only deactivate units that have a mode in case one of them is the attacker.
        if (tile.action == 'target' && tile.assigned && tile.assigned.activated === true)
          tile.assigned.deactivate();

        if (tile.action) {
          tile.action = '';
          tile.set_interactive(!!tile.assigned);
          tile.off('select', highlight.select);
          tile.off('focus',  highlight.focus);
          tile.off('blur',   highlight.blur);
        }
      });

      highlighted = [];
    },
    setHighlight: function (highlight, viewed) {
      var tile = highlight.tile;

      if (highlighted.find(h => h.tile === tile))
        throw new Error('Attempt made to highlight highlighted tile');

      let alpha =
        viewed ? 0.15 :
        tile.focused ? 0.6 : 0.3;

      tile.paint(highlight.action, alpha, highlight.color);

      if (!viewed) {
        tile.action = highlight.action;
        tile.set_interactive(true);
        tile.on('select', highlight.select);
        tile.on('focus',  highlight.focus);
        tile.on('blur',   highlight.blur);
      }

      highlighted.push(highlight);
    }
  });

  return self;
};
