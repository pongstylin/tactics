(function () {
  // Bot class.
  Tactics.Bot.Chaos = function (options) {
    var self = this;
    var game = Tactics.game;
    var agent;

    $.extend(self, {
      startTurn: function (team) {
        self.team = team;
        agent = self.team.units[0];

        if (agent.name === 'Chaos Seed') {
          let action = { type:'endTurn' };

          game.takeAction(action);
        }
        else
          self.startTurnDragon(team);
      },
      startTurnDragon: function (team) {
        self.choices = [];
        self.friends = [agent];
        self.enemies = [];

        game.teams.forEach(team => {
          if (team.colorId === self.team.colorId) return;

          self.enemies.push(...team.units);
        });

        // Give the card time to fade.
        setTimeout(() => {
          let calc;

          self.addChoice(self.calcTeamFuture(team));

          if (self.inRange())
            self.considerUnit();
          else {
            self.considerPosition();

            if (agent.mRecovery === 0 && agent.mHealth < 0) {
              self.choices[0].first  = 'attack';
              self.choices[0].target = agent.assignment;
            }

            self.endTurn();
          }
        }, 1000);
      },
      considerUnit: function () {
        var unit = self.friends.pop();
        var start = unit.assignment;
        var direction = unit.direction;
        var tile,tiles;
        var i;

        if (unit.mRecovery === 0) {
          self.considerTurnOnly(unit);

          let targetData = self.considerTarget(unit);
          if (targetData)
            self.considerAttackOnly(unit, targetData);
          if (unit.mHealth < 0)
            self.considerSpecialOnly(unit);

          tiles = unit.getMoveTiles();

          for (i=0; i<tiles.length; i++) {
            unit.assign(tile = tiles[i]);

            if (targetData)
              self.considerAttackFirst(unit, tile, targetData);
            if (unit.mHealth < 0)
              self.considerSpecialFirst(unit, tile, { tile:start });
            self
              .considerMoveFirst(unit, tile)
              .considerMoveOnly(unit, tile);
          }

          unit.assign(start);
          unit.direction = direction;
          unit.mRecovery = 0;
        }

        // Use setTimeout to give the browser a chance to think while we think.
        if (self.friends.length)
          setTimeout(self.considerUnit, 10);
        else
          self.endTurn();

        return self;
      },
      considerSpecialOnly: function (unit) {
        let mHealth = unit.mHealth;

        unit.mRecovery = Math.ceil(unit.recovery / 2);
        unit.mHealth   = Math.min(0, unit.mHealth + unit.power);

        self.addChoice(Object.assign({
          unit:      unit,
          first:     'attackSpecial',
          target:    unit.assignment,
          direction: self.considerDirection(unit)
        }, self.calcTeamFuture(unit.team)));

        unit.mHealth = mHealth;
        return self;
      },
      considerSpecialFirst: function (unit, end, targetData) {
        let mHealth = unit.mHealth;

        unit.mRecovery = unit.recovery;
        unit.mHealth   = Math.min(0, unit.mHealth + unit.power);

        self.addChoice(Object.assign({
          unit:      unit,
          first:     'attackSpecial',
          target:    targetData.tile,
          end:       end,
          direction: self.considerDirection(unit)
        }, self.calcTeamFuture(unit.team)));

        unit.mHealth = mHealth;
        return self;
      },
    });

    return self;
  };

})();
