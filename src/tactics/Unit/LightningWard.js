import Unit from '#tactics/Unit.js';

export default class LightningWard extends Unit {
  getAttackTiles(source = this.assignment) {
    if (this.disposition === 'channeling')
      return [];

    return super.getAttackTiles();
  }
}
