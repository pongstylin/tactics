(function ()
{
  // Bot class.
  Tactics.Bot.Chaos = function (options)
  {
    var self = this;
    var board = Tactics.board;
    var agent;

    $.extend(self,
    {
      startTurn:function (teamId)
      {
        var deferred = $.Deferred();

        self.team = board.teams[teamId];
        agent = self.team.units[0];

        if (agent.type === 15)
        {
          agent.phase().done(function ()
          {
            deferred.resolve();
          });
        }
        else
        {
          self.startTurnDragon(teamId).then(agent.phase).done(function ()
          {
            deferred.resolve();
          });
        }

        return deferred.promise();
      },
      startTurnDragon:function (teamId)
      {
        self.choices = [];
        self.friends = [agent];
        self.enemies = [];

        $.each(board.teams,function (i,team)
        {
          $.each(team.units,function (i,unit)
          {
            unit.id = unit.assignment.id;
          });

          if (team.color === self.team.color) return;
          Array.prototype.push.apply(self.enemies,team.units);
        });

        // Give the card time to fade.
        setTimeout(function ()
        {
          var calc;

          self.addChoice(self.calcTeamFuture(teamId));

          if (self.inRange())
          {
            self.considerUnit();
          }
          else
          {
            self.considerPosition(teamId);

            if (agent.mRecovery === 0 && agent.mHealth < 0)
            {
              self.choices[0].first = 'attack';
              self.choices[0].target = agent.assignment;
            }

            self.endTurn();
          }
        },1000);

        self.deferred = $.Deferred();
        return self.deferred.promise();
      },
      considerUnit:function ()
      {
        var unit = self.friends.pop();
        var start = unit.assignment;
        var direction = unit.direction;
        var tile,tiles;
        var target;
        var i;

        if (unit.mRecovery === 0)
        {
          self.considerTurnOnly(unit);

          if (target = self.considerTarget(unit))
            self.considerAttackOnly(unit,target);
          if (unit.mHealth < 0)
            self.considerSpecialOnly(unit);

          tiles = unit.getMoveTiles();

          for (i=0; i<tiles.length; i++)
          {
            unit.assign(tile = tiles[i]);

            if (target)
              self.considerAttackFirst(unit,tile,target);
            if (unit.mHealth < 0)
              self.considerSpecialFirst(unit,tile,start);
            self
              .considerMoveFirst(unit,tile)
              .considerMoveOnly(unit,tile);
          }

          unit.assign(start);
          unit.direction = direction;
          unit.mRecovery = 0;
        }

        // Use setTimeout to give the browser a chance to think while we think.
        if (self.friends.length)
          setTimeout(self.considerUnit,10);
        else
          self.endTurn();

        return self;
      },
      considerSpecialOnly:function (unit)
      {
        var mHealth = unit.mHealth;
        unit.mRecovery = Math.ceil(unit.recovery / 2);
        unit.mHealth += unit.power;
        if (unit.mHealth > 0) unit.mHealth = 0;

        self.addChoice($.extend
        ({
          unit:unit,
          first:'attack',
          target:unit.assignment,
          direction:self.considerDirection(unit)
        },self.calcTeamFuture(unit.team)));

        unit.mHealth = mHealth;
        return self;
      },
      considerSpecialFirst:function (unit,end,target)
      {
        var mHealth = unit.mHealth;
        unit.mRecovery = unit.recovery;
        unit.mHealth += unit.power;
        if (unit.mHealth > 0) unit.mHealth = 0;

        self.addChoice($.extend
        ({
          unit:unit,
          end:end,
          first:'attack',
          target:target,
          direction:self.considerDirection(unit)
        },self.calcTeamFuture(unit.team)));

        unit.mHealth = mHealth;
        return self;
      },
    });

    return self;
  };

})();
