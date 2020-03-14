import Unit from 'tactics/Unit.js';

export default class Shrub extends Unit {
  /*
   * This method is called when this unit is successfully hit.
   *
   * For melee and magic attacks, this unit will react by breaking apart.
   * Nothing happens at all for effect attacks, i.e. heal, poison, barrier, paralyze
   */
  animHit(attacker, attackType) {
    let anim = new Tactics.Animation();

    if (attackType === undefined)
      attackType = attacker.aType;

    if (attackType !== 'melee' && attackType !== 'magic')
      return anim;

    let spriteAction = this._sprite.getAction('stagger');
    anim.addFrame(spriteAction.sounds);

    anim.splice(this.renderAnimation('unsummon'));
    anim.addFrame(() => this.board.dropUnit(this));

    return anim;
  }
}

// Dynamically add unit data properties to the class.
Shrub.prototype.type = 'Shrub';
