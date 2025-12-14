import TeamSet from '#models/TeamSet.js';
import ServerError from '#server/Error.js';
import Board from '#tactics/Board.js';
import unitDataMap from '#tactics/unitData.js';
import { calcPowerModifiers } from '#tactics/Unit/DragonspeakerMage.js';
import serializer from '#utils/serializer.js';

export const tagByKeyword = new Map([
  [ 'center', { type:'position', name:'center' } ],
  [ 'off center', { type:'position', name:'offcenter' } ],
  [ 'corner', { type:'position', name:'corner' } ],
  [ '1st corner', { type:'position', name:'corner' } ],
  [ 'corner2', { type:'position', name:'corner2' } ],
  [ '2nd corner', { type:'position', name:'corner2' } ],
  [ 'corner3', { type:'position', name:'corner3' } ],
  [ '3rd corner', { type:'position', name:'corner3' } ],
  [ 'off corner', { type:'position', name:'offcorner' } ],
  [ 'spread', { type:'position', name:'spread' } ],
  [ 'rush', { type:'type', name:'rush' } ],
  [ 'anti', { type:'type', name:'anti' } ],
  [ 'anti rush', { type:'type', name:'anti' } ],
  [ 'turt', { type:'type', name:'turtle' } ],
  [ 'turtle', { type:'type', name:'turtle' } ],
]);

for (const unitData of unitDataMap.values()) {
  const tag = { type:'unit', name:unitData.code };
  const keywords = [ unitData.code.toLowerCase(), unitData.shortName.toLowerCase(), unitData.name.toLowerCase(), ...(unitData.keywords ?? []) ];
  for (const keyword of keywords)
    tagByKeyword.set(keyword, tag);
}

/*
 * Since, in theory, a game can have more than 2 players, tests are written
 * to determine if a given team can no longer continue... has lost.
 */
const endGameConditionByType = new Map([
  [ 'default', myTeam => !myTeam.units.some(unit => {
    // Wards don't count.
    if (unit.type === 'BarrierWard' || unit.type === 'LightningWard')
      return false;

    // Shrubs don't count.
    if (unit.type === 'Shrub')
      return false;

    // Paralyzed units don't count.
    if (unit.paralyzed)
      return false;

    return true;
  })],
  [ 'placement', function (myTeam, data, oppTeams) {
    // If the unit that must be placed is dead, we lost
    if (endGameConditionByType.get('dead').call(this, myTeam, data, oppTeams))
      return true;

    const board = myTeam.units[0].board;

    // If the unit is placed correctly by another team, we lost
    return oppTeams.some(team => {
      const rotation = board.getRotation(board.rotation, board.getDegree(board.rotation, team.position));
      const tiles = this._getTileLimit(board, data.tiles, rotation);

      return team.units.some(u => u.type === data.unitType && tiles.has(u.assignment));
    });
  }],
  [ 'dead', (myTeam, data) => !myTeam.units.some(u => u.type === data.unitType) ],
]);

export default class GameType {
  constructor(data) {
    Object.assign(this, data);

    this.config.sets = this.config.sets.map(s => {
      // The id is necessary for displaying curated set names instead of generated names.
      s.id = TeamSet.createId(s);
      s.name ??= 'Default';
      return s;
    });
    this._tagByKeyword = null;
  }

