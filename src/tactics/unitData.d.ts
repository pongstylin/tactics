type UnitData = {
  code: string;
  name: string;
  shortName: string;
  ability: string;
  power: number;
  armor: number;
  health: number;
  recovery: number;
  blocking: number;
  mType: string | false;
  mRadius: number;
  mPass?: false;
  aType: string;
  aFocus?: true;
  aRange: [ number, number ];
  aLOS?: true;
  aAll?: true;
  directional?: false;
  waitFirstTurn?: true;
  tier: number;
  rarity?: number;
};
type UnitDataMap = Map<string, UnitData>
declare const unitDataMap:UnitDataMap;

export const unitDataMap:UnitDataMap;
export const unitTypeToIdMap:Map<string, number>;
export const unitTypeByCode:UnitDataMap;
export default unitDataMap;
