import Unit from '#tactics/Unit.js';

const colorMatrixMap = new Map([
  ['green', [
    1, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 1, 0,
  ]],
  ['red', [
    0, 0.8, 0, 0, 0,
    0, 0.0, 0, 0, 0,
    0, 0.0, 1, 0, 0,
    0, 0.0, 0, 1, 0,
  ]],
  ['yellow', [
    1, 0.5, 0, 0, 0,
    0, 1.0, 0, 0, 0,
    0, 0.0, 1, 0, 0,
    0, 0.0, 0, 1, 0,
  ]],
  ['brown', [
    0.0, 0.90, 0.0, 0.0, 0,
    0.0, 0.75, 0.0, 0.0, 0,
    0.0, 0.54, 0.0, 0.0, 0,
    0.0, 0.00, 0.0, 1.0, 0,
  ]],
  ['gold', [
     0.0, 1.8, 0.0, 0.0, 0,
     0.0, 1.3, 0.0, 0.0, 0,
     0.0, 0.9, 0.0, 0.0, 0,
     0.0, 0.0, 0.0, 1.0, 0,
  ]],
]);

export default class Shrub extends Unit {
  attach() {
    this.board
      .on('endTurn', this._onBoardEndTurn = this.onBoardEndTurn.bind(this));
  }
  detach() {
    this.board
      .off('endTurn', this._onBoardEndTurn);
  }

  draw(skipPosition = false) {
    const returnValue = super.draw(skipPosition);
    if (this.name === 'Rageweed')
      this._setFilter('wilt', 'ColorMatrixFilter').matrix = colorMatrixMap.get('red').slice();
    else if (this.name === 'Golden Shrub')
      this._setFilter('wilt', 'ColorMatrixFilter').matrix = colorMatrixMap.get('gold').slice();
    else if (this.mLifespan === -4)
      this._setFilter('wilt', 'ColorMatrixFilter').matrix = colorMatrixMap.get('yellow').slice();
    else if (this.mLifespan === -5)
      this._setFilter('wilt', 'ColorMatrixFilter').matrix = colorMatrixMap.get('brown').slice();
    return returnValue;
  }

  onBoardEndTurn(event) {
    const evergreen = this.name !== 'Shrub' || this.initialState.disposition === 'evergreen' || this.disposition === 'evergreen';
    if (evergreen) return;

    const changes = {
      mLifespan: this.mLifespan - 1,
    };
    if (changes.mLifespan === -this.lifespan)
      changes.disposition = 'dead';

    event.addResults([{ unit:this, changes }]);
  }

  /*
   * This method is called when this unit is successfully hit.
   *
   * For melee and magic attacks, this unit will react by breaking apart.
   * Nothing happens at all for effect attacks, i.e. heal, poison, barrier, paralyze
   */
  animHit(attacker, attackType) {
    const anim = new Tactics.Animation();

    if (attackType === undefined)
      attackType = attacker.aType;

    if (attackType !== 'melee' && attackType !== 'magic')
      return anim;

    const spriteAction = this._sprite.getAction('stagger');
    anim.addFrame(spriteAction.sounds);

    anim.splice(this.renderAnimation('unsummon'));
    anim.addFrame(() => this.board.dropUnit(this));

    return anim;
  }
  animColor(color) {
    const anim = new Tactics.Animation();
    const filter = this.filters['wilt'] ?? this._setFilter('wilt', 'ColorMatrixFilter');
    const sourceMatrix = filter.matrix.slice();
    const targetMatrix = colorMatrixMap.get(color);
    const numFrames = 8;

    anim.addFrame({
      script: frame => {
        const ratio = (frame.repeat_index + 1) / numFrames;
        if (ratio === 1) {
          if (color === 'green')
            this._setFilter('wilt', undefined);
          else
            filter.matrix = targetMatrix.slice();
        } else {
          for (let i = 0; i < filter.matrix.length; i++)
            filter.matrix[i] = sourceMatrix[i] + ratio * (targetMatrix[i] - sourceMatrix[i]);
        }
      },
      repeat: numFrames,
    });

    return anim;
  }
  animChange(changes, { instant, andDie } = { instant:false, andDie:true }) {
    const anim = new Tactics.Animation();
    if (instant) {
      if (changes.name === 'Rageweed')
        anim.splice(() => this._setFilter('wilt', 'ColorMatrixFilter').matrix = colorMatrixMap.get('red').slice());
      else if (changes.mLifespan === 0 && this.mLifespan < -3)
        anim.splice(() => this._setFilter('wilt', 'ColorMatrixFilter').matrix = colorMatrixMap.get('green').slice());
      else if (changes.mLifespan === -4)
        anim.splice(() => this._setFilter('wilt', 'ColorMatrixFilter').matrix = colorMatrixMap.get('yellow').slice());
      else if (changes.mLifespan === -5)
        anim.splice(() => this._setFilter('wilt', 'ColorMatrixFilter').matrix = colorMatrixMap.get('brown').slice());
    } else {
      if (changes.name === 'Rageweed')
        anim.splice(this.animColor('red'));
      else if (changes.mLifespan === 0 && this.mLifespan < -3)
        anim.splice(this.animColor('green'));
      else if (changes.mLifespan === -4)
        anim.splice(this.animColor('yellow'));
      else if (changes.mLifespan === -5)
        anim.splice(this.animColor('brown'));
    }

    return super.animChange(changes, { instant, andDie }).splice(anim);
  }
}

// Dynamically add unit data properties to the class.
Shrub.prototype.type = 'Shrub';
