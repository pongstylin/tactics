export default class {
  constructor(state, team) {
    let turnOrder = [];
    let bound = team.id + state.teams.length;
    for (let teamId = team.id; teamId < bound; teamId++) {
      turnOrder.push(teamId % state.teams.length);
    }

    /*
     * Detect when it is time to start this bot's turn.
     */
    let startTurnListener = ({ data }) => {
      if (data.teamId === this.team.id)
        // setTimeout allows other listeners to get this event before we
        // generate more events.
        setTimeout(() => this.startTurn());
    };

    Object.assign(this, {
      state: state,
      team:  team,

      _turnOrder: turnOrder,
      _startTurnListener: startTurnListener,
    });

    state.on('startTurn', startTurnListener);
  }

  /*
   * Get the turn order as an array of team IDs.
   * The first element of the array is the team ID for the current turn.
   * This is only computed once, but is cloned to protect against modification.
   */
  get turnOrder() {
    return this._turnOrder.slice();
  }

  // Obtain the maximum threat to defender before he recovers.
  calcDefense(defender) {
    let teams = this.state.teams, enemyTeam;
    let teamsThreats = [];
    let threat_score = 0;
    let penalty;
    let threats, threat;
    let i,j,k;
    let units,unit;
    let maxTurns = defender.mRecovery + 1;
    let usedTurns;
    let myTeamId = defender.team.id;

    let turnOrder = this.turnOrder;
    turnOrder.push(turnOrder.shift());

    for (i = 0; i < turnOrder.length; i++) {
      enemyTeam = teams[turnOrder[i]];

      // Don't consider defender's team as enemies.
      if (enemyTeam === defender.team) continue;

      units = enemyTeam.units;
      threats = [];

      for (j=0; j<units.length; j++) {
        unit = units[j];

        // Don't consider allied units as enemies.
        if (unit.color === defender.color) continue;

        // Don't consider Chaos Seed an enemy in this context.
        if (unit.type === 'ChaosSeed') continue;

        this.calcAllThreats(unit, defender, maxTurns).forEach(threat => {
          threat.unit = unit;

          if (threat.score)
            threats.push(threat);
        });
      }

      if (threats.length) {
        threats.sort((a, b) => (b.score - a.score) || (a.turns - b.turns));

        teamsThreats.push({
          team:      enemyTeam,
          threats:   threats,
          usedTurns: 0,
        });
      }
    }

    let usedUnits = new Set();
    let occupiedTiles = new Set();

    // Keep taking abuse until the unit recovers or dies.
    for (i = 0; i < maxTurns; i++) {
      for (j = 0; j < teamsThreats.length; j++) {
        usedTurns = teamsThreats[j].usedTurns;
        if (usedTurns === maxTurns) continue;

        threats = teamsThreats[j].threats;

        for (k=0; k < threats.length; k++) {
          threat = threats[k];

          // Can't exceed maxTurns
          if ((usedTurns + threat.turns) > maxTurns) continue;

          // Can't attack more than once with the same unit
          if (usedUnits.has(threat.unit)) continue;

          // Can't attack from the same tile
          if (occupiedTiles.has(threat.from)) continue;

          threat_score += threat.score;
          if (threat_score >= 100)
            break;

          if (!threat.direct)
            occupiedTiles.add(threat.from);
          usedUnits.add(threat.unit);

          // Record the number of turns used to make this attack.
          teamsThreats[j].usedTurns += threat.turns - threat.unit.mRecovery;

          break;
        }

        if (threat_score >= 100)
          break;
      }

      if (threat_score >= 100)
        break;
    }

    // Defense score is the inverse of the threat score.
    return threat_score > 100 ? 0 : 100 - threat_score;
  }

  // How many turns must attacker wait before he can attack?
  // Turn count does not include the turn in which the attack is made.
  // -1 is returned if no movement required (unless simple is set)
  calcThreatTurns(attacker, target, simple) {
    let board = this.state.board;
    let turns = Math.ceil(
      (board.getDistance(attacker.assignment, target.assignment) - attacker.aRange[1]) / attacker.mRadius
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
  calcThreat(attacker, defender, tile) {
    let board = this.state.board;
    let calc = {};

    if (tile) {
      calc.from  = tile;
      calc.turns = 0;
    }
    else {
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
            calc.turns = attacker.mRecovery;
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

        calc.turns += attacker.mRecovery;
        calc.from = tile;

        // Knight and Chaos Dragon does not have to recover after just moving.
        //calc.turns += calc.turns * Math.floor(attacker.recovery / 2);

        // Only a legitimate threat if I can move to tile before defender can get away.
        if (calc.turns <= defender.mRecovery)
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
  /*
   * Determine all angles by which the attacker can attack the defender
   * ...within the maximum turns.
   */
  calcAllThreats(attacker, defender, maxTurns) {
    let board = this.state.board;
    let tdirection = defender.direction;
    let directions = ['N','S','E','W'];
    let tile;
    let path;
    let threats = [], threat;

    for (let i = 0; i < directions.length; i++) {
      if (!(tile = defender.assignment[directions[i]])) continue;

      if (tile.assigned && tile.assigned !== attacker)
        continue;

      threat = { from:tile };

      if (tile.assigned === attacker) {
        threat.turns = attacker.mRecovery + 1;

        // A direct threat is where the unit can attack then move away.
        threat.direct = true;
      }
      else {
        threat.turns = attacker.mRecovery
          + Math.ceil(board.getDistance(attacker.assignment, tile) / attacker.mRadius);
        if (threat.turns > maxTurns) continue;

        if (attacker.mType === 'path') {
          if (!(path = board.findPath(attacker, tile))) continue;

          threat.turns = attacker.mRecovery
            + Math.ceil(path.length / attacker.mRadius);
          if (threat.turns > maxTurns) continue;
        }

        // Knight and Chaos Dragon does not have to recover after just moving.
        //threat.turns += threat.turns * Math.floor(attacker.recovery / 2);
        //if (threat.turns > maxTurns) continue;
      }

      let attack = attacker.calcAttack(defender, tile);

      threat.chance = attack.chance;
      threat.damage = (attack.damage / defender.health) * 100;
      if (threat.damage > 100) threat.damage = 100;

      threat.score = (attack.damage / (defender.health + defender.mHealth)) * 100;
      if (threat.score > 100) threat.score = 100;

      // Factor in the chance that the attack may not hit.
      if (attack.chance < 100) threat.score *= attack.chance / 100;

      // Factor in the future benefit of getting additional blocking chance.
      // Actually, if we get hit, we lose blocking chance.  So now what?
      //if (threat < 100) threat *= 1 - defender.blocking / 400;

      threats.push(threat);
    }

    return threats;
  }

  startTurn() {
    const myColor = this.team.units[0].color;

    this.choices = [];
    this.friends = [];
    this.enemies = [];

    this.state.activeTeams.forEach(team => {
      if (team === this.team)
        this.friends.push(...team.units);
      else {
        // To bots, Chaos is not always an enemy.
        if (team.name === 'Chaos') {
          const agent = team.units[0];
          if (agent.type === 'ChaosSeed') {
            // Don't attack Seed if off color
            if (agent.color !== myColor)
              return;
          }
          else if (agent.type === 'ChaosDragon') {
            // Don't attack Dragon if on color
            if (agent.color === myColor)
              return;
          }
        }

        this.enemies.push(...team.units);
      }
    });

    this.addChoice(this.calcTeamFuture(this.team, null));

    if (this.inRange())
      this.considerUnit();
    else {
      this.considerPosition();
      this.endTurn();
    }
  }
  endTurn() {
    let choices = this.choices
    let chosen;

    if (choices.length === 1) {
      chosen = choices[0];

      // If all units have turn wait, use the first team unit when passing.
      if (!chosen.unit) chosen.unit = this.team.units[0];
    }
    else {
      choices.sort((a, b) => {
        // Hack to prioritize seed attacks.
        var as = 0,bs = 0;
        // Hack to make sure bot actually attacks.
        var at = 0,bt = 0;

        if (a.target && a.target.assigned.type === 'ChaosSeed') as++;
        if (b.target && b.target.assigned.type === 'ChaosSeed') bs++;

        if (a.target && a.target !== a.unit.assignment) {
          at = this.calcThreat(a.unit, a.target.assigned, a.first === 'attack' ? a.unit.assignment : a.end);
          at = at.chance <= 20 ? 0 : at.threat;
        }
        if (b.target && b.target !== b.unit.assignment) {
          bt = this.calcThreat(b.unit, b.target.assigned, b.first === 'attack' ? b.unit.assignment : b.end);
          bt = bt.chance <= 20 ? 0 : bt.threat;
        }

        return bs - as
          || a.losses - b.losses
          || bt - at
          || b.weight - a.weight
          || a.threats - b.threats
          || b.random - a.random;
      });

      let first = choices[0];
      let last = choices.last;

      // If we are passing or the equivalent, then try to get a better position.
      if (!first.target && first.defense === last.defense && first.offense === last.offense) {
        this.friends = this.team.units.slice();
        this.considerPosition();
        chosen = this.choices[0];
      }
      else
        chosen = first;
    }

    //
    // Now put our decisions into action.
    //
    let actions = [];
    let pushMoveAction = () => {
      if (chosen.end)
        actions.push({
          type:       'move',
          unit:       chosen.unit,
          assignment: chosen.end,
        });
    };
    let pushAttackAction = () => {
      if (chosen.target)
        if (chosen.target === chosen.unit.assignment)
          actions.push({
            type: 'attackSpecial',
            unit: chosen.unit,
          });
        else
          actions.push({
            type:   'attack',
            unit:   chosen.unit,
            target: chosen.target,
          });
    };

    if (chosen.first) {
      if (chosen.first === 'move') {
        pushMoveAction();
        pushAttackAction();
      }
      else if (chosen.first === 'attack') {
        pushAttackAction();
        pushMoveAction();
      }

      if (chosen.direction)
        actions.push({
          type:      'turn',
          unit:      chosen.unit,
          direction: chosen.direction,
        });
      else
        actions.push({ type:'endTurn' });
    }
    else
      actions.push({ type:'endTurn' });

    this.state.submitAction(this.state.board.encodeAction(actions));

    return this;
  }
  // Find the closest enemy unit and move the furthest friendly unit closer to the closest friendly unit.
  considerPosition() {
    let board = this.state.board;
    let choices = [];
    let choice;

    if (!this.enemies.length) return;

    //
    // Determine the unit that is closest to an enemy.
    //
    this.friends.forEach(friend => {
      this.enemies.forEach(enemy => {
        var weight = board.getDistance(enemy.assignment,friend.assignment);

        if (enemy.type === 'ChaosSeed') return;

        choices.push({
          enemy:  enemy,
          friend: friend,
          weight: weight + Math.random(),
        });
      });
    });

    choices.sort((a,b) => a.weight - b.weight);
    choice = choices[0];

    if (this.friends.length > 1) {
      choices = [];

      //
      // Determine unit that is furthest from the chosen friend and enemy.
      //
      this.friends.forEach(friend => {
        if (friend === choice.friend) return;

        choices.push({
          unit: friend,
          distance:
            board.getDistance(friend.assignment, choice.friend.assignment) +
            board.getDistance(friend.assignment, choice.enemy.assignment) +
            Math.random(),
        });
      });

      choices.sort((a,b) => a.mRecovery-b.mRecovery || b.distance-a.distance);

      choice.unit = choices[0].unit;
    }
    else {
      if (choice.friend.mRecovery) return this;
      choice.unit = choice.friend;
    }

    choices = [];

    if (!choice.unit.mRecovery) {
      //
      // Reinforce: Move the furthest ready unit as close as possible.
      //
      choice.unit.getMoveTiles().forEach(tile => {
        var distance = board.getDistance(tile, choice.enemy.assignment);

        if (this.friends.length > 1)
          distance += board.getDistance(tile, choice.friend.assignment);

        choices.push({
          end: tile,
          distance: distance + Math.random(),
        });
      });
    }
    else if (!choice.friend.mRecovery) {
      //
      // Fallback: Move the closest unit closer to the furthest unit.
      //
      choice.friend.getMoveTiles().forEach(tile => {
        var distance = board.getDistance(tile, choice.unit.assignment);

        choices.push({
          end: tile,
          distance: distance + Math.random(),
        });
      });

      choice.unit = choice.friend;
    }

    if (choices.length) {
      choices.sort((a,b) => a.distance - b.distance);

      choice.start = choice.unit.assignment;
      choice.end = choices[0].end;

      choice.unit.assign(choice.end);
      choice.unit._direction = choice.unit.direction;

      choice.direction = this.considerDirection(choice.unit);

      choice.unit.assign(choice.start);
      choice.unit.direction = choice.unit._direction;

      this.choices = [{
        first: 'move',
        unit: choice.unit,
        end: choice.end,
        direction: choice.direction,
      }];
    }
    else {
      choice.unit._direction = choice.unit.direction;
      choice.direction = this.considerDirection(choice.unit);
      choice.unit.direction = choice.unit._direction;

      this.choices = [{
        first: 'turn',
        unit: choice.unit,
        end: choice.end,
        direction: choice.direction,
      }];
    }

    return this;
  }
  considerUnit() {
    var unit      = this.friends.pop();
    var start     = unit.assignment;
    var direction = unit.direction;
    var tile,tiles;
    var target;

    if (unit.mRecovery === 0) {
      this.considerTurnOnly(unit);

      if (target = this.considerTarget(unit))
        this.considerAttackOnly(unit, target);
        //this.considerSpecialOnly(unit, tile, target);

      tiles = unit.getMoveTiles();

      for (let i = 0; i < tiles.length; i++) {
        unit.assign(tile = tiles[i]);

        if (target)
          this.considerAttackFirst(unit, tile, target);
          //this.considerSpecialFirst(unit, tile, target);
        this
          .considerMoveFirst(unit,tile)
          .considerMoveOnly(unit,tile);
      }

      unit.assign(start);
      unit.direction = direction;
      unit.mRecovery = 0;
    }

    if (this.friends.length)
      this.considerUnit();
    else
      this.endTurn();

    return this;
  }
  considerTurnOnly(unit) {
    var fdirection = unit.direction;
    var tdirection = this.considerDirection(unit);

    if (fdirection === tdirection) return this;

    this.addChoice(Object.assign({
      unit:      unit,
      first:     'turn',
      direction: tdirection,
    }, this.calcTeamFuture(unit.team)));

    return this;
  }
  considerAttackOnly(unit, target) {
    unit.mRecovery = Math.ceil(unit.recovery / 2);

    this.addChoice(Object.assign({
      unit:      unit,
      first:     'attack',
      target:    target.tile,
      direction: this.considerDirection(unit),
    }, this.calcTeamFuture(unit.team, target)));

    return this;
  }
  considerAttackFirst(unit, end, targetData) {
    unit.mRecovery = unit.recovery;

    this.addChoice(Object.assign({
      unit:      unit,
      end:       end,
      first:     'attack',
      target:    targetData.tile,
      direction: this.considerDirection(unit),
    }, this.calcTeamFuture(unit.team, targetData)));

    return this;
  }
  considerMoveFirst(unit, end) {
    var target;

    if (!(target = this.considerTarget(unit))) return this;

    unit.mRecovery = unit.recovery;

    this.addChoice(Object.assign({
      unit:      unit,
      end:       end,
      first:     'move',
      target:    target.tile,
      direction: this.considerDirection(unit,target),
    }, this.calcTeamFuture(unit.team, target)));

    return this;
  }
  considerMoveOnly(unit, end) {
    unit.mRecovery = Math.floor(unit.recovery / 2);

    this.addChoice(Object.assign({
      unit:      unit,
      end:       end,
      first:     'move',
      direction: this.considerDirection(unit),
    }, this.calcTeamFuture(unit.team)));

    return this;
  }
  considerDirection(unit, target) {
    let board = this.state.board;
    let directions = ['N','S','E','W'];
    let d,direction = {N:Math.random(),S:Math.random(),E:Math.random(),W:Math.random()};
    let choices = [];
    let enemies = this.enemies;
    let i,t,w;

    for (i=0; i<directions.length; i++) {
      unit.direction = directions[i];

      choices.push({
        direction: directions[i],
        weight   : this.calcDefense(unit),
        random   : Math.random(),
      });
    }

    choices.sort((a,b) => ((b.weight-a.weight) || (b.random-a.random)));

    if (choices[0].weight === choices[3].weight) {
      // If all directions are equally defensible, pick something intelligent.
      // Sum up the danger from each direction.
      for (i=0; i<enemies.length; i++) {
        if (!enemies[i].aRange) continue;

        d = board.getDirection(unit.assignment, enemies[i].assignment);
        t = this.calcThreatTurns(enemies[i], unit);
        w = 1;

        if (t <= unit.mRecovery)
          w += 99;

        if (d.length == 1) {
          direction[d.charAt(0)] += w;
        }
        else {
          direction[d.charAt(0)] += w;
          direction[d.charAt(1)] += w;
        }
      }

      // Pick the direction with the most threat.
      directions.sort((a,b) => direction[b] - direction[a]);

      return unit.direction = directions[0];
    }
    else if (target && choices[0].weight === choices[1].weight) {
      d = board.getDirection(unit.assignment, target.tile);

      if (d === choices[0].direction || d === choices[1].direction)
        return unit.direction = d;
    }

    return unit.direction = choices[0].direction;
  }
  considerTarget(unit) {
    let targetsData = [];
    let targets = unit.getAttackTiles();

    for (let i=0; i<targets.length; i++) {
      let target = targets[i];
      let target_unit = target.assigned;

      if (!target_unit || !this.enemies.includes(target_unit)) continue;

      targetsData.push({
        tile:    target,
        target:  target_unit,
        defense: this.calcDefense(target_unit),
        random:  Math.random(),
      });

      if (target_unit.type === 'ChaosSeed')
        return targetsData.last;
    }

    if (!targetsData.length) return;
    targetsData.sort((a, b) => (a.defense - b.defense) || (a.random - b.random));

    let targetData = targetsData[0];

    Object.assign(targetData, this.calcThreat(unit, targetData.target, unit.assignment));

    return targetData;
  }
  inRange() {
    var friends = this.friends;
    var enemies = this.enemies;
    var i,j;

    for (i=0; i<friends.length; i++) {
      for (j=0; j<enemies.length; j++) {
        if (friends[i].aRange && this.calcThreatTurns(friends[i], enemies[j]) < 1)
          return 1;
        if (enemies[j].aRange && this.calcThreatTurns(enemies[j], friends[i]) < 1)
          return 1;
      }
    }

    return 0;
  }
  calcTeamFuture(team, target) {
    let calc = [];
    let turnOrder = this.turnOrder;
    let teams = this.state.teams;
    let funit,funits,eunit,eunits;
    let fdamages = {},fdamage,ftotal
    let eclaim, tclaim;
    let i,j,k,l,fsum,tsum,cnt,losses,threat,threats;

    // Calculate the figures after this turn ends.
    turnOrder.push(turnOrder.shift());

    // Calculate the defense score for each team.
    for (i=0; i<teams.length; i++) {
      funits = teams[i].units;
      ftotal = [];

      // Calculate the total damage that can be inflicted on each unit.
      for (j=0; j<funits.length; j++) {
        funit = funits[j];
        fsum = target && target.target === funit ? target.damage : 0;
        fdamages[funit.id] = [];

        // Consider every enemy that can attack before recovery.
        for (k=0; k<teams.length; k++) {
          fdamages[funit.id].push([]);

          // If the same team, not an enemy
          if (k === i) continue;

          eunits = teams[k].units;

          for (l=0; l<eunits.length; l++) {
            eunit = eunits[l];

            // if the same color, not an enemy
            if (eunit.color === funit.color) continue;

            // If no attack range, assume the enemy is harmless. (Chaos Seed, Cleric)
            if (!eunit.aRange) continue;

            // A dead man is not a threat.
            if (target && target.target === eunit && target.threat === 100) continue;

            cnt = this.calcThreatTurns(eunit, funit, 1);
            if (cnt  >  funit.mRecovery) continue;
            if (cnt === funit.mRecovery && turnOrder.indexOf(k) > turnOrder.indexOf(i)) continue;

            threat = this.calcThreat(eunit, funit, null);
            if (threat.damage)
              fdamages[funit.id][k].push({
                unit:   eunit,
                turns:  threat.turns + 1 - eunit.mRecovery,
                damage: threat.damage,
                from:   threat.from,
              });
          }

          // Prioritize the hardest hitters with fewest turns.
          // NOTE: There is a problem where 1 unit 2 turns away will be sorted
          //       before 2 units 1 turn away (and would do less damage)
          fdamages[funit.id][k].sort((a,b) => (b.damage - a.damage) || (a.turns - b.turns));

          // The number of times we can attack before recovery.
          cnt = funit.mRecovery;
          // We can attack one more time if enemy turn comes first.
          if (turnOrder.indexOf(i) > turnOrder.indexOf(k)) cnt++;

          for (l=0; l<fdamages[funit.id][k].length; l++) {
            if (l === cnt) break;
            fsum += fdamages[funit.id][k][l].damage;
          }
        }

        // Calculate total damage.
        ftotal.push({unit:funit,damage:fsum});
      }

      // Pick the unit that is most in danger, claiming all attackers.
      // Pick the next unit most in danger, claiming unclaimed attackers.
      ftotal.sort((a,b) => b.damage - a.damage);
      losses = 0;
      tsum = 0;
      threats = target && target.target.team.id === i ? 1 : 0;
      eclaim = new Set();
      tclaim = new Set();

      for (j=0; j<ftotal.length; j++) {
        funit = ftotal[j].unit;
        fsum = ((funit.mHealth + funit.health) / funit.health) * 100;

        if (target && target.target === funit)
          fsum -= target.damage;

        for (k=0; k<fdamages[funit.id].length; k++) {
          if (k === i) continue;
          threats += fdamages[funit.id][k].length;

          // The number of times we can attack before recovery.
          cnt = funit.mRecovery;
          // We can attack one more time if enemy turn comes first.
          if (turnOrder.indexOf(k) < turnOrder.indexOf(i)) cnt++;

          for (l=0; l<fdamages[funit.id][k].length; l++) {
            // Only attackers that can attack before he moves again count.
            if (!cnt) break;

            fdamage = fdamages[funit.id][k][l];
            if (fdamage.turns > cnt) continue;

            if (eclaim.has(fdamage.unit)) continue;
            if (tclaim.has(fdamage.from)) continue;

            fsum -= fdamage.damage;
            eclaim.add(fdamage.unit);
            tclaim.add(fdamage.from);
            cnt -= fdamage.turns;
          }
        }

        if (fsum  <  0) fsum = 0;
        if (fsum === 0) losses++;
        tsum += fsum;
      }

      if (teams[i].name === 'Chaos')
        calc.push({losses:losses,defense:tsum,offense:0,threats:threats});
      else
        calc.push({losses:losses,defense:tsum/3,offense:0,threats:threats});
    }

    for (i=0; i<teams.length; i++) {
      for (j=0; j<teams.length; j++) {
        if (i === j) continue;
        calc[i].offense += 100 - calc[j].defense;
      }

      calc[i].offense /= teams.length-1;
      calc[i].weight = (calc[i].offense + calc[i].defense) / 2;
      calc[i].random = Math.random();
    }

    return calc[team.id];
  }
  addChoice(choice) {
    this.choices.push(choice);
  }

  destroy() {
    this.state.off('startTurn', this._startTurnListener);
  }
}
