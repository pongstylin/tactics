export type Set = {
  name?: string;
  units: object[];
};

export default class GameType {
  id: string;
  name: string;
  isCustomizable: boolean;
  config: {
    archived?: boolean;
  };

  getDefaultSet(): Set;
  validateSet(set:Set): void;
  applySetUnitState(set:Set): Set;
};