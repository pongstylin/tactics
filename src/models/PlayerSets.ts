import ActiveModel from 'models/ActiveModel';

export default class PlayerSets extends ActiveModel {
  sets: any
  constructor(playerId, sets) {
    super({
      playerId,
      sets,
    });
  }

  values() {
    return this.sets.values();
  }

  hasDefault(gameTypeId, setName) {
    return this.sets.findIndex(s => s.type === gameTypeId && s.name === setName) > -1;
  }
  getDefault(gameType, setName) {
    const set = this.sets.find(s => s.type === gameType.id && s.name === setName);
    if (set) return gameType.applySetUnitState(set);

    return gameType.getDefaultSet();
  }
  setDefault(gameType, setName, set) {
    gameType.validateSet(set);

    set.type = gameType.id;
    set.name = set.name ?? setName;
    set.createdAt = new Date();

    const index = this.sets.findIndex(s => s.type === gameType.id && s.name === setName);
    if (index === -1)
      this.sets.push(set);
    else
      this.sets[index] = set;

    this.emit('change:setDefault');
    return set;
  }

  toJSON() {
    return this.sets;
  }
}
