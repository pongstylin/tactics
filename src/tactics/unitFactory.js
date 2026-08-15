import { getUnitData } from '#tactics/unitData.js';
import Unit from '#tactics/Unit.js';
import Pyromancer from '#tactics/Unit/Pyromancer.js';
import Scout from '#tactics/Unit/Scout.js';
import Cleric from '#tactics/Unit/Cleric.js';
import BarrierWard from '#tactics/Unit/BarrierWard.js';
import LightningWard from '#tactics/Unit/LightningWard.js';
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
import StormDragon from '#tactics/Unit/StormDragon.js';

const unitClassMap = new Map([
  ['Pyromancer',        Pyromancer],
  ['Scout',             Scout],
  ['Cleric',            Cleric],
  ['BarrierWard',       BarrierWard],
  ['LightningWard',     LightningWard],
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
  ['StormDragon',       StormDragon],

  ['ChaosSeed',         ChaosSeed],
  ['ChaosDragon',       ChaosDragon],
]);

export default function (unitType, board) {
  const UnitClass = unitClassMap.get(unitType) ?? Unit;
  // Very expedient.  It would be better to not rely on globals.
  // Pass rebuild=true to ensure sounds have howl objects.
  const unitData = getUnitData(unitType, true);

  return new UnitClass(unitData, board);
};
