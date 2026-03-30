import Pyromancer from '#tactics/Unit/Pyromancer.js';
import unitDataMap from '#tactics/unitData.js';

export function calcPowerModifiers(dragonCount, speakerCount, mageCount) {
  if (!dragonCount || !speakerCount)
    return { dragonModifier:0, mageModifier:0 };

  let dragonData = unitDataMap.get('DragonTyrant');
  let maxDragonPower = 12 * speakerCount * mageCount;
  let dragonPower = Math.min(maxDragonPower, dragonData.power);
  let dragonModifier = -dragonPower;
  let mageModifier = Math.round(dragonPower * dragonCount / mageCount);

  return { dragonModifier, mageModifier };
}

export default class DragonspeakerMage extends Pyromancer {
  attach() {
    this._adjustBonusListener = this._adjustBonus.bind(this);
    this.board
      .on('addUnit', this._adjustBonusListener)
      .on('dropUnit', this._adjustBonusListener);
  }
  detach() {
    this.board
      .off('addUnit', this._adjustBonusListener)
      .off('dropUnit', this._adjustBonusListener);
  }

  /*
   * Compute the change in power modifiers as a dragon, DSM, or pyro is added or
   * removed from the board.  This is called while computing attack results as
   * a unit is killed during a game.  It is also called in set setup as units
   * are added or removed from the board.
   */
  _adjustBonus({ type, unit, addResults }) {
    // Only apply recalibration once even if there are multiple speakers
    if (this !== this.team.units.find(u => u.type === 'DragonspeakerMage'))
      return;

    if (unit.team !== this.team)
      return;
    if (!(unit.type === 'DragonTyrant' || unit instanceof Pyromancer))
      return;

    const dragons = this.team.units.filter(u =>
      u.type === 'DragonTyrant' && u.disposition !== 'dead'
    );
    const speakers = this.team.units.filter(u =>
      u.type === 'DragonspeakerMage' && u.disposition !== 'dead'
    );
    const mages = this.team.units.filter(u =>
      u instanceof Pyromancer && u.disposition !== 'dead'
    );
    const counts = [dragons.length, speakers.length, mages.length];
    const prev = calcPowerModifiers(...counts);
    const change = type === 'addUnit' ? 1 : type === 'dropUnit' ? -1 : 0;

    if (unit.type === 'DragonTyrant')
      counts[0] += change;
    else if (unit.type === 'DragonspeakerMage') {
      counts[1] += change;
      counts[2] += change;
    } else if (unit.type === 'Pyromancer')
      counts[2] += change;

    const next = calcPowerModifiers(...counts);
    let results = [];

    if (dragons.length)
      results = dragons.map(u => ({
        unit: u,
        changes: {
          mPower: u === unit
            ? next.dragonModifier
            : u.mPower - prev.dragonModifier + next.dragonModifier,
        },
      }));

    if (mages.length)
      results = results.concat(mages.map(u => ({
        unit: u,
        changes: {
          mPower: u === unit
            ? next.mageModifier
            : u.mPower - prev.mageModifier + next.mageModifier,
        }
      })));

    addResults(results.filter(r => r.unit.mPower !== r.changes.mPower));
  }
}
