import type TeamSet, { TeamSetData, TeamSetUnit } from '#models/TeamSet.js';

export type Tag = {
  type: 'type' | 'position' | 'unit';
  name: string;
  count?: number;
};

export default class GameType {
  id: string;
  name: string;
  isCustomizable: boolean;
  config: {
    sets: {
      id: string;
      name: string;
      units: {
        type: string;
        assignment: [ number, number ];
        direction?: 'N' | 'S' | 'E' | 'W';
      }[];
    }[];
    archived?: boolean;
  };
  tagByKeyword: Map<string, Tag>;
  localTagByPath: Map<string, Tag & { sets:TeamSetData[] }>;
  hasFixedSides: boolean;

  getDefaultSet(): Set;
  validateSet<T extends Set>(set:T): void;
  getTeamSetTags(teamSet:TeamSet): Tag[];
  validateSetIsFull(units:TeamSetUnit[]): boolean;
  applySetUnitState<T extends Set>(set:T): T;
};