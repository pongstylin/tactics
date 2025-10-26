import Unit from '#tactics/Unit.js';

export default class Cleric extends Unit {
  getAttackTiles() {
    return [ this.assignment, ...this.getTargetUnits().filter(u => u !== this).map(u => u.assignment) ];
  }
  getTargetTiles() {
    return this.getAttackTiles();
  }
  getTargetUnits() {
    return this.team.units.filter(u => u.mHealth < 0);
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
    const results = super.getAttackResults(action);

    results.sort((a, b) =>
      a.unit.assignment.y - b.unit.assignment.y ||
      a.unit.assignment.x - b.unit.assignment.x
    );

    return results;
  }
}
