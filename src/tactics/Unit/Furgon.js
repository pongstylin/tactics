import Unit from 'tactics/Unit.js';

export default class Furgon extends Unit {
  getAttackTiles(start = this.assignment) {
    let board = this.board;
    let range = this.aRange;
    let tiles = board.getTileRange(start, ...range);

    // Suitable tiles have at least one empty tile in the area
    return tiles.filter(tile =>
      board.getTileRange(tile, 0, 1).find(t => !t.assigned)
    );
  }
  getTargetTiles(target) {
    return this.board.getTileRange(target, 0, 1);
  }
  getTargetUnits() {
    return [];
  }
  getAttackResults(action) {
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
    let enemies = board.teamsUnits.filter((tu, i) => i !== this.team.id).flat();
    let results = [{
      unit: this,
      changes: { mRecovery:6 },
    }];
    let targetIds = new Set();

    for (let enemy of enemies) {
      let targets = board.getTileRange(enemy.assignment, 1, 1, true);

      for (let target of targets) {
        // No duplicates, please
        if (targetIds.has(target.id)) continue;
        targetIds.add(target.id);

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
      }
    }

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

    let distances = results.map(result =>
      board.getDistance(this.assignment, result.unit.assignment)
    );
    let closest = Math.min(...distances);
    let range = Math.max(...distances) - closest;
    let maxDelay = 4;

    for (let result of action.results) {
      if (result.unit === this) continue;

      let target = result.unit.assignment;
      let distance = distances.shift() - closest;
      let delay = Math.round(distance / range * maxDelay);
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
      me.N && me.N.assigned && me.N.assigned.type === 'Shrub' &&
      me.E && me.E.assigned && me.E.assigned.type === 'Shrub' &&
      me.S && me.S.assigned && me.S.assigned.type === 'Shrub' &&
      me.W && me.W.assigned && me.W.assigned.type === 'Shrub'
    );
  }
}

// Dynamically add unit data properties to the class.
Furgon.prototype.type = 'Furgon';
