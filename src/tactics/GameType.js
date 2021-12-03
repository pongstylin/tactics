import Board from 'tactics/Board.js';
import ServerError from 'server/Error.js';
import unitDataMap from 'tactics/unitData.js';
import { calcPowerModifiers } from 'tactics/Unit/DragonspeakerMage.js';
import serializer from 'utils/serializer.js';

export default class GameType {
  constructor(data) {
    Object.assign(this, data);
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
    const config = this.config;

    if (config.limits)
      return [...config.limits.units.types.keys()];
    else
      return [...new Set(config.sets[0].units.map(u => u.type))];
  }
  getDefaultSet() {
    return this.applySetUnitState(this.config.sets[0]);
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
  applySetUnitState(set) {
    // Compute dragonspeaker modifiers
    let dragons = set.units.filter(u => u.type === 'DragonTyrant').length;
    let speakers = set.units.filter(u => u.type === 'DragonspeakerMage').length;
    let pyros = set.units.filter(u => u.type === 'Pyromancer').length;
    let powerModifiers = calcPowerModifiers(dragons, speakers, speakers + pyros);

    for (let unitState of set.units) {
      let unitData = unitDataMap.get(unitState.type);

      if (unitData.directional !== false && !unitState.direction)
        unitState.direction = 'S';

      if (powerModifiers.dragonModifier) {
        if (unitState.type === 'DragonTyrant')
          unitState.mPower = powerModifiers.dragonModifier;
        else if (unitState.type === 'DragonspeakerMage' || unitState.type === 'Pyromancer')
          unitState.mPower = powerModifiers.mageModifier;
      }

      if (unitData.waitFirstTurn)
        unitState.mRecovery = 1;
    }

    return set;
  }

  validateSetIsNotEmpty(units) {
    let nonWardUnit = units.find(u => {
      if (u.type === 'LightningWard') return false;
      if (u.type === 'BarrierWard') return false;
      return true;
    });

    if (!nonWardUnit)
      throw new ServerError(429, 'You need at least one unit that is not a ward.');
  }
  validateSetIsNotOverFull(units) {
    let limits = this.config.limits;
    if (units.length > limits.units.max)
      throw new ServerError(403, 'You have exceed the max allowed units');
  }
  validateSetUnitPlacements(board, units) {
    let limits = this.config.limits;
    let unitTypesLimits = limits.units.types;

    /*
     * For each unit validate the following aspects:
     *   1) The unit's type is allowed.
     *   2) The unit's type max count is not exceeded.
     *   3) The unit is allowed to be assigned to its tile.
     */
    let unitCounts = new Map();
    for (let unit of units) {
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
      let found = units.find(unit => {
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
        let unitFound = units.find(unit => {
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
  cleanSet(set) {
    for (let propName of Object.keys(set)) {
      if (propName === 'name') continue;
      if (propName === 'units') continue;

      delete set[propName];
    }

    for (let unitState of set.units) {
      let unitData = unitDataMap.get(unitState.type);

      /*
       * The client may dictate unit type, assignment, and sometimes direction.
       * Other state properties will be computed by the server.
       */
      for (let propName of Object.keys(unitState)) {
        if (propName === 'type' || propName === 'assignment')
          continue;
        else if (propName === 'direction') {
          if (unitData.directional !== false)
            continue;
        }

        delete unitState[propName];
      }
    }

    return set;
  }
  validateSet(set) {
    let team = {};
    let board = new Board();
    board.setState([set.units], [team]);

    this.validateSetIsNotEmpty(team.units);
    this.validateSetIsNotOverFull(team.units);
    this.validateSetUnitPlacements(board, team.units);
    this.cleanSet(set);

    return set;
  }

  toJSON() {
    return { id:this.id, config:this.config };
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
};

serializer.addType({
  name: 'GameType',
  constructor: GameType,
  schema: {
    type: 'object',
    required: [ 'id', 'config' ],
    properties: {
      id: { type:'string', format:'uuid' },
      config: {
        type: 'object',
        required: [ 'name', 'customizable', 'sets' ],
        properties: {
          name: { type:'string' },
          customizable: { type:'boolean' },
          sets: {
            type: 'array',
            items: {
              type: 'object',
            },
          },
          limits: {
            type: 'object',
            required: [ 'tiles', 'units' ],
            properties: {
              tiles: { $ref:'#/definitions/tileRange' },
              units: {
                type: 'object',
                required: [ 'max', 'types' ],
                properties: {
                  max: { type:'number', minimum:1 },
                  types: {
                    type: 'array',
                    subType: 'Map',
                    items: {
                      type: 'array',
                      items: [
                        { type:'string' },
                        {
                          type: 'object',
                          required: [ 'max' ],
                          properties: {
                            max: { type:'number' },
                            size: { type:'number', minimum:1, default:1 },
                            rules: {
                              type: 'object',
                              properties: {
                                maxStone: { type:'boolean' },
                              },
                              additionalProperties: false,
                            },
                            tiles: {
                              type: 'array',
                              items: { $ref:'#/definitions/tiles' },
                            },
                          },
                        },
                      ],
                      additionalItems: false,
                    },
                  },
                },
                additionalProperties: false,
              },
              rules: {
                type: 'object',
                properties: {
                  oneSide: { type:'number' },
                },
                additionalProperties: false,
              },
              fixedPositions: { type:'boolean' },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
    definitions: {
      coords: {
        type: 'array',
        minItems: 2,
        items: [
          { type:'number', minimum:0, maximum:10 },
          { type:'number', minimum:0, maximum:10 },
        ],
        additionalItems: false,
      },
      tileRange: {
        type: 'object',
        required: [ 'start', 'end' ],
        properties: {
          start: { $ref:'#/definitions/coords' },
          end: { $ref:'#/definitions/coords' },
        },
        additionalProperties: false,
      },
      tiles: {
        oneOf: [
          { $ref:'#/definitions/tileRange' },
          {
            type: 'object',
            required: [ 'adjacentTo' ],
            properties: {
              adjacentTo: {
                type: 'object',
                required: [ 'type', 'tiles' ],
                properties: {
                  type: { type:'string' },
                  tiles: {
                    type: 'array',
                    items: {
                      oneOf: [
                        { $ref:'#/definitions/tileRange' },
                        { $ref:'#/definitions/coords' },
                      ],
                    },
                  },
                },
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
          { $ref:'#/definitions/coords' },
        ],
      },
    },
  },
});
