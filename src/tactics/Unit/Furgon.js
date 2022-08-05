import Unit from 'tactics/Unit.js';

export default class Furgon extends Unit {
  attach() {
    this.board
      .on('dropUnit', this._onBoardDropUnit = this.onBoardDropUnit.bind(this))
      .on('endTurn', this._onBoardEndTurn = this.onBoardEndTurn.bind(this));
  }
  detach() {
    this.board
      .off('dropUnit', this._onBoardDropUnit)
      .off('endTurn', this._onBoardEndTurn);
  }

  /*
   * Furgon does not target units
   */
  setTargetNotice() {
    return;
  }

  /*
   * The Furgon, if any, on the dead unit's team becomes enraged if a non-
   * ward ally is killed by an opponent team.
   */
  onBoardDropUnit(event) {
    let attacker = event.attacker;
    let defender = event.unit;

    // Nothing can be done if this used died.
    // Compare using IDs since the unit may be a clone.
    if (defender.id === this.id)
      return;
    // Don't care if we killed our own unit.
    if (!attacker || attacker.team === this.team)
      return;
    // Don't care unless a member of this Furgon's team died.
    if (defender.team !== this.team)
      return;
    // Don't care if wards or shrubs die.
    if (/Ward$|^Shrub$/.test(defender.type))
      return;

    let changes = { name:'Enraged Furgon', disposition:'enraged' };
    if (this.mRecovery)
      changes.mRecovery = 0;

    event.addResults([{ unit:this, changes }]);
  }
  /*
   * Furgon resumes a calm disposition if:
   *   1) It is still enraged at the end of its turn.
   *   2) It has recovered after becoming exhausted.
   */
  onBoardEndTurn(event) {
    if (event.currentTeam !== this.team)
      return;

    if (
      this.disposition === 'enraged' ||
      this.disposition === 'exhausted' && this.mRecovery === 1
    )
      event.addResults([{
        unit: this,
        changes: { name:'Furgon', disposition:null },
      }]);
  }

  getAttackTiles(start = this.assignment) {
    if (this.canSpecial())
      return [this.assignment];

    let board = this.board;
    let range = this.aRange;
    let tiles = board.getTileRange(start, ...range);

    // Suitable tiles have at least one empty tile in the area
    return tiles.filter(tile =>
      board.getTileRange(tile, 0, 1).find(t => !t.assigned)
    );
  }
  getTargetTiles(target) {
    if (this.canSpecial())
      return [this.assignment, ...this.getSpecialTargetTiles()];

    return this.board.getTileRange(target, 0, 1);
  }
  getSpecialTargetTiles(target, source) {
    let board = this.board;
    let enemies = board.teamsUnits.filter((tu, i) => i !== this.team.id).flat();
    let targets = new Set();

    for (let enemy of enemies) {
      // Don't surround units that can't move, e.g. Shrubs or Wards
      if (enemy.mType === false) continue;

      board.getTileRange(enemy.assignment, 1, 1, true).forEach(target => {
        targets.add(target);
      });
    }

    return [...targets];
  }
  getTargetUnits() {
    return [];
  }
  validateAttackAction(validate) {
    let action = super.validateAttackAction(validate);

    if (this.canSpecial())
      action.type = 'attackSpecial';

    return action;
  }
  getAttackResults(action) {
    if (this.canSpecial())
      return this.getAttackSpecialResults();

    let board = this.board;
    let targets = board.getTileRange(action.target, 0, 1, true);

    return targets.map(tile => {
      let shrub = board.makeUnit({
        // Kinda lazy but, for a stationary unit, the tile id is sufficiently unique.
        id: tile.id,
        type: 'Shrub',
        assignment: tile,
      });

      return {
        type: 'summon',
        unit: shrub,
        teamId: this.team.id,
      };
    });
  }
  getAttackSpecialResults() {
    let board = this.board;
    let results = [{
      unit: this,
      changes: { name:'Exhausted Furgon', disposition:'exhausted', mRecovery:6 },
    }];

    this.getSpecialTargetTiles().forEach(target => {
      let shrub = board.makeUnit({
        // Kinda lazy but, for a stationary unit, the tile id is sufficiently unique.
        id: target.id,
        type: 'Shrub',
        assignment: target,
      });

      results.push({
        type: 'summon',
        unit: shrub,
        teamId: this.team.id,
      });
    });

    return results;
  }
  /*
   * Summon to closer tiles before further tiles.
   */
  animAttack(action) {
    let board = this.board;
    let anim = this.renderAnimation('attack', action.direction);
    let spriteAction = this._sprite.getAction('attack');
    let effectOffset = spriteAction.events.find(e => e[1] === 'react')[0];

    anim.addFrame(() => this.stand());

    if (this.directional !== false)
      anim.addFrame(() => this.stand());

    let results = action.results;
    if (!results.length) return anim;

    let closest = Math.min(...results.map(result =>
      board.getDistance(this.assignment, result.unit.assignment)
    ));

    for (let result of results) {
      let target = result.unit.assignment;
      let offset = effectOffset + (board.getDistance(this.assignment, target) - closest) * 2;

      if (anim.frames.length < offset)
        anim.addFrame({
          scripts: [],
          repeat: offset - anim.frames.length,
        });

      let shrub = result.unit.draw();
      let summonAnimation = shrub.renderAnimation('summon');
      summonAnimation.addFrame(() => shrub.stand());

      anim.splice(offset, () => board.addUnit(shrub, this.team));
      anim.splice(offset, summonAnimation);
    }

    return anim;
  }
  animAttackSpecial(action) {
    let board = this.board;
    let anim = this.renderAnimation('attackSpecial', action.direction);
    let spriteAction = this._sprite.getAction('attackSpecial');
    let effectOffset = spriteAction.events.find(e => e[1] === 'react')[0];

    if (this.directional !== false)
      anim.addFrame(() => this.stand());

    let results = action.results;
    if (!results.length) return anim;

    let shrubResults = results.filter(r => r.unit.type === 'Shrub');
    let distances = shrubResults.map(result =>
      board.getDistance(this.assignment, result.unit.assignment)
    );
    let closest = Math.min(...distances);
    let range = Math.max(...distances) - closest;
    let maxDelay = 4;

    for (let result of shrubResults) {
      let target = result.unit.assignment;
      let distance = distances.shift() - closest;
      let delay = range && Math.round(distance / range * maxDelay);
      let offset = effectOffset + delay;
      let isHit = !result.miss;

      if (anim.frames.length < offset)
        anim.addFrame({
          scripts: [],
          repeat: offset - anim.frames.length,
        });

      let shrub = result.unit.draw();
      let summonAnimation = shrub.renderAnimation('summon');
      summonAnimation.addFrame(() => shrub.stand());

      anim.splice(offset, () => board.addUnit(shrub, this.team));
      anim.splice(offset, summonAnimation);
    }

    return anim;
  }
  canSpecial() {
    // Can't use entangle if there is more than one Furgon
    let unitCount = this.team.units.filter(u => u.type === this.type).length;
    if (unitCount > 1)
      return false;

    let me = this.assignment;

    return (
      this.disposition === 'enraged' &&
      me.N && me.N.assigned && me.N.assigned.type === 'Shrub' &&
      me.E && me.E.assigned && me.E.assigned.type === 'Shrub' &&
      me.S && me.S.assigned && me.S.assigned.type === 'Shrub' &&
      me.W && me.W.assigned && me.W.assigned.type === 'Shrub'
    );
  }
}
