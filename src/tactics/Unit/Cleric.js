import Unit from '#tactics/Unit.js';

export default class Cleric extends Unit {
  getAttackTiles() {
    return this.getTargetUnits().map(u => u.assignment);
  }
  getTargetTiles() {
    return this.getAttackTiles();
  }
  getTargetUnits() {
    return [
      ...this.team.units.filter(u => {
        const notDuplicatedSelf = u !== this; // Don't double heal self
        const isDamaged =  u.mHealth < 0;
        return notDuplicatedSelf && isDamaged;
      }),
      this // Add self as target for double click
    ];
  }
  /*
   * Customized to show effect on all units, not just healed units.
   */
  animAttack(action) {
    let anim         = this.renderAnimation('attack', action.direction);
    let spriteAction = this._sprite.getAction('attack');
    let effectOffset = spriteAction.events.find(e => e[1] === 'react')[0];

    anim.addFrame(() => this.stand());

    if (this.directional !== false)
      anim.addFrame(() => this.stand());

    let targets = this.team.units
      .filter(u => u.type !== 'Shrub')
      .map(u => u.assignment);

    targets.forEach(target => {
      let isHit = !target.assigned.barriered;

      if (anim.frames.length < effectOffset)
        anim.addFrame({
          scripts: [],
          repeat: effectOffset - anim.frames.length,
        });

      anim.splice(
        effectOffset,
        this.animAttackEffect(spriteAction.effect, target, isHit),
      );
    });

    return anim;
  }
  getAttackResults(action) {
    const board = this.board;
    const calcs = this.getTargetUnits(action.target)
      .map(targetUnit => [
        targetUnit,
        this.calcAttack(targetUnit, this.assignment, action.target),
      ])
      // Remove full health targets from healing (self on double click)
      .filter(([targetUnit]) => targetUnit.mHealth < 0);

    let results = calcs.map(([targetUnit, calc]) => {
      const result = this.getAttackResult(action, targetUnit, calc);
      board.applyActionResults([result]);
      this.getAttackSubResults(result);
      return result;
    });

    results.sort((a, b) =>
      a.unit.assignment.y - b.unit.assignment.y ||
      a.unit.assignment.x - b.unit.assignment.x
    );

    return results;
  }
}
