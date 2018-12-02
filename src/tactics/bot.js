(function ()
{
  // Bot class.
  Tactics.Bot = function (subclass)
  {
    var self = this;
    var board = Tactics.board;
    var painted = [];

    function paint(tile,color)
    {
      tile.paint('memory',0.2,color);
      painted.push(tile);
    }

    function select(data) {
      board.select(data.unit);
      paint(data.unit.assignment);

      if (data.first)
        return Promise.resolve(data);

      return new Promise((resolve, reject) => {
        // Give the user 2 seconds to see the card.
        data.unit.notice = 'I pass!';
        board.drawCard(data.unit);

        setTimeout(() => {
          data.unit.notice = null;
          resolve(data);
        }, 2000);
      });
    }

    function deploy(data) {
      if (data.unit.mHealth === -data.unit.health) return data;
      if (!data.end) return data;

      return new Promise((resolve, reject) => {
        setTimeout(() => {
          data.unit.deploy(data.end).then(() => {
            paint(data.end, 0x0088FF);
            resolve(data);
          });
        }, 2000);
      });
    }

    function attack(data) {
      var target = data.target, atype;

      if (!target) return data;

      // Show a preview of what the attack chances are.
      if (target.assigned) board.drawCard(target.assigned);

      atype = target.assigned === data.unit ? 'special' : 'attack';

      return new Promise((resolve, reject) => {
        setTimeout(() => {
          data.unit[atype](target).then(() => {
            paint(data.target, 0xFF8800);
            resolve(data);
          });
        }, 2000);
      });
    }

    function turn(data) {
      var target = data.target;

      if (data.unit.mHealth === -data.unit.health) return data;
      if (!data.direction) return data;

      // View the results of the attack, if one was made.
      if (target && target.assigned) board.drawCard(target.assigned);

      return new Promise((resolve, reject) => {
        setTimeout(() => {
          data.unit.turn(data.direction).activate('direction');
          resolve(data);
        }, 2000);
      });
    }

    $.extend(self,
    {
      startTurn:function (teamId)
      {
        self.team = board.teams[teamId];
        self.choices = [];
        self.friends = [];
        self.enemies = [];

        $.each(board.teams,function (i,team)
        {
          if (team.units.length === 0) return;

          $.each(team.units,function (i,unit)
          {
            unit.id = unit.assignment.id;
          });

          if (i === 4)
          {
            if (team.color === self.team.color)
            {
              // Don't attack dragon.
              if (team.units[0].type === 22)
                return;
            }
            else
            {
              // Don't attack seed.
              if (team.units[0].type === 15)
                return;
            }
          }

          Array.prototype.push.apply(
            i === teamId ? self.friends : self.enemies,
            team.units
          );
        });

        // Give the card time to fade.
        setTimeout(() => {
          var calc;

          self.addChoice(self.calcTeamFuture(teamId));

          if (self.inRange()) {
            self.considerUnit();
          }
          else {
            self.considerPosition(teamId);
            self.endTurn();
          }
        }, 1000);

        self.deferred = $.Deferred();
        return self.deferred.promise();
      },
      endTurn: function () {
        var choices = self.choices,unit;
        var first = choices[0];
        var chosen;
        var start;

        if (choices.length === 1) {
          chosen = choices[0];

          // If all units have turn wait, use the first team unit when passing.
          if (!chosen.unit) chosen.unit = board.teams[board.turns[0]].units[0];
        }
        else {
          choices.sort((a, b) => {
            // Hack to prioritize seed attacks.
            var as = 0,bs = 0;
            // Hack to make sure bot actually attacks.
            var at = 0,bt = 0;

            if (a.target && a.target.assigned.type === 15) as++;
            if (b.target && b.target.assigned.type === 15) bs++;

            if (a.target && a.target !== a.unit.assignment) {
              at = a.unit.calcThreat(a.target.assigned,a.first === 'attack' ? a.unit.assignment : a.end);
              at = at.chance <= 20 ? 0 : at.threat;
            }
            if (b.target && b.target !== b.unit.assignment) {
              bt = b.unit.calcThreat(b.target.assigned,b.first === 'attack' ? b.unit.assignment : b.end);
              bt = bt.chance <= 20 ? 0 : bt.threat;
            }

            return (bs - as)
              || (a.losses - b.losses)
              || (bt - at)
              || (b.weight - a.weight)
              || (a.threats - b.threats)
              || (b.random - a.random); 
          });
          chosen = choices[0];
          // If we are passing or the equivalent, then try to get a better position.
          if (first.defense === chosen.defense && first.offense === chosen.offense) {
            self.friends = board.teams[board.turns[0]].units.slice();
            self.considerPosition();
            chosen = self.choices[0];
          }
        }

        //
        // Now put our decisions into action.
        //
        if (chosen.first == 'move')
          order = [deploy, attack];
        else
          order = [attack, deploy];

        select(chosen)
          .then(order[0])
          .then(order[1])
          .then(turn)
          .then(data => {
            setTimeout(() => {
              painted.forEach(tile => {
                if (tile.assigned && tile.focused)
                  tile.paint('focus', 0.3);
                else
                  tile.strip();
              });

              self.deferred.resolve();
            }, 2000);

            return chosen;
          });

        return self;
      },
      // Find the closest enemy unit and move the furthest friendly unit closer to the closest friendly unit.
      considerPosition: function () {
        var choices = [];
        var choice;

        if (!self.enemies.length) return;

        //
        // Determine the unit that is closest to an enemy.
        //
        self.friends.forEach(friend => {
          self.enemies.forEach(enemy => {
            var weight = board.getDistance(enemy.assignment,friend.assignment);

            if (enemy.type === 15) return;

            choices.push({
              enemy:  enemy,
              friend: friend,
              weight: weight + Math.random()
            });
          });
        });

        choices.sort(function (a,b) { return a.weight-b.weight; });
        choice = choices[0];

        if (self.friends.length > 1)
        {
          choices = [];

          //
          // Determine unit that is furthest from the chosen friend and enemy.
          //
          $.each(self.friends,function (i,friend)
          {
            if (friend === choice.friend) return;

            choices.push
            ({
              unit:friend,
              distance:
                board.getDistance(friend.assignment,choice.friend.assignment) +
                board.getDistance(friend.assignment,choice.enemy.assignment) +
                Math.random()
            });
          });

          choices.sort(function (a,b)
          {
            return a.mRecovery-b.mRecovery || b.distance-a.distance;
          });

          choice.unit = choices[0].unit;
        }
        else
        {
          if (choice.friend.mRecovery) return self;
          choice.unit = choice.friend;
        }

        choices = [];

        if (!choice.unit.mRecovery)
        {
          //
          // Reinforce: Move the furthest ready unit as close as possible.
          //
          $.each(choice.unit.getMoveTiles(),function (i,tile)
          {
            var distance = board.getDistance(tile,choice.enemy.assignment);

            if (self.friends.length > 1)
              distance += board.getDistance(tile,choice.friend.assignment);

            choices.push
            ({
              end:tile,
              distance:distance + Math.random()
            });
          });
        }
        else if (!choice.friend.mRecovery)
        {
          //
          // Fallback: Move the closest unit closer to the furthest unit.
          //
          $.each(choice.friend.getMoveTiles(),function (i,tile)
          {
            var distance = board.getDistance(tile,choice.unit.assignment);

            choices.push
            ({
              end:tile,
              distance:distance + Math.random()
            });
          });

          choice.unit = choice.friend;
        }

        choices.sort(function (a,b) { return a.distance-b.distance; });

        choice.start = choice.unit.assignment;
        choice.end = choices[0].end;

        choice.unit.assign(choice.end);
        choice.unit._direction = choice.unit.direction;

        choice.direction = self.considerDirection(choice.unit);

        choice.unit.assign(choice.start);
        choice.unit.direction = choice.unit._direction;

        self.choices =
        [{
          first:'move',
          unit:choice.unit,
          end:choice.end,
          direction:choice.direction
        }];

        return self;
      },
      considerUnit: function () {
        var unit      = self.friends.pop();
        var start     = unit.assignment;
        var direction = unit.direction;
        var tile,tiles;
        var target;

        if (unit.mRecovery === 0) {
          self.considerTurnOnly(unit);

          if (target = self.considerTarget(unit))
            self.considerAttackOnly(unit,target);
          //self.considerSpecialOnly(unit,tile,target);

          tiles = unit.getMoveTiles();

          for (let i = 0; i < tiles.length; i++) {
            unit.assign(tile = tiles[i]);

            if (target)
              self.considerAttackFirst(unit,tile,target);
            //self.considerSpecialFirst(unit,tile,target);
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
      considerTurnOnly:function (unit)
      {
        var fdirection = unit.direction;
        var tdirection = self.considerDirection(unit);

        if (fdirection === tdirection) return self;

        self.addChoice($.extend({
          unit:unit,
          first:'turn',
          direction:tdirection,
        },self.calcTeamFuture(unit.team)));

        return self;
      },
      considerAttackOnly:function (unit,target)
      {
        unit.mRecovery = Math.ceil(unit.recovery / 2);

        self.addChoice($.extend
        ({
          unit:unit,
          first:'attack',
          target:target.tile,
          direction:self.considerDirection(unit),
        },self.calcTeamFuture(unit.team,target)));

        return self;
      },
      considerAttackFirst:function (unit,end,target)
      {
        unit.mRecovery = unit.recovery;

        self.addChoice($.extend
        ({
          unit:unit,
          end:end,
          first:'attack',
          target:target.tile,
          direction:self.considerDirection(unit),
        },self.calcTeamFuture(unit.team,target)));

        return self;
      },
      considerMoveFirst:function (unit,end)
      {
        var target;

        if (!(target = self.considerTarget(unit))) return self;

        unit.mRecovery = unit.recovery;

        self.addChoice($.extend
        ({
          unit:unit,
          end:end,
          first:'move',
          target:target.tile,
          direction:self.considerDirection(unit,target),
        },self.calcTeamFuture(unit.team,target)));

        return self;
      },
      considerMoveOnly:function (unit,end)
      {
        unit.mRecovery = Math.floor(unit.recovery / 2);

        self.addChoice($.extend
        ({
          unit:unit,
          end:end,
          first:'move',
          direction:self.considerDirection(unit),
        },self.calcTeamFuture(unit.team)));

        return self;
      },
      considerDirection:function (unit,target)
      {
        var turns = board.turns.slice();
        var directions = ['N','S','E','W'];
        var d,direction = {N:Math.random(),S:Math.random(),E:Math.random(),W:Math.random()};
        var choices = [];
        var enemies = self.enemies;
        var i,t,w;

        turns.push(turns.shift());

        for (i=0; i<directions.length; i++)
        {
          unit.direction = directions[i];

          choices.push
          ({
            direction:directions[i],
            weight   :unit.calcDefense(turns),
            random   :Math.random()
          });
        }

        choices.sort(function (a,b) { return (b.weight-a.weight) || (b.random-a.random); });

        if (choices[0].weight === choices[3].weight)
        {
          // If all directions are equally defensible, pick something intelligent.
          for (i=0; i<enemies.length; i++)
          {
            d = board.getDirection(unit.assignment,enemies[i].assignment);
            t = enemies[i].calcThreatTurns(unit);
            w = 1;

            if (t  <  unit.mRecovery) w += 99;
            if (t === unit.mRecovery && turns.indexOf(enemies[i].team) < turns.indexOf(unit.team)) w += 99;

            if (d.length == 1)
            {
              direction[d.charAt(0)] += w;
            }
            else
            {
              direction[d.charAt(0)] += w;
              direction[d.charAt(1)] += w;
            }
          }

          directions.sort(function (a,b) { return direction[b]-direction[a]; });

          return unit.direction = directions[0];
        }
        else if (target && choices[0].weight === choices[1].weight)
        {
          d = board.getDirection(unit.assignment,target.tile);

          if (d === choices[0].direction) return unit.direction = choices[0].direction;
          if (d === choices[1].direction) return unit.direction = choices[1].direction;
        }

        return unit.direction = choices[0].direction;
      },
      considerTarget:function (unit)
      {
        var tile,tiles;
        var target,targets = [];
        var i,mRecovery;

        tiles = unit.getAttackTiles();

        for (i=0; i<tiles.length; i++)
        {
          tile = tiles[i];

          if (!(target = tile.assigned) || self.enemies.indexOf(target) === -1) continue;

          // Set defense to zero to try to priorize target.
          if (target.type === 15)
            targets.push({tile:tile,target:target,defense:0,random:Math.random()});
          else
            targets.push({tile:tile,target:target,defense:target.calcDefense(),random:Math.random()});
        }

        if (!targets.length) return;
        targets.sort(function (a,b)
        {
          return (a.defense-b.defense) || (a.random-b.random);
        });
        target = targets[0];

        $.extend(target,unit.calcThreat(target.target,unit.assignment));

        return target;
      },
      inRange:function ()
      {
        var friends = self.friends;
        var enemies = self.enemies;
        var i,j;

        for (i=0; i<friends.length; i++)
        {
          for (j=0; j<enemies.length; j++)
          {
            if (friends[i].calcThreatTurns(enemies[j]) < 1 || enemies[j].calcThreatTurns(friends[i]) < 1)
              return 1;
          }
        }

        return 0;
      },
      calcTeamFuture:function (teamId,target)
      {
        var calc = [];
        var turns = board.turns.slice();
        var teams = board.teams;
        var funit,funits,eunit,eunits;
        var fdamages = {},fdamage,ftotal,eclaim;
        var i,j,k,l,fsum,tsum,cnt,losses,threat,threats;

        // Calculate the figures after this turn ends.
        turns.push(turns.shift());

        // Calculate the defense score for each team.
        for (i=0; i<teams.length; i++)
        {
          funits = teams[i].units;
          ftotal = [];

          // Calculate the total damage that can be inflicted on each unit.
          for (j=0; j<funits.length; j++)
          {
            funit = funits[j];
            fsum = target && target.target === funit ? target.damage : 0;
            fdamages[funit.id] = [];

            // Consider every enemy that can attack before recovery.
            for (k=0; k<teams.length; k++)
            {
              fdamages[funit.id].push([]);

              // If the same team, not an enemy
              if (k === i) continue;

              // if the same color, not an enemy
              if (teams[k].color === teams[i].color) continue;

              eunits = teams[k].units;

              for (l=0; l<eunits.length; l++)
              {
                eunit = eunits[l];

                // A dead man is not a threat.
                if (target && target.target === eunit && target.threat === 100) continue;

                cnt = eunit.calcThreatTurns(funit,1);
                if (cnt  >  funit.mRecovery) continue;
                if (cnt === funit.mRecovery && turns.indexOf(k) > turns.indexOf(i)) continue;

                threat = eunit.calcThreat(funit,null,turns);
                if (threat.damage)
                {
                  fdamages[funit.id][k].push
                  ({
                    unit:eunit,
                    turns:threat.turns+1-eunit.mRecovery,
                    damage:threat.damage
                  });
                }
              }

              // Prioritize the hardest hitters with fewest turns.
              // NOTE: There is a problem where 1 unit 2 turns away will be sorted
              //       before 2 units 1 turn away (and would do less damage)
              fdamages[funit.id][k].sort(function (a,b)
              {
                return (b.damage-a.damage) || (a.turns-b.turns);
              });

              // The number of times we can attack before recovery.
              cnt = funit.mRecovery;
              // We can attack one more time if enemy turn comes first.
              if (turns.indexOf(i) > turns.indexOf(k)) cnt++;

              for (l=0; l<fdamages[funit.id][k].length; l++)
              {
                if (l === cnt) break;
                fsum += fdamages[funit.id][k][l].damage;
              }
            }

            // Calculate total damage.
            ftotal.push({unit:funit,damage:fsum});
          }

          // Pick the unit that is most in danger, claiming all attackers.
          // Pick the next unit most in danger, claiming unclaimed attackers.
          ftotal.sort(function (a,b) { return b.damage-a.damage; });
          losses = 0;
          tsum = 0;
          threats = target && target.target.team === i ? 1 : 0;
          eclaim = {};

          for (j=0; j<ftotal.length; j++)
          {
            funit = ftotal[j].unit;
            fsum = ((funit.mHealth + funit.health) / funit.health) * 100;

            if (target && target.target === funit)
              fsum -= target.damage;

            for (k=0; k<fdamages[funit.id].length; k++)
            {
              if (k === i) continue;
              threats += fdamages[funit.id][k].length;

              // The number of times we can attack before recovery.
              cnt = funit.mRecovery;
              // We can attack one more time if enemy turn comes first.
              if (turns.indexOf(k) < turns.indexOf(i)) cnt++;

              for (l=0; l<fdamages[funit.id][k].length; l++)
              {
                // Only attackers that can attack before he moves again count.
                if (!cnt) break;

                fdamage = fdamages[funit.id][k][l];
                if (fdamage.turns > cnt) continue;

                eunit = fdamage.unit;
                if (eunit.id in eclaim) continue;

                fsum -= fdamage.damage;
                eclaim[eunit.id] = 1;
                cnt -= fdamage.turns;
              }
            }

            if (fsum  <  0) fsum = 0;
            if (fsum === 0) losses++;
            tsum += fsum;
          }

          if (i === 4)
            calc.push({losses:losses,defense:tsum,offense:0,threats:threats});
          else
            calc.push({losses:losses,defense:tsum/3,offense:0,threats:threats});
        }

        for (i=0; i<teams.length; i++)
        {
          for (j=0; j<teams.length; j++)
          {
            if (i === j) continue;
            calc[i].offense += 100 - calc[j].defense;
          }

          calc[i].offense /= teams.length-1;
          calc[i].weight = (calc[i].offense + calc[i].defense) / 2;
          calc[i].random = Math.random();
        }

        return calc[teamId];
      },
      addChoice:function (choice)
      {
        self.choices.push(choice);
      }
    });

    if (subclass && subclass !== 1)
      Tactics.Bot[subclass].call(self);

    return self;
  };

})();