  get name() {
    return this.config.name;
  }
  get notice() {
    return this.config.notice ?? null;
  }
  get description() {
    return this.config.description;
  }
  get isCustomizable() {
    return this.config.customizable;
  }
  get requiredUnitType() {
    const requiredUnitTypes = Array.from(this.config.limits.units.types.entries()).filter(([ t, c ]) => c.required);
    if (requiredUnitTypes.length !== 1)
      return null;
    return requiredUnitTypes[0][0];
  }
  get hasFixedUnits() {
    if (!this.isCustomizable)
      return true;

    const maxPoints = Array.from(this.config.limits.units.types.values()).reduce((s, u) => s + u.max * (u.points ?? 1), 0);
    return this.config.limits.points >= maxPoints;
  }
  get hasFixedSides() {
    return !this.isCustomizable || this.config.limits.tiles.start[0] === 0 && this.config.limits.tiles.end[0] < 6;
  }
  get hasFixedPositions() {
    return (
      !this.isCustomizable ||
      this.config.limits.tiles.start[0] !== 0 ||
      this.config.limits.tiles.start[1] !== 0 ||
      this.config.limits.tiles.end[0] !== 10 ||
      this.config.limits.tiles.end[1] !== 4
    );
  }
  get isFixedTurtle() {
    return this.config.limits.units.types.get('StoneGolem')?.required === 1;
  }
  get localTagByPath() {
    const localTagByPath = new Map();
    const addSet = (set, tag) => {
      const path = `/${tag.type}/${tag.name}`;
      if (!localTagByPath.has(path))
        localTagByPath.set(path, { ...tag, sets:[] });
      if (!localTagByPath.get(path).sets.some(s => s.id === set.id))
        localTagByPath.get(path).sets.push(set);
    };

    for (const set of this.config.sets) {
      if (set.name)
        addSet(set, { type:'keyword', name:set.name });
      if (set.tags)
        for (const tag of set.tags) {
          addSet(set, { type:'keyword', name:tag.name });
          for (const keyword of (tag.keywords ?? []))
            addSet(set, { type:'keyword', name:keyword });
        }
    }

    return localTagByPath;
  }
  get tagByKeyword() {
    if (this._tagByKeyword)
      return this._tagByKeyword;
    const localTag = new Map();
    const localTagByKeyword = new Map();
    const addTag = (keyword, tag) => {
      const path = `/${tag.type}/${tag.name}` + (tag.type !== 'unit' || tag.count === undefined ? '' : `/${tag.count}`);
      if (localTag.has(path))
        tag = localTag.get(path);
      else
        localTag.set(path, tag);
      localTagByKeyword.set(keyword.toLowerCase(), tag);
      localTagByKeyword.set(keyword.split(' ').join('').toLowerCase(), tag);
    };

    for (const [ keyword, tag ] of tagByKeyword)
      addTag(keyword, tag);

    for (const set of this.config.sets) {
      if (set.name)
        addTag(set.name, { type:'keyword', name:set.name });
      if (set.tags)
        for (const tag of set.tags) {
          addTag(tag.name, { type:'keyword', name:tag.name });
          for (const keyword of (tag.keywords ?? []))
            addTag(keyword, { type:'keyword', name:keyword });
        }
    }

    return this._tagByKeyword = localTagByKeyword;
  }

  getWinningTeams(teams) {
    const losingTeams = this.getLosingTeams(teams);
    // All teams win if all teams lose.  This is a draw.
    if (losingTeams.length === teams.length)
      return teams;

    const runningTeams = teams.filter(t => !losingTeams.includes(t));
    // If more than one team hasn't lost, game is not over.
    if (runningTeams.length > 1)
      return [];

    // The one team won.
    return runningTeams;
  }

  getLosingTeams(teams) {
    const endGameCondition =
      !this.config.endGameCondition ? [{ type:'default' }] :
      Array.isArray(this.config.endGameCondition) ? this.config.endGameCondition :
      [ this.config.endGameCondition ];

    return teams.filter(t => endGameCondition.some(egc =>
      endGameConditionByType.get(egc.type).call(this, t, egc, teams.filter(ot => ot !== t))
    ));
  }

