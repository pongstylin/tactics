import unitDataMap from '#tactics/unitData.js';
import Unit from '#tactics/Unit.js';
import Pyromancer from '#tactics/Unit/Pyromancer.js';
import Scout from '#tactics/Unit/Scout.js';
import Cleric from '#tactics/Unit/Cleric.js';
import BarrierWard from '#tactics/Unit/BarrierWard.js';
import Assassin from '#tactics/Unit/Assassin.js';
import Enchantress from '#tactics/Unit/Enchantress.js';
import MudGolem from '#tactics/Unit/MudGolem.js';
import FrostGolem from '#tactics/Unit/FrostGolem.js';
import StoneGolem from '#tactics/Unit/StoneGolem.js';
import DragonspeakerMage from '#tactics/Unit/DragonspeakerMage.js';
import PoisonWisp from '#tactics/Unit/PoisonWisp.js';
import Furgon from '#tactics/Unit/Furgon.js';
import Shrub from '#tactics/Unit/Shrub.js';
import Berserker from '#tactics/Unit/Berserker.js';
import ChaosSeed from '#tactics/Unit/ChaosSeed.js';
import ChaosDragon from '#tactics/Unit/ChaosDragon.js';

const unitClassMap = new Map([
  ['Pyromancer',        Pyromancer],
  ['Scout',             Scout],
  ['Cleric',            Cleric],
  ['BarrierWard',       BarrierWard],
  ['Assassin',          Assassin],
  ['Enchantress',       Enchantress],
  ['MudGolem',          MudGolem],
  ['FrostGolem',        FrostGolem],
  ['StoneGolem',        StoneGolem],
  ['DragonspeakerMage', DragonspeakerMage],
  ['PoisonWisp',        PoisonWisp],
  ['Furgon',            Furgon],
  ['Shrub',             Shrub],
  ['Berserker',         Berserker],

  ['ChaosSeed',         ChaosSeed],
  ['ChaosDragon',       ChaosDragon],
]);

export default function (unitType, board) {
  // Unit data is not part of unit class since data can be loaded dynamically
  let unitData = unitDataMap.get(unitType);
  if (!unitData)
    throw new Error('No such unit: '+unitType);

  let UnitClass = unitClassMap.get(unitType);
  let unit;

  unitData.type = unitType;

  if (UnitClass)
    unit = new UnitClass(unitData, board);
  else
    unit = new Unit(unitData, board);

  return unit;
};
