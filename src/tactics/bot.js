(function ()
{
  // Bot class.
  Tactics.Bot = function (subclass)
  {
    var self = this;
    var game = Tactics.game;
    var board = game.board;
    var painted = [];

    /*
     * Get the turn order as an array of team IDs.
     * The first element of the array is the team ID of the current turn.
     */
    function getTurnOrder() {
      let teamIds = game.activeTeams.map(t => t.id);
      let index   = teamIds.findIndex(id => id === game.currentTeamId);

      return teamIds.slice(index, teamIds.length).concat(teamIds.slice(0, index));
    }

    function paint(tile, color) {
      tile.paint('memory', 0.2, color);
      painted.push(tile);
    }

    function select(data) {
      let unit = data.unit;

      if (data.first) {
        game.selected = unit;
        paint(unit.assignment);

        return Promise.resolve(data);
      }

      return new Promise((resolve, reject) => {
        // Give the user 2 seconds to see the card.
        unit.notice = 'I pass!';
        game.drawCard(unit);

        setTimeout(() => {
          unit.notice = null;
          resolve(data);
        }, 2000);
      });
    }

    function move(data) {
      let unit = data.unit;

      // Bail if the turn has ended prematurely.
      // Example: Killed by Chaos Seed in a counter-attack.
      let lastAction = data.actions[data.actions.length-1];
      if (lastAction && lastAction.type.startsWith('end'))
        return data;

      // Bail for attack-only choices.
      if (!data.end) return data;

      unit.activate(true);

      return new Promise((resolve, reject) => {
        setTimeout(() => {
          let action = {
            type: 'move',
            tile: data.end,
          };

          game.takeAction(action).then(actions => {
            data.actions.push(...actions);
            paint(data.end, 0x0088FF);

            resolve(data);
          });
        }, 2000);
      });
    }

    function attack(data) {
      let unit   = data.unit;
      let target = data.target;

      // Bail if the turn has ended prematurely (just in case)
      let lastAction = data.actions[data.actions.length-1];
      if (lastAction && lastAction.type.startsWith('end'))
        return data;

      // Bail for move- or turn-only choices.
      if (!target) return data;

      // Show a preview of what the attack chances are.
      if (target.assigned && target !== unit.assignment) {
        unit.onTargetFocus({ target:target });
        game.drawCard(target.assigned);
      }

      unit.activate(true);

      return new Promise((resolve, reject) => {
        setTimeout(() => {
          let action = {
            type: target === unit.assignment ? 'attackSpecial' : 'attack',
            tile: target,
          };

          game.takeAction(action).then(actions => {
            data.actions.push(...actions);
            paint(target, 0xFF8800);

            resolve(data);
          });
        }, 2000);
      });
    }

    function turn(data) {
      let unit   = data.unit;
      let target = data.target;

      // Bail if the turn has ended prematurely (just in case)
      // Example: Killed by Chaos Seed in a counter-attack.
      let lastAction = data.actions[data.actions.length-1];
      if (lastAction && lastAction.type.startsWith('end'))
        return data;

      // Bail for choices that don't involve turning.
      if (!data.direction) return data;

      // View the results of the attack, if one was made.
      if (target && target.assigned) game.drawCard(target.assigned);

      unit.activate(true);

      return new Promise((resolve, reject) => {
        setTimeout(() => {
          let action = {
            type:      'turn',
            direction: data.direction,
          };

          game.takeAction(action).then(actions => {
            data.actions.push(...actions);

            resolve(data);
          });
        }, 2000);
      });
    }

    // Obtain the maximum threat to defender before he recovers.
    function calcDefense (defender, turnOrder) {
      let enemyTeams = game.activeTeams, enemyTeam;
      let teamsDamages = [], damages;
      let damage = 0;
      let threat;
      let i,j;
      let units,unit;
      let cnt;
      let myTeamId = defender.team.id;
      let myColorId = defender.team.colorId;

      if (!turnOrder) turnOrder = getTurnOrder();

      for (i = 0; i < enemyTeams.length; i++) {
        // Don't consider defender's team or allied teams as enemies.
        enemyTeam = enemyTeams[i];
        if (enemyTeam.colorId === myColorId) continue;

        units = enemyTeam.units;
        damages = [];

        for (j=0; j<units.length; j++) {
          unit = units[j];
          cnt  = calcThreatTurns(unit, defender, 1);

          if (cnt  >  defender.mRecovery)
            continue;
          if (cnt === defender.mRecovery && turnOrder.indexOf(enemyTeam.id) > turnOrder.indexOf(myTeamId))
            continue;

          threat = calcThreat(unit, defender, null, turnOrder);
          if (threat.damage)
            damages.push({
              unit:   unit,
              turns:  threat.turns+1-unit.mRecovery,
              damage: threat.damage,
            });
        }

        if (damages.length) {
          damages.sort((a, b) => (b.damage - a.damage) || (a.turns - b.turns));

          teamsDamages.push({
            team:    enemyTeam,
            damages: damages,
          });
        }
      }

      for (i = 0; i < teamsDamages.length; i++) {
        enemyTeam = teamsDamages[i].team;
        damages   = teamsDamages[i].damages;

        // The number of times they can attack defender before recovery.
        cnt = defender.mRecovery;
        // Attackers can attack one more time if their turn comes first.
        if (turnOrder.indexOf(enemyTeam.id) < turnOrder.indexOf(myTeamId)) cnt++;

        for (j=0; j<damages.length; j++) {
          // Only attackers that can attack before he moves again count.
          if (!cnt) break;

          if (damages[j].turns > cnt) continue;

          damage += damages[j].damage;
          cnt -= damages[j].turns;
        }
      }

      return damage > 100 ? 0 : 100 - damage;
    }

    // How many turns until I can attack?
    // -1 may be returned if no movement required (unless simple is set)
    function calcThreatTurns(attacker, target, simple) {
      let turns = Math.ceil(
        (board.getDistance(attacker.assignment, target.assignment) - attacker.aRadius) / attacker.mRadius
      ) - 1;

      if (turns < 0 && (attacker.mRecovery || simple))
        return attacker.mRecovery;

      return turns + attacker.mRecovery;
    }

    /*
     * Calculate how threatening attacker is to defender.
     *
     * Note: If a tile is not provided, then it tries to find the best tile to
     * move to before attacking.  The logic is currently Knight-specific.
     */
    function calcThreat(attacker, defender, tile, turnOrder) {
      let calc = {};

      if (tile) {
        calc.from  = tile;
        calc.turns = 0;
      }
      else {
        if (!turnOrder) turnOrder = getTurnOrder();

        let tdirection = defender.direction;
        let directions = [
          board.getRotation(tdirection, 180),
          board.getRotation(tdirection, 90),
          board.getRotation(tdirection, 270),
          tdirection
        ];
        let path;

        for (let i = 0; i < directions.length; i++) {
          if (!(tile = defender.assignment[directions[i]])) continue;

          if (tile.assigned) {
            if (tile.assigned === attacker) {
              calc.from  = tile;
              calc.turns = 0;
              break;
            }
            continue;
          }

          if (attacker.mType === 'path') {
            if (!(path = board.findPath(attacker, tile))) continue;

            calc.turns = Math.ceil(path.length / attacker.mRadius) - 1;
          }
          else {
            calc.turns = Math.ceil(board.getDistance(attacker.assignment, tile) / attacker.mRadius) - 1;
          }

          calc.from = tile;

          // Knight and Chaos Dragon does not have to recover after just moving.
          //calc.turns += calc.turns * Math.floor(self.recovery / 2);

          // Only a legitimate threat if I can move to tile before defender can get away.
          if (defender.mRecovery > calc.turns)
            break;
          else if (defender.mRecovery === calc.turns)
            if (turnOrder.indexOf(defender.team.id) > turnOrder.indexOf(attacker.team.id))
              break;

          calc = {};
        }

        if (!calc.from)
          return {damage:0, threat:0, from:null, turns:null, chance:0};
      }

      let attack = attacker.calcAttack(defender, calc.from);

      calc.chance = attack.chance;
      calc.damage = (attack.damage / defender.health) * 100;
      if (calc.damage > 100) calc.damage = 100;

      calc.threat = (attack.damage / (defender.health + defender.mHealth)) * 100;
      if (calc.threat > 100) calc.threat = 100;

      // Factor in the chance that the attack may not hit.
      if (attack.chance < 100) {
        calc.damage *= attack.chance / 100;
        calc.threat *= attack.chance / 100;

        // Factor in the future benefit of getting additional blocking chance.
        // Actually, if we get hit, we lose blocking chance.  So now what?
        //if (threat < 100)
        //  threat *= 1 - defender.blocking/400;
      }

      return calc;
    }

    $.extend(self, {
      startTurn: function (team) {
        self.team    = team;
        self.choices = [];
        self.friends = [];
        self.enemies = [];

        game.activeTeams.forEach(team => {
          if (team === self.team)
            self.friends.push(...team.units);
          else {
            // To bots, Chaos is not always an enemy.
            if (team.name === 'Chaos') {
              let agent = team.units[0];
              if (agent.name === 'Chaos Seed') {
                // Don't attack Seed if off color
                if (team.colorId !== self.team.colorId)
                  return;
              }
              else if (agent.name === 'Chaos Dragon') {
                // Don't attack Dragon if on color
                if (team.colorId === self.team.colorId)
                  return;
              }
            }

            self.enemies.push(...team.units);
          }
        });

        // Give the card time to fade.
        setTimeout(() => {
          let calc;

          self.addChoice(self.calcTeamFuture(team));

          if (self.inRange()) {
            self.considerUnit();
          }
          else {
            self.considerPosition();
            self.endTurn();
          }
        }, 1000);
      },
      endTurn: function () {
        var choices = self.choices,unit;
        var first = choices[0];
        var chosen;
        var start;

        if (choices.length === 1) {
          chosen = choices[0];

          // If all units have turn wait, use the first team unit when passing.
          if (!chosen.unit) chosen.unit = game.currentTeam.units[0];
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
              at = calcThreat(a.unit, a.target.assigned, a.first === 'attack' ? a.unit.assignment : a.end);
              at = at.chance <= 20 ? 0 : at.threat;
            }
            if (b.target && b.target !== b.unit.assignment) {
              bt = calcThreat(b.unit, b.target.assigned, b.first === 'attack' ? b.unit.assignment : b.end);
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
            self.friends = game.currentTeam.units.slice();
            self.considerPosition();
            chosen = self.choices[0];
          }
        }

        //
        // Now put our decisions into action.
        //
        if (chosen.first == 'move')
          order = [move, attack];
        else
          order = [attack, move];

        chosen.actions = [];

        select(chosen)
          .then(order[0])
          .then(order[1])
          .then(turn)
          .then(data => {
            let lastAction = data.actions[data.actions.length-1];
            if (!lastAction || !lastAction.type.startsWith('end'))
              game.takeAction({ type:'endTurn' });

            painted.forEach(tile => {
              if (tile.assigned && tile.focused)
                tile.paint('focus', 0.3);
              else
                tile.strip();
            });
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
      considerTurnOnly: function (unit) {
        var fdirection = unit.direction;
        var tdirection = self.considerDirection(unit);

        if (fdirection === tdirection) return self;

        self.addChoice(Object.assign({
          unit:      unit,
          first:     'turn',
          direction: tdirection,
        }, self.calcTeamFuture(unit.team)));

        return self;
      },
      considerAttackOnly: function (unit, target) {
        unit.mRecovery = Math.ceil(unit.recovery / 2);

        self.addChoice(Object.assign({
          unit:      unit,
          first:     'attack',
          target:    target.tile,
          direction: self.considerDirection(unit),
        }, self.calcTeamFuture(unit.team, target)));

        return self;
      },
      considerAttackFirst: function (unit, end, targetData) {
        unit.mRecovery = unit.recovery;

        self.addChoice(Object.assign({
          unit:      unit,
          end:       end,
          first:     'attack',
          target:    targetData.tile,
          direction: self.considerDirection(unit),
        }, self.calcTeamFuture(unit.team, targetData)));

        return self;
      },
      considerMoveFirst: function (unit, end) {
        var target;

        if (!(target = self.considerTarget(unit))) return self;

        unit.mRecovery = unit.recovery;

        self.addChoice(Object.assign({
          unit:      unit,
          end:       end,
          first:     'move',
          target:    target.tile,
          direction: self.considerDirection(unit,target),
        }, self.calcTeamFuture(unit.team, target)));

        return self;
      },
      considerMoveOnly: function (unit, end) {
        unit.mRecovery = Math.floor(unit.recovery / 2);

        self.addChoice(Object.assign({
          unit:      unit,
          end:       end,
          first:     'move',
          direction: self.considerDirection(unit),
        }, self.calcTeamFuture(unit.team)));

        return self;
      },
      considerDirection: function (unit,target) {
        var turnOrder = getTurnOrder();
        var directions = ['N','S','E','W'];
        var d,direction = {N:Math.random(),S:Math.random(),E:Math.random(),W:Math.random()};
        var choices = [];
        var enemies = self.enemies;
        var i,t,w;

        turnOrder.push(turnOrder.shift());

        for (i=0; i<directions.length; i++) {
          unit.direction = directions[i];

          choices.push({
            direction: directions[i],
            weight   : calcDefense(unit, turnOrder),
            random   : Math.random()
          });
        }

        choices.sort((a,b) => ((b.weight-a.weight) || (b.random-a.random)));

        if (choices[0].weight === choices[3].weight) {
          // If all directions are equally defensible, pick something intelligent.
          for (i=0; i<enemies.length; i++) {
            d = board.getDirection(unit.assignment,enemies[i].assignment);
            t = calcThreatTurns(enemies[i], unit);
            w = 1;

            if (t  <  unit.mRecovery) w += 99;
            if (t === unit.mRecovery)
              if (turnOrder.indexOf(enemies[i].team.id) < turnOrder.indexOf(unit.team.id))
                w += 99;

            if (d.length == 1) {
              direction[d.charAt(0)] += w;
            }
            else {
              direction[d.charAt(0)] += w;
              direction[d.charAt(1)] += w;
            }
          }

          directions.sort(function (a,b) { return direction[b]-direction[a]; });

          return unit.direction = directions[0];
        }
        else if (target && choices[0].weight === choices[1].weight) {
          d = board.getDirection(unit.assignment,target.tile);

          if (d === choices[0].direction) return unit.direction = choices[0].direction;
          if (d === choices[1].direction) return unit.direction = choices[1].direction;
        }

        return unit.direction = choices[0].direction;
      },
      considerTarget: function (unit) {
        let targetsData = [];
        let targets = unit.getAttackTiles();

        for (let i=0; i<targets.length; i++) {
          let target = targets[i];
          let target_unit = target.assigned;

          if (!target_unit || self.enemies.indexOf(target_unit) === -1) continue;

          // Set defense to zero to try to priorize target.
          if (target_unit.type === 15)
            targetsData.push({
              tile:    target,
              target:  target_unit,
              defense: 0,
              random:  Math.random(),
            });
          else
            targetsData.push({
              tile:    target,
              target:  target_unit,
              defense: calcDefense(target_unit),
              random:  Math.random(),
            });
        }

        if (!targetsData.length) return;
        targetsData.sort((a, b) => (a.defense - b.defense) || (a.random - b.random));

        let targetData = targetsData[0];

        Object.assign(targetData, calcThreat(unit, targetData.target, unit.assignment));

        return targetData;
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
            if (calcThreatTurns(friends[i], enemies[j]) < 1 || calcThreatTurns(enemies[j], friends[i]) < 1)
              return 1;
          }
        }

        return 0;
      },
      calcTeamFuture:function (team, target)
      {
        var calc = [];
        var turnOrder = getTurnOrder();
        var teams = game.teams;
        var funit,funits,eunit,eunits;
        var fdamages = {},fdamage,ftotal,eclaim;
        var i,j,k,l,fsum,tsum,cnt,losses,threat,threats;

        // Calculate the figures after this turn ends.
        turnOrder.push(turnOrder.shift());

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
              if (teams[k].colorId === teams[i].colorId) continue;

              eunits = teams[k].units;

              for (l=0; l<eunits.length; l++)
              {
                eunit = eunits[l];

                // A dead man is not a threat.
                if (target && target.target === eunit && target.threat === 100) continue;

                cnt = calcThreatTurns(eunit, funit, 1);
                if (cnt  >  funit.mRecovery) continue;
                if (cnt === funit.mRecovery && turnOrder.indexOf(k) > turnOrder.indexOf(i)) continue;

                threat = calcThreat(eunit, funit, null, turnOrder);
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
              if (turnOrder.indexOf(i) > turnOrder.indexOf(k)) cnt++;

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
          threats = target && target.target.team.id === i ? 1 : 0;
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
              if (turnOrder.indexOf(k) < turnOrder.indexOf(i)) cnt++;

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

        return calc[team.id];
      },
      addChoice:function (choice)
      {
        self.choices.push(choice);
      }
    });

    if (subclass && subclass !== true)
      Tactics.Bot[subclass].call(self);

    return self;
  };

})();