  getUnitTypes() {
    const config = this.config;

    if (config.limits)
      return [...config.limits.units.types.keys()];
    else
      return [...new Set(config.sets[0].units.map(u => u.type))];
  }
  getPoints() {
    return this.config.limits.points;
  }
  getUnitPoints(unitType) {
    return this.config.limits.units.types.get(unitType).points ?? 1;
  }
  getUnitMaxCount(unitType) {
    return this.config.limits.units.types.get(unitType).max;
  }
  getStats(units) {
    if (!this.isCustomizable)
      return { available:0 };

    const unitCounts = new Map();
    const stats = {
      points: {
        total: this.getPoints(),
        used: 0,
      },
      units: [],
      available: 0,
    };

    for (const unit of units) {
      if (unit.disposition === 'dead') continue;

      if (unitCounts.has(unit.type))
        unitCounts.set(unit.type, unitCounts.get(unit.type) + 1);
      else
        unitCounts.set(unit.type, 1);

      stats.points.used += this.getUnitPoints(unit.type);
    }

    stats.points.remaining = stats.points.total - stats.points.used;

    for (const unitType of this.getUnitTypes()) {
      const unitData = unitDataMap.get(unitType);
      const unitStats = {
        name: unitData.name,
        type: unitType,
        points: this.getUnitPoints(unitType),
        max: this.getUnitMaxCount(unitType),
        count: unitCounts.get(unitType) ?? 0,
      };
      unitStats.available = Math.min(
        unitStats.max - unitStats.count,
        Math.floor(stats.points.remaining / unitStats.points),
      );

      stats.units.push(unitStats);
    }

    if (stats.points.remaining) {
      let remaining = stats.points.remaining;
      stats.units.sort((a,b) => b.available - a.available || a.points - b.points);

      for (const unitStats of stats.units) {
        const available = Math.min(
          unitStats.max - unitStats.count,
          Math.floor(remaining / unitStats.points),
        );
        if (available === 0)
          break;

        stats.available += available;
        remaining -= available * unitStats.points;
      }
    }

    return stats;
  }
  getAvailableTiles(board, unitType) {
    const limits = this.config.limits;
    const tiles = this._getTileLimit(board, limits.tiles);

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
  validateSetIsFull(units) {
    return this.getStats(units).available === 0;
  }
  validateSetIsNotOverFull(units) {
    const limits = this.config.limits;
    if (limits.units.max && units.length > limits.units.max)
      throw new ServerError(403, 'You have exceeded the max allowed units');

    const sum = units.reduce((s,u) => s + (limits.units.types.get(u.type).points ?? 1), 0);
    if (sum > limits.points)
      throw new ServerError(403, 'You have exceeded the max allowed points');
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
      if (propName === 'id') continue;
      if (propName === 'slot') continue;
      if (propName === 'name') continue;
      if (propName === 'units') continue;

      delete set[propName];
    }

    TeamSet.cleanUnits(set.units);

    return set;
  }
  validateSet(set) {
    let team = {};
    let board = new Board();
    board.setState([set.units], [team]);

    this.validateSetIsNotEmpty(team.units);
    this.validateSetUnitPlacements(board, team.units);
    this.validateSetIsNotOverFull(team.units);
    this.cleanSet(set);

    return set;
  }
  getTeamSetTags(teamSet) {
    const tags = [];
    if (!this.isCustomizable)
      return tags;

    const set = this.config.sets.find(s => s.id === teamSet.id);
    if (set) {
      if (set.name && !set.tags?.some(t => t.type === 'name')) {
        tags.push({ type:'name', name:set.name });
        tags.push({ type:'keyword', name:set.name });
      }
      if (set.tags) {
        for (const tag of set.tags) {
          tags.push({ type:tag.type, name:tag.name, ...(tag.keywords ? { keywords:tag.keywords } : {}) });
          tags.push({ type:'keyword', name:tag.name });
          for (const keyword of (tag.keywords ?? []))
            tags.push({ type:'keyword', name:keyword });
        }
      }
    }

    if (this.hasFixedSides || this.isFixedTurtle) {
      const position = this.getTeamSetUnitTypePosition(teamSet, 'StoneGolem') ?? this.getTeamSetUnitTypePosition(teamSet, 'Cleric');
      if (position)
        tags.push({ type:'position', name:position });
    } else if (!this.hasFixedSides) {
      const numPoints = this.config.limits.points;
      const numLeftEdge = teamSet.units.reduce((s, unit) => s + (unit.assignment[0] < 2), 0);
      const numLeftSide = teamSet.units.reduce((s, unit) => s + (unit.assignment[0] < 5), 0);
      const numRightEdge = teamSet.units.reduce((s, unit) => s + (unit.assignment[0] > 8), 0);
      const numRightSide = teamSet.units.reduce((s, unit) => s + (unit.assignment[0] > 5), 0);

      const clericPosition = this.getTeamSetUnitTypePosition(teamSet, 'Cleric');
      const requiredUnitType = this.requiredUnitType;
      if (clericPosition)
        tags.push({ type:'position', name:clericPosition });
      else if (requiredUnitType)
        tags.push({ type:'position', name:this.getTeamSetUnitTypePosition(teamSet, requiredUnitType) });
      else if (numLeftEdge && numRightEdge)
        tags.push({ type:'position', name:'spread' });
      else if (Math.abs(numLeftSide - numRightSide) <= numPoints * 0.9)
        tags.push({ type:'position', name:'center' });
      else
        tags.push({ type:'position', name:'corner' });
    }
    if (!this.hasFixedPositions) {
      const numPoints = this.config.limits.points;
      const numFrontLine = teamSet.units.reduce((s, unit) => s + (unit.assignment[1] === 4 ? 1 : 0), 0);
      const numFrontSide = teamSet.units.reduce((s, unit) => s + (unit.assignment[1] > 2), 0);
      const numBackSide = teamSet.units.reduce((s, unit) => s + (unit.assignment[1] < 2), 0);
      const hasStoneGolem = teamSet.units.some(u => u.type === 'StoneGolem' && u.assignment[1] < 3);
      const hasLW = teamSet.units.some(u => u.type === 'LightningWard');
      const hasBW = teamSet.units.some(u => u.type === 'BarrierWard');

      if (numFrontLine >= 7 || numFrontLine >= numPoints * 0.7 || numFrontSide >= numPoints * 0.9)
        tags.push({ type:'type', name:'rush' });
      else if (hasStoneGolem || hasLW && hasBW || numBackSide >= numPoints * 0.9)
        tags.push({ type:'type', name:'turtle' });
      else if (!tags.some(t => t.type === 'position' && t.name === 'spread'))
        tags.push({ type:'type', name:'anti' });
    }

    if (!this.hasFixedUnits) {
      const unitMap = teamSet.units.reduce((map, unit) => map.set(unit.type, (map.get(unit.type) ?? 0) + 1), new Map());
      for (const unitType of this.getUnitTypes()) {
        const unitConfig = this.config.limits.units.types.get(unitType);
        if (unitConfig.required === unitConfig.max)
          continue;

        const unitCount = unitMap.get(unitType) ?? 0;
        if (unitCount && unitConfig.max === 1)
          tags.push({ type:'unit', name:unitDataMap.get(unitType).code });
        else
          tags.push({ type:'unit', name:unitDataMap.get(unitType).code, count:unitCount });
      }
    }

    const keywordsByTag = Array.from(tagByKeyword).reduce((map, [kw,tag]) => {
      if (kw === tag.name) return map;
      const tagKey = `${tag.type}:${tag.name}`;
      map.set(tagKey, (map.get(tagKey) ?? []).concat(kw));
      return map;
    }, new Map());

    for (const tag of tags) {
      const keywords = keywordsByTag.get(`${tag.type}:${tag.name}`);
      if (keywords)
        tag.keywords = keywords;
    }

    return tags;
  }
  getTeamSetUnitTypePosition(teamSet, unitType) {
    const units = teamSet.units.filter(u => u.type === unitType);
    if (units.length === 1) {
      if (units[0].assignment[0] === 5 && units[0].assignment[1] === 0)
        return 'center';
      else if ([ 4, 6 ].includes(units[0].assignment[0]) && units[0].assignment[1] === 0)
        return 'offcenter';
      else if ([ 2, 8 ].includes(units[0].assignment[0]) && units[0].assignment[1] === 0)
        return 'corner';
      else if ([ 1, 9 ].includes(units[0].assignment[0]) && units[0].assignment[1] === 1)
        return 'corner2';
      else if ([ 0, 10 ].includes(units[0].assignment[0]) && units[0].assignment[1] === 2)
        return 'corner3';
      else if ([ 3, 7 ].includes(units[0].assignment[0]) && units[0].assignment[1] === 0)
        return 'offcorner';
    } else if (units.length > 1) {
      if (units.every(u => u.assignment[0] < 4))
        return 'corner';
      else if (units.every(u => u.assignment[0] > 6))
        return 'corner';
      else if (units.every(u => u.assignment[0] > 3 && u.assignment[0] < 7))
        return 'center';
      else
        return 'spread';
    }
    return null;
  }

