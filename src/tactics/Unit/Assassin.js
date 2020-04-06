import Unit from 'tactics/Unit.js';

export default class Assassin extends Unit {
  canSpecial() {
    // Can't use bomb if there is more than one Assassin
    let unitCount = this.team.units.filter(u => u.type === this.type).length;
    if (unitCount > 1)
      return false;

    return (this.health + this.mHealth) < 5;
  }
  /*
   * Customized to include the assigned tile in the list of targets.
   */
  animAttackSpecial(action) {
    let anim         = this.renderAnimation('attackSpecial', action.direction);
    let spriteAction = this._sprite.getAction('attackSpecial');
    let effectOffset = spriteAction.events.find(e => e[1] === 'react')[0];

    if (this.directional !== false)
      anim.addFrame(() => this.stand());

    let targets = this.getAttackTiles();
    targets.push(this.assignment);

    targets.forEach(target => {
      let result = action.results.find(r => r.unit === target.assigned);
      let isHit = result && !result.miss;

      if (anim.frames.length < effectOffset)
        anim.addFrame({
          scripts: [],
          repeat: effectOffset - anim.frames.length,
        });

      anim.splice(effectOffset, this.animAttackEffect(
        Object.assign({ type:'magic' }, spriteAction.effect),
        target,
        isHit,
      ));
    });

    return anim;
  }
  getAttackSpecialResults() {
    let board = this.board;
    let targets = board.getTileRange(this.assignment, 0, 1, false);
    let cUnits = new Map();

    board.teamsUnits.flat().forEach(unit => cUnits.set(unit.id, unit.clone()));

    return targets.map(target => {
      let targetUnit = target.assigned;
      let cUnit = cUnits.get(targetUnit.id);
      let result = { unit:targetUnit };

      if (cUnit.barriered)
        result.miss = 'immune';
      else
        result.changes = { mHealth:-cUnit.health };

      board.applyActionResults([result]);
      this.getAttackSubResults(result);
      return result;
    });
  }
}

// Dynamically add unit data properties to the class.
Assassin.prototype.type = 'Assassin';
