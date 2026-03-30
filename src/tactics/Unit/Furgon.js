import Unit from '#tactics/Unit.js';

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
    // If this unit is dying or transforming, disregard
    if (this.disposition === 'dead' || this.disposition === 'transform')
      return;

    const attacker = event.attacker;
    const defender = event.unit;

    // Nothing can be done if this unit died.
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

    const changes = { name:'Enraged Furgon', disposition:'enraged' };
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

  /*
   * Furgon cannot block when exhausted
   */
  canBlock() {
    return super.canBlock() && this.disposition !== 'exhausted';
  }

  getAttackTiles(start = this.assignment) {
    if (this.canSpecial())
      return [this.assignment];

    const board = this.board;
    const range = this.aRange;
    const tiles = board.getTileRange(start, ...range);

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
    const board = this.board;
    const enemies = board.teamsUnits.filter((tu, i) => i !== this.team.id).flat();
    const targets = new Set();

    for (const enemy of enemies) {
      // Don't surround units that can't move, e.g. Shrubs or Wards
      if (enemy.mType === false) continue;

      board.getTileRange(enemy.assignment, 1, 1).forEach(target => {
        if (!target.assigned || target.assigned.type === 'Shrub' && target.assigned.name === 'Shrub')
          targets.add(target);
      });
    }

    return [...targets];
  }
  getTargetUnits() {
    return [];
  }
  validateAttackAction(validate) {
    const action = super.validateAttackAction(validate);

    if (this.canSpecial())
      action.type = 'attackSpecial';

    return action;
  }
  canCounter() {
    return this.disposition === 'transform';
  }
  getCounterAction(attacker, result) {
    if (this.disposition !== 'transform') return null;

    const results = this.getAttackSpecialResults();
    const myResult = results.find(r => r.unit === this);
    myResult.changes = {
      type: 'Shrub',
      name: 'Golden Shrub',
      disposition: 'unbreakable',
    };

    const nonEvergreenShrubs = this.board.teamsUnits.flat().filter(unit => (
      unit.type === 'Shrub' && unit.name === 'Shrub' && unit.disposition !== 'evergreen'
    ));
    if (nonEvergreenShrubs.length > 0) {
      myResult.results = nonEvergreenShrubs.map(shrub => {
        const changes = { disposition:'evergreen' };
        if (shrub.mLifespan < 0)
          changes.mLifespan = 0;
        return { unit:shrub, changes };
      });
    }

    return {
      type: 'transform',
      unit: this,
      target: this.assignment,
      results,
    };
  }
  getMoveResults(action) {
    if (this.features.evergreen) return [];

    const allUnits = this.board.teamsUnits.flat();
    if (allUnits.some(u => u.type === 'Shrub' && u.name === 'Golden Shrub'))
      return [];

    const furgons = allUnits.filter(u => u.type === 'Furgon');
    const shrubs = allUnits.filter(u => u.type === 'Shrub' && u.name === 'Shrub');
    const results = [];

    for (const shrub of shrubs) {
      const needsEvergreen = furgons.some(f => (
        this.board.getDistance(f === this ? action.assignment : f.assignment, shrub.assignment) < 4
      ));
      const isEvergreen = shrub.disposition === 'evergreen';

      if (needsEvergreen && !isEvergreen)
        results.push({ unit:shrub, changes:{ disposition:'evergreen', mLifespan:0 } });
      else if (!needsEvergreen && isEvergreen)
        results.push({ unit:shrub, changes:{ disposition:null } });
    }

    return results;
  }
  getAttackResults(action) {
    if (this.canSpecial())
      return this.getAttackSpecialResults();

    const board = this.board;
    const targets = board.getTileRange(action.target, 0, 1, true);

    return targets.map(tile => {
      const shrub = board.makeUnit({
        // Kinda lazy but, for a stationary unit, the tile id is sufficiently unique.
        id: tile.id,
        type: 'Shrub',
        assignment: tile,
        disposition: 'evergreen',
      });

      return {
        type: 'summon',
        unit: shrub,
        teamId: this.team.id,
      };
    });
  }
  getAttackSpecialResults() {
    const board = this.board;
    const results = [{
      unit: this,
      changes: { name:'Exhausted Furgon', disposition:'exhausted', mRecovery:6 },
    }];

    results.push(...this.getSpecialTargetTiles().map(target => {
      if (target.assigned) {
        const changes = this.features.evergreen ? {} : { name:'Rageweed' };
        if (target.assigned.disposition === 'evergreen')
          changes.disposition = null;
        else if (target.assigned.mLifespan)
          changes.mLifespan = 0;
        return { unit:target.assigned, changes };
      }

      const shrub = board.makeUnit({
        // Kinda lazy but, for a stationary unit, the tile id is sufficiently unique.
        id: target.id,
        type: 'Shrub',
        name: this.features.evergreen ? 'Shrub' : 'Rageweed',
        assignment: target,
        disposition: this.features.evergreen ? 'evergreen' : null,
      });

      return {
        type: 'summon',
        unit: shrub,
        teamId: this.team.id,
      };
    }));

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
    const board = this.board;
    const anim = this.renderAnimation('attackSpecial', action.direction);
    const spriteAction = this._sprite.getAction('attackSpecial');
    const effectOffset = spriteAction.events.find(e => e[1] === 'react')[0];

    if (this.directional !== false)
      anim.addFrame(() => this.stand());

    const results = action.results;
    if (!results.length) return anim;

    const shrubResults = results.filter(r => r.unit.type === 'Shrub');
    const distances = shrubResults.map(result =>
      board.getDistance(this.assignment, result.unit.assignment)
    );
    const closest = Math.min(...distances);
    const range = Math.max(...distances) - closest;
    const maxDelay = 4;

    for (const result of shrubResults) {
      const distance = distances.shift() - closest;
      const delay = range && Math.round(distance / range * maxDelay);
      const offset = effectOffset + delay;
      if (anim.frames.length < offset)
        anim.addFrame({
          scripts: [],
          repeat: offset - anim.frames.length,
        });

      if (result.type === 'summon') {
        const shrub = result.unit.draw();
        const summonAnimation = shrub.renderAnimation('summon');
        summonAnimation.addFrame(() => shrub.stand());

        anim.splice(offset, () => board.addUnit(shrub, this.team));
        anim.splice(offset, summonAnimation);
      } else
        anim.splice(offset, result.unit.animChange(result.changes));
    }

    return anim;
  }
  animTransform(action) {
    const board = this.board;
    const anim = this.animAttackSpecial(action);
    const shrub = board.makeUnit(Object.assign({
      id: this.id,
      assignment: this.assignment,
    }, action.results.find(r => r.changes.type === 'Shrub').changes));
    shrub.draw();

    anim.splice([
      {
        script: () => this.frame.alpha /= 1.8,
        repeat: 7,
      },
      () => board.dropUnit(this, true),
    ]);

    const summon = new Tactics.Animation({ frames:[() => board.unitsContainer.addChild(shrub.pixi)] });
    summon.splice(0, shrub.renderAnimation('summon'));
    summon.splice(() => {
      board.unitsContainer.removeChild(shrub.pixi);
      board.addUnit(shrub, this.team);
      shrub.stand();
    });
    anim.splice(-8, summon);

    return anim;
  }
  canSpecial() {
    // Can't use entangle if there is more than one Furgon
    const unitCount = this.team.units.filter(u => u.type === this.type).length;
    if (unitCount > 1)
      return false;

    const me = this.assignment;

    return (
      this.disposition === 'enraged' &&
      me.N && me.N.assigned && me.N.assigned.type === 'Shrub' && me.N.assigned.name === 'Shrub' &&
      me.E && me.E.assigned && me.E.assigned.type === 'Shrub' && me.N.assigned.name === 'Shrub' &&
      me.S && me.S.assigned && me.S.assigned.type === 'Shrub' && me.N.assigned.name === 'Shrub' &&
      me.W && me.W.assigned && me.W.assigned.type === 'Shrub' && me.N.assigned.name === 'Shrub'
    );
  }
  // Furgon can only be truly killed if paralyzed or poisoned first
  getDeadResult(attacker, result) {
    const isDead = super.getDeadResult(attacker, result);
    if (!isDead) return isDead;

    if (this.name === 'Enraged Furgon')
      result.changes.name = 'Furgon';

    if (!this.features.transform)
      return isDead;
    if (this.team.units.some(u => u.type === 'Furgon' && u !== this && u.disposition !== 'dead'))
      return isDead;
    if (attacker.team === this.team)
      return isDead;
    if (this.paralyzed || this.poisoned)
      return isDead;
    for (const D of [ 'N', 'S', 'E', 'W' ])
      if (this.assignment[D]?.assigned?.type === 'Shrub' && this.assignment[D]?.assigned?.name === 'Rageweed')
        return isDead;

    result.changes.disposition = 'transform';

    return isDead;
  }
}