  toJSON() {
    return { id:this.id, config:this.config };
  }

  _getTileLimit(board, tileLimit, rotation = board.rotation) {
    if (!tileLimit)
      return new Set([...Object.values(board.tiles)]);

    const degree = board.getDegree('N', rotation);
    const tiles = new Set();

    if (!Array.isArray(tileLimit))
      tileLimit = [tileLimit];

    for (let i = 0; i < tileLimit.length; i++) {
      const limit = tileLimit[i];

      if (limit.start && limit.end) {
        for (let x = limit.start[0]; x <= limit.end[0]; x++) {
          for (let y = limit.start[1]; y <= limit.end[1]; y++) {
            const tile = board.getTileRotation([x, y], degree);
            if (!tile) continue;

            tiles.add(tile);
          }
        }
      } else if (limit.adjacentTo) {
        let adjacentTo = limit.adjacentTo;
        if (typeof adjacentTo === 'string')
          adjacentTo = { type:adjacentTo };

        const adjacentLimit = this._getTileLimit(board, adjacentTo.tiles);
        const units = board.teamsUnits[0].filter(u => u.type === adjacentTo.type);
        for (let j = 0; j < units.length; j++) {
          const unit = units[j];
          if (unit.disposition === 'dead') continue;

          const context = unit.assignment;
          if (!adjacentLimit.has(context)) continue;

          for (const direction of ['N','E','S','W']) {
            if (context[direction])
              tiles.add(context[direction]);
          }
        }
      } else if (Array.isArray(limit)) {
        const tile = board.getTileRotation(limit, degree);
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
            required: [ 'tiles', 'points', 'units' ],
            properties: {
              tiles: { $ref:'#/definitions/tileRange' },
              points: { type:'number', minimum:1 },
              units: {
                type: 'object',
                required: [ 'types' ],
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
                            max: { type:'number', minimum:1 },
                            points: { type:'number', minimum:1, default:1 },
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
          endGameCondition: {
            oneOf: [
              { type:'array', items:{ $ref:'#/definitions/endGameCondition' } },
              { $ref:'#/definitions/endGameCondition' }
            ],
          },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
    definitions: {
      endGameCondition: {
        type: 'object',
        required: [ 'type' ],
        oneOf: [
          {
            properties: {
              type: { type:'string', const:'placement' },
              unitType: { type:'string' },
              tiles: { $ref:'#/definitions/tiles' },
            },
          },
          {
            properties: {
              type: { type:'string', const:'dead' },
              unitType: { type:'string' },
            },
          },
        ],
      },
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
