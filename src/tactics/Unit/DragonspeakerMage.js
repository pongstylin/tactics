import Pyromancer from 'tactics/Unit/Pyromancer.js';
import unitDataMap from 'tactics/unitData.js';

function calcPowerModifiers(dragonCount, speakerCount, mageCount) {
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
    this.board
      .on('init', this._onBoardInit = this.onBoardInit.bind(this))
      .on('death', this._onBoardDeath = this.onBoardDeath.bind(this));
  }
  detach() {
    this.board
      .off('init', this._onBoardInit)
      .off('death', this._onBoardDeath);
  }

  /*
   * When the game starts, initialize dragons and mages with power modifiers.
   */
  onBoardInit() {
    let dragons = this.team.units.filter(u => u.type === 'DragonTyrant');
    let speakers = this.team.units.filter(u => u.type === 'DragonspeakerMage');
    let mages = this.team.units.filter(u => u instanceof Pyromancer);

    // Only apply initialization once even if there are multiple speakers
    if (speakers[0] !== this)
      return;
    if (dragons.length === 0)
      return;

    let { dragonModifier, mageModifier } = calcPowerModifiers(
      dragons.length,
      speakers.length,
      mages.length,
    );

    dragons.forEach(u => u.mPower = dragonModifier);
    mages.forEach(u => u.mPower = mageModifier);
  }

  /*
   * This event is fired while getting attack results for each killed unit.  It
   * allows event listeners to return sub-results that happened as a result of
   * the death.  In this case, dragon power modifiers are changed as a result of
   * a dragon, dragon speaker, or pyromancer dying.
   */
  onBoardDeath(event) {
    // Only apply recalibration once even if there are multiple speakers
    if (this !== this.team.units.find(u => u.type === 'DragonspeakerMage'))
      return;

    let defender = event.defender;
    if (defender.team !== this.team)
      return;
    if (!(defender.type === 'DragonTyrant' || defender instanceof Pyromancer))
      return;

    let dragons = this.team.units.filter(u =>
      u.type === 'DragonTyrant' && u.mHealth > -u.health
    );
    let speakers = this.team.units.filter(u =>
      u.type === 'DragonspeakerMage' && u.mHealth > -u.health
    );
    let mages = this.team.units.filter(u =>
      u instanceof Pyromancer && u.mHealth > -u.health
    );
    let counts = [dragons.length, speakers.length, mages.length];
    let next = calcPowerModifiers(...counts);

    if (defender.type === 'DragonTyrant')
      counts[0]++;
    else if (defender.type === 'DragonspeakerMage') {
      counts[1]++;
      counts[2]++;
    }
    else if (defender.type === 'Pyromancer')
      counts[2]++;

    let prev = calcPowerModifiers(...counts);

    if (dragons.length && prev.dragonModifier !== next.dragonModifier)
      event.addResults(dragons.map(unit => ({
        unit,
        changes:{ mPower:unit.mPower - prev.dragonModifier + next.dragonModifier },
      })));

    if (mages.length && prev.mageModifier !== next.mageModifier)
      event.addResults(mages.map(unit => ({
        unit,
        changes:{ mPower:unit.mPower - prev.mageModifier + next.mageModifier }
      })));
  }
}

// Dynamically add unit data properties to the class.
DragonspeakerMage.prototype.type = 'DragonspeakerMage';
