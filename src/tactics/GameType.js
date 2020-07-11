import Board from 'tactics/Board.js';
import ServerError from 'server/Error.js';
import unitDataMap from 'tactics/unitData.js';

export default class GameType {
  constructor(id, config) {
    this.id = id;
    this.config = config;
  }

  static load(id, config) {
    if (config.limits)
      config.limits.units.types = new Map(config.limits.units.types);

    return new GameType(id, config);
  }

  get name() {
    return this.config.name;
  }
  get isCustomizable() {
    return this.config.customizable;
  }
  get hasFixedPositions() {
    return this.isCustomizable && this.config.limits.fixedPositions;
  }

  getUnitTypes() {
    let config = this.config;

    if (config.limits)
      return [...config.limits.units.types.keys()];
    else
      return [...new Set(config.sets[0].units.map(u => u.type))];
  }
  getDefaultSet() {
    return this.config.sets[0].units;
  }
  getMaxUnits() {
    return this.config.limits.units.max;
  }
  getUnitSize(unitType) {
    let unitSize = this.config.limits.units.types.get(unitType).size;
    if (unitSize === undefined)
      unitSize = 1;

    return unitSize;
  }
  getUnitMaxCount(unitType) {
    return this.config.limits.units.types.get(unitType).max;
  }
  getAvailableTiles(board, unitType) {
    let limits = this.config.limits;
    let tiles = this._getTileLimit(board, limits.tiles);

    if (unitType)
      return tiles.intersect(
        this._getTileLimit(board, limits.units.types.get(unitType).tiles)
      );

    return tiles;
  }

  validateSet(set) {
    let nonWardUnit = set.find(u => {
      if (u.type === 'LightningWard') return false;
      if (u.type === 'BarrierWard') return false;
      return true;
    });

    if (!nonWardUnit)
      throw new ServerError(429, 'You need at least one unit that is not a ward.');

    let limits = this.config.limits;
    if (set.length > limits.units.max)
      throw new ServerError(403, 'You have exceed the max allowed units');

    let unitTypesLimits = limits.units.types;
    let team = {};
    let board = new Board();
    board.setState([set], [team]);

    /*
     * For each unit validate the following aspects:
     *   1) The unit's type is allowed.
     *   2) The unit's type max count is not exceeded.
     *   3) The unit is allowed to be assigned to its tile.
     */
    let unitCounts = new Map();
    for (let unit of team.units) {
      let unitLimits = unitTypesLimits.get(unit.type);
      if (!unitLimits)
        throw new ServerError(403, 'The set contains invalid units');

      let unitCount = unitCounts.get(unit.type) || 0;
      if (unitCount === unitLimits.max)
        throw new ServerError(403, 'Unit max counts exceeded');
      unitCounts.set(unit.type, unitCount + 1);

      let tiles = this.getAvailableTiles(board, unit.type);
      if (!tiles.has(unit.assignment))
        throw new ServerError(403, 'Units have invalid assignments');
    }

    let rules = limits.rules || {};
    if (rules.oneSide) {
      let leftSide = false;
      let rightSide = false;
      let maxDistance = rules.oneSide;

      // Find a unit that violates the one side rule
      let found = team.units.find(unit => {
        let unitColumn = unit.assignment.x;
        let leftDistance = unitColumn;
        let rightDistance = 10 - unitColumn;

        // Units within range of both sides don't count.
        if (leftDistance < maxDistance && rightDistance < maxDistance)
          return false;

        if (leftDistance < maxDistance)
          leftSide = true;
        else if (rightDistance < maxDistance)
          rightSide = true;
        else
          return true;

        return leftSide && rightSide;
      });
      if (found)
        throw new ServerError(429, `All units must be within ${maxDistance} columns of one side`);
    }

    /*
     * For each allowed unit type validate the following aspects:
     *   1) Required unit counts are met.
     *   2) Unit type rules are met.
     */
    for (let [unitType, unitLimits] of unitTypesLimits) {
      let required = unitLimits.required || 0;
      let unitCount = unitCounts.get(unitType) || 0;
      let unitTypeName = unitDataMap.get(unitType).name;
      if (required > unitCount) {
        if (required === 1)
          throw new ServerError(429, `${required} ${unitTypeName} is required`);
        else
          throw new ServerError(429, `${required} ${unitTypeName} units are required`);
      }

      let unitRules = unitLimits.rules || {};
      if (unitRules.maxStone) {
        let unitFound = team.units.find(unit => {
          if (unit.type !== unitType) return false;

          return unit.getAttackTiles().find(target => {
            let area = unit.getTargetTiles(target);
            if (area.length < 5) return false;

            // True if we DON'T find a tile that is NOT assigned
            return !area.find(tile => !tile.assigned);
          });
        });
        if (!unitFound)
          throw new ServerError(429, `A ${unitTypeName} must be able to armor the maximum units without moving`);
      }
    }
  }

  toJSON() {
    return this.config;
  }

  _getTileLimit(board, tileLimit) {
    if (!tileLimit)
      return new Set([...Object.values(board.tiles)]);

    let degree = board.getDegree(board.rotation, 'N');
    let tiles = new Set();

    if (!Array.isArray(tileLimit))
      tileLimit = [tileLimit];

    for (let i = 0; i < tileLimit.length; i++) {
      let limit = tileLimit[i];

      if (limit.start && limit.end) {
        for (let x = limit.start[0]; x <= limit.end[0]; x++) {
          for (let y = limit.start[1]; y <= limit.end[1]; y++) {
            let tile = board.getTileRotation([x, y], degree);
            if (!tile) continue;

            tiles.add(tile);
          }
        }
      }
      else if (limit.adjacentTo) {
        let adjacentTo = limit.adjacentTo;
        if (typeof adjacentTo === 'string')
          adjacentTo = { type:adjacentTo };

        let adjacentLimit = this._getTileLimit(board, adjacentTo.tiles);
        let units = board.teamsUnits[0].filter(u => u.type === adjacentTo.type);
        for (let j = 0; j < units.length; j++) {
          let unit = units[j];
          if (unit.mHealth === -unit.health) continue;

          let context = unit.assignment;
          if (!adjacentLimit.has(context)) continue;

          for (let direction of ['N','E','S','W']) {
            if (context[direction])
              tiles.add(context[direction]);
          }
        }
      }
      else if (Array.isArray(limit)) {
        let tile = board.getTileRotation(limit, degree);
        if (!tile) continue;

        tiles.add(tile);
      }
    }

    return tiles;
  }
}
