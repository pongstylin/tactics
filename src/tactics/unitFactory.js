import unitDataMap from 'tactics/unitData.js';
import Unit from 'tactics/Unit.js';
import Pyromancer from 'tactics/Unit/Pyromancer.js';
import Scout from 'tactics/Unit/Scout.js';
import Cleric from 'tactics/Unit/Cleric.js';
import BarrierWard from 'tactics/Unit/BarrierWard.js';
import DarkMagicWitch from 'tactics/Unit/DarkMagicWitch.js';
import Assassin from 'tactics/Unit/Assassin.js';
import Enchantress from 'tactics/Unit/Enchantress.js';
import ChaosSeed from 'tactics/Unit/ChaosSeed.js';
import ChaosDragon from 'tactics/Unit/ChaosDragon.js';

const unitClassMap = new Map([
  ['Pyromancer',     Pyromancer],
  ['Scout',          Scout],
  ['Cleric',         Cleric],
  ['BarrierWard',    BarrierWard],
  ['DarkMagicWitch', DarkMagicWitch],
  ['Assassin',       Assassin],
  ['Enchantress',    Enchantress],

  ['ChaosSeed',      ChaosSeed],
  ['ChaosDragon',    ChaosDragon],
]);

export default function (unitType, board) {
  // Unit data is not part of unit class since data can be loaded dynamically
  let unitData = unitDataMap.get(unitType);
  if (!unitData)
    throw new Error('No such unit: '+unitType);

  let UnitClass = unitClassMap.get(unitType);
  let unit;

  if (UnitClass)
    unit = new UnitClass(unitData, board);
  else {
    unitData.type = unitType;
    unit = new Unit(unitData, board);
  }

  return unit;
};
