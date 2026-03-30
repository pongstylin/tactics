import Polygon from '#utils/Polygon.js';
import emitter from '#utils/emitter.js';
import { numifyColor, colorFilterMap } from '#tactics/colorMap.js';

const HALF_TILE_WIDTH  = 44;
const HALF_TILE_HEIGHT = 28;

export default class Unit {
  constructor(data, board) {
    if (!data.type)
      throw new Error('Required type');

    Object.assign(this, data, {
      data: data,
      board: board,
      spriteSource: data.type,
      spriteName: null,
      unitSprite: 'unit',
      trimSprite: 'trim',
      shadowSprite: 'shadow',
      sprite: null,

      // These properties are initialized externally
      id:    null,
      title: null,
      team:  null,
      color: null,

      assignment:  null,
      disposition: null,
      notice:      null,

      activated: false,
      focused:   false,
      draggable: false,

      health:    data.health ?? 0,
      lifespan:  data.lifespan ? data.lifespan * board.teams.length : Infinity,

      mHealth:   0,
      mLifespan: 0,
      mBlocking: 0,
      mPower:    0,
      mArmor:    0,
      mRecovery: 0,

      // May be set to an array of unit objects
      focusing:  false,
      poisoned:  false,
      paralyzed: false,
      barriered: false,
      armored:   false,

      pixi:    null,
      filters: {},

      // Unit state at start of turn.  Set by Board.setInitialState().
      initialState: null,

      _sprite: null,
      _pulse: null,
    });
  }

  /*
   * Stubs.  Used by some Unit subclasses.
   */
  attach() {
  }
  detach() {
  }

  getMoveTiles() {
    let board = this.board;
    if (this.mType === 'path')
      // Use an optimized path finding algorithm.
      return board.getUnitPathRange(this);
    else if (this.mType === 'teleport')
      // Use an even faster algorithm.
      return board.getTileRange(this.assignment, 1, this.mRadius, true);
    else if (this.mType === false)
      return [];
    else
      throw new TypeError('Unsupported mType');
  }
  getAttackTiles(source = this.assignment) {
    let board  = this.board;
    let range  = this.aRange;

    if (this.aLinear)
      // Dark Magic Witch, Beast Rider, Dragon Tyrant, Chaos Dragon
      // All existing units have a minimum range of 1.
      return board.getTileLinearRange(source, range[1]);
    else if (range) {
      const tiles = board.getTileRange(source, ...range);
      if (this.canSpecial() && !tiles.some(t => t === source))
        tiles.unshift(source);
      return tiles;
    } else
      return [];
  }
  getTargetTiles(target, source = this.assignment) {
    if (target === source && this.canSpecial())
      return this.getSpecialTargetTiles();

    if (this.aLOS === true)
      return this.getLOSTargetTiles(target, source);
    else if (this.aAll === true)
      return this.getAttackTiles(source);
    else if (this.aLinear === true) {
      let direction = this.board.getDirection(source, target);
      let targets = [];

      let context = source;
      while (targets.length < this.aRange[1]) {
        context = context[direction];
        if (!context) break;

        targets.push(context);
      }

      return targets;
    }

    return [ target ];
  }
  getSpecialTargetTiles() {
    return [];
  }
  /*
   * Reviews all combinations of moving (or not) then attacking to determine all
   * tiles that can be targeted by an attack.
   *
   * Returns: Set object
   */
  getAllTargetTiles() {
    let moveTiles = this.getMoveTiles();
    let attackTiles;
    let targetTiles;
    let tiles = new Set();
    let i, j, k;

    moveTiles.unshift(this.assignment);

    for (i = 0; i < moveTiles.length; i++) {
      attackTiles = this.getAttackTiles(moveTiles[i]);

      for (j = 0; j < attackTiles.length; j++) {
        targetTiles = this.getTargetTiles(attackTiles[j]);

        for (k = 0; k < targetTiles.length; k++) {
          tiles.add(targetTiles[k]);
        }
      }
    }

    return tiles;
  }
  getTargetUnits(target) {
    let target_units = [];

    if (this.aLOS === true) {
      let unit = this.getLOSTargetUnit(target);
      if (unit)
        target_units.push(unit);
    } else
      target_units = this.getTargetTiles(target)
        .filter(tile => !!tile.assigned)
        .map(tile => tile.assigned);

    if (this.aType !== 'melee' && this.aType !== 'magic')
      target_units = target_units.filter(u => u.type !== 'Shrub');

    return target_units;
  }
  getLOSTargetTiles(target, source) {
    source = source || this.assignment;

    // Get the absolute position of the line of sight.
    // The line is drawn between the center of the source and target tiles.
    let lineOfSight = [
      source.position[0] + HALF_TILE_WIDTH,
      source.position[1] + HALF_TILE_HEIGHT,
      target.position[0] + HALF_TILE_WIDTH,
      target.position[1] + HALF_TILE_HEIGHT,
    ];

    // Define a slightly smaller tile shape for targeting.
    let hit_area = new Polygon([
      43, 12, // top-left
      46, 12, // top-right
      70, 26, // right-top
      70, 29, // right-bottom
      46, 44, // bottom-right
      43, 44, // bottom-left
      18, 29, // left-bottom
      18, 26, // left-top
      43, 12, // close
    ]);

    // Set oneX and oneY to 1 or -1 depending on attack direction.
    let oneX = target.x === source.x
      ? 1 // Could be any number
      : (target.x - source.x) / Math.abs(target.x - source.x);
    let oneY = target.y === source.y
      ? 1 // Could be any number
      : (target.y - source.y) / Math.abs(target.y - source.y);

    // Trace a path from source to target, testing tiles along the way.
    let target_tiles = [];
    for (let x = source.x; x !== target.x + oneX; x += oneX) {
      for (let y = source.y; y !== target.y + oneY; y += oneY) {
        let tile = this.board.getTile(x, y);
        if (!tile || tile === source) continue;

        // Get the relative position of the line of sight to the tile.
        let relativeLineOfSight = [
          lineOfSight[0] - tile.position[0],
          lineOfSight[1] - tile.position[1],
          lineOfSight[2] - tile.position[0],
          lineOfSight[3] - tile.position[1],
        ];

        if (hit_area.intersects(...relativeLineOfSight))
          target_tiles.push(tile);
      }
    }

    return target_tiles;
  }
  getLOSTargetUnit(target, source) {
    let target_tile = this.getLOSTargetTiles(target, source).find(t => !!t.assigned);

    return target_tile ? target_tile.assigned : null;
  }
  /*
   * This method calculates what might happen if this unit attacked a target unit.
   * This helps bots make a decision on the best choice to make.
   */
  calcAttack(targetUnit, from, target, stats = null) {
    if (!from)
      from = this.assignment;
    if (!target)
      target = targetUnit.assignment;

    stats ??= {
      power: Math.max(0, this.power + this.mPower),
      aType: this.aType,
      aLOS: this.aLOS,
      aPierce: false,
    };

    const calc     = {};
    const armor    = stats.aPierce ? 0 : Math.max(0, Math.min(100, targetUnit.armor + targetUnit.mArmor));
    const blocking = targetUnit.blocking + targetUnit.mBlocking;

    // Equality check the unit ID since targetUnit may be a clone.
    if (stats.aLOS && this.getLOSTargetUnit(target, from).id !== targetUnit.id) {
      // Armor reduces melee/magic damage.
      calc.damage = Math.round(stats.power * (100 - armor) / 100);

      // Another unit is in the way.  No chance to hit target unit.
      calc.chance = 0;
      calc.miss = 'miss';
    } else if (
      (
        /^(melee|magic|heal)$/.test(stats.aType) &&
        (targetUnit.barriered || targetUnit.disposition === 'unbreakable')
      ) || (
        stats.aType === 'melee' &&
        targetUnit.blocking === 100 &&
        targetUnit.directional === false &&
        !targetUnit.paralyzed &&
        !targetUnit.focusing
      )
    ) {
      calc.miss = 'immune';
      calc.chance = 0;
      calc.damage = 0;
    } else if (stats.aType === 'melee') {
      // Armor reduces magic damage.
      calc.damage = Math.round(stats.power * (100 - armor) / 100);

      if (!targetUnit.canBlock())
        calc.chance = 100;
      else if (targetUnit.directional === false) {
        // Wards have 100% blocking from all directions.
        // Chaos Seed has 50% blocking from all directions.
        // Shrubs have 0% blocking from all directions.
        calc.chance = Math.max(0, Math.min(100, 100 - blocking));

        // A successful block reduces Chaos Seed blocking temporarily.
        // But, a failed block does not boost Chaos Seed blocking.
        calc.bonus   = 0;
        calc.penalty = 100 - targetUnit.blocking;
      } else {
        // My direction to target can be diagonal, such as NW
        let direction = this.board.getDirection(from, targetUnit.assignment, true);

        if (direction.indexOf(targetUnit.direction) > -1) {
          // Hitting a unit from behind always succeeds.
          calc.chance = 100;
        } else {
          let team = this.team;
          // Hits from the side have a greater chance and penalty
          let factor = direction.indexOf(this.board.getRotation(targetUnit.direction, 180)) > -1 ? 1 : 2;
          let chance = Math.max(0, Math.min(100, 100 - blocking/factor));

          if (team.useRandom)
            calc.chance = chance;
          else if (chance <= 50)
            calc.chance = 0;
          else if (targetUnit.blocking && targetUnit.mBlocking/factor >= targetUnit.blocking/2)
            calc.chance = 0;
          else
            calc.chance = 100;

          if (calc.chance === 0)
            calc.miss = 'block';

          calc.bonus   = targetUnit.blocking;
          calc.penalty = 100*factor - targetUnit.blocking;
        }
      }
    } else if (stats.aType === 'magic') {
      // Armor reduces magic damage.
      calc.damage = Math.round(stats.power * (100 - armor) / 100);

      // Magic can only be stopped by barriers.
      calc.chance = 100;
    } else if (stats.aType === 'heal') {
      // Armor has no effect on heal power.
      calc.damage = -stats.power;

      // Healing can only be stopped by barriers.
      calc.chance = 100;
    } else {
      // The attack type is the name of an effect.
      calc.effect = stats.aType;

      // Not even barriers can stop effects.
      calc.chance = 100;
    }

    return calc;
  }

  getMoveResults(action) {
    return [];
  }
  /*
   * An attack might affect multiple targets at the same time.  So, it doesn't
   * matter if the first target we look at removed armor from the 2nd.  The
   * 2nd target is hit as if it is still armored.  So, each attack is calculated
   * as if prior attacks have not yet happened.
   *
   * But there's a catch.  Attack results DO recognize that previous attacks
   * have happened.  So, if paralyzing the 1st target removed paralysis from
   * the 2nd, the 2nd target attack results must recognize that it is not still
   * paralyzed by the 1st.
   *
   * This dichotomy is managed by calculating all the attacks first then results
   * are applied after they are determined for each target.
   */
  getAttackResults(action) {
    const board = this.board;
    const calcs = this.getTargetUnits(action.target).map(targetUnit => [
      targetUnit,
      this.calcAttack(targetUnit, this.assignment, action.target),
    ]);

    return calcs.map(([targetUnit, calc]) => {
      const result = this.getAttackResult(action, targetUnit, calc);
      board.applyActionResults([ result ]);
      this.getAttackSubResults(result);
      // Reapply the result since getDeadResult can modify it.
      board.applyActionResults([ result ]);
      return result;
    });
  }
  /*
   * The default behavior for this method is appropriate for melee and magic
   * attacks and healing, but units with other attacks should override this.
   */
  getAttackResult(action, unit, calc) {
    const result = { unit };
    calc ??= this.calcAttack(unit, this.assignment, action.target);

    if (calc.miss === 'immune') {
      result.miss = 'immune';

      return result;
    }

    let random;

    // This metric is used to determine which actions required luck to determine results.
    if (calc.chance > 0 && calc.chance < 100) {
      random = this.team.random();

      result.luck = Object.assign({ chance:calc.chance }, random);
    } else
      random = { number:50 };

    if (random.number < calc.chance) {
      result.damage = calc.damage;
      result.changes = {};
      if (result.damage) {
        result.changes.mHealth = Math.max(-unit.health, Math.min(0, unit.mHealth - calc.damage));
        if (result.changes.mHealth === unit.mHealth)
          delete result.changes.mHealth;
      }
      if (calc.bonus)
        result.changes.mBlocking = unit.mBlocking += calc.bonus;

      if (Object.keys(result.changes).length === 0)
        delete result.changes;
    } else {
      result.miss = 'blocked';

      if (calc.penalty || unit.directional !== false) {
        result.changes = {};

        if (unit.directional !== false) {
          const direction = this.board.getDirection(unit.assignment, this.assignment, unit.direction);
          if (direction !== unit.direction)
            result.changes.direction = unit.direction = direction;
        }

        if (calc.penalty)
          result.changes.mBlocking = unit.mBlocking -= calc.penalty;
      }
    }

    return result;
  }
  /*
   * Apply sub-results that are after-effects of certain results.
   */
  getAttackSubResults(result) {
    if (result.miss) return;

    const board = this.board;
    const unit = result.unit;
    const subResults = result.results || [];

    // Most attacks break the focus of focusing units.
    if (unit.focusing) {
      if (
        this.aType === 'heal' ||
        this.aType === 'barrier' ||
        this.aType === 'armor'
      ) return;

      for (const subResult of unit.getBreakFocusResult(true)) {
        const foundResult = subResults.find(r => r.unit === subResult.unit);
        if (foundResult)
          foundResult.changes.merge(subResult.changes);
        else
          subResults.push(subResult);
      }
    }

    if (unit.getDeadResult(this, result)) {
      board.trigger({
        type: 'dropUnit',
        unit,
        attacker: this,
        addResults: rs => {
          for (const r of rs) {
            const index = subResults.findIndex(sr => sr.unit === r.unit);
            if (index > -1)
              subResults[index].changes.merge(r.changes);
            else
              subResults.push(r);
          }
        },
      });

      // Remove focus from dead units
      if (unit.paralyzed || unit.poisoned || unit.armored) {
        const focusingUnits = [
          ...(unit.paralyzed || []),
          ...(unit.poisoned  || []),
          ...(unit.armored   || []),
        ];

        // All units focusing on this dead unit can stop.
        focusingUnits.forEach(fUnit => {
          if (fUnit === unit)
            return;

          subResults.push({
            unit: fUnit,
            changes: {
              focusing: fUnit.focusing.length === 1
                ? false
                : fUnit.focusing.filter(u => u !== unit),
            }
          });
        });

        // Stop showing the unit as paralyzed or poisoned
        if (unit.paralyzed || unit.poisoned) {
          const subChanges = {};
          if (unit.paralyzed)
            subChanges.paralyzed = unit.paralyzed = false;
          if (unit.poisoned)
            subChanges.poisoned = unit.poisoned = false;

          subResults.push({
            unit: unit,
            changes: subChanges,
          });
        }
      }
    }

    if (subResults.length)
      result.results = subResults;
  }
  getDeadResult(attacker, result) {
    if (![ 'melee', 'magic' ].includes(attacker.aType)) return false;

    const health = this.health ?? 0;
    const mHealth = result.changes?.mHealth ?? 0;

    if (mHealth > -health) return false;

    result.changes ??= {};
    result.changes.disposition = 'dead';
    return true;
  }
  /*
   * Before drawing a unit, it must first have an assignment and direction.
   */
  setPositionToTile(tile = this.assignment) {
    if (!this.pixi)
      this.draw(true);
    this.pixi.position = tile.getCenter().clone();

    // Reset the visual position, if any
    delete this.pixi.data.position;
  }
  getStyles() {
    return { [ this.trimSprite ]:{ rgb:this.color } };
  }
  /*
   * A hook for changing an animation frame before it is rendered.
   */
  fixupFrame(frame) {
    const unitContainer = this.getContainerByName(this.unitSprite, frame.container);
    unitContainer.filters = Array.from(Object.values(this.filters));
  }
  draw(skipPosition = false) {
    this.frame = new PIXI.Container();
    this.frame.label = 'frame';

    this.pixi = new PIXI.Container();
    this.pixi.data = {};
    this.pixi.addChild(this.frame);

    if (this.assignment && !skipPosition)
      this.setPositionToTile();

    return this.drawStand();
  }
  drawAvatar(options) {
    if (!this._sprite)
      this._sprite = Tactics.getSprite(this.spriteSource);

    options = Object.assign({
      renderer: Tactics.game?.renderer,
      direction: 'S',
      withFocus: false,
      withShadow: false,
      withHighlight: false,
      as: 'frame',
    }, options);

    const frame = this._sprite.renderFrame({
      spriteName: this.spriteName,
      actionName: 'stand',
      direction: options.direction,
      styles: this.getStyles(),
      fixup: this.fixupFrame.bind(this),
    }).container;

    frame.filters = this.board.unitsContainer.filters;

    if (options.withHighlight) {
      const unitContainer = this.getContainerByName(this.unitSprite, frame);
      const filter = new PIXI.filters.ColorMatrixFilter();
      filter.brightness(1.6);
      unitContainer.filters = [ filter ];
    }

    const shadowContainer = this.getContainerByName(this.shadowSprite, frame);
    if (!options.withShadow)
      shadowContainer.alpha = 0;

    if (options.withFocus) {
      const core = Tactics.getSprite('core');
      const focusContainer = core.renderFrame({ spriteName:'Focus' }).container;
      focusContainer.children[0].tint = numifyColor(this.color);

      shadowContainer.parent.addChildAt(focusContainer, shadowContainer.parent.getChildIndex(shadowContainer));
    }

    let avatar;
    if (options.as === 'image') {
      const bounds = frame.getLocalBounds();
      const avatarCanvas = options.renderer.extract.canvas(frame);
      avatar = {
        x: bounds.x,
        y: bounds.y,
        src: avatarCanvas.toDataURL('image/png'),
      };
    } else if (options.as === 'sprite') {
      const bounds = frame.getLocalBounds();
      const avatarTexture = options.renderer.extract.texture(frame);
      avatar = PIXI.Sprite.from(avatarTexture);
      avatar.x = bounds.x;
      avatar.y = bounds.y;
    } else
      avatar = frame;

    return avatar;
  }
  drawFrame(actionName, direction = this.direction, frameId) {
    if (!this._sprite)
      this._sprite = Tactics.getSprite(this.spriteSource);

    const frame = this._sprite.renderFrame({
      actionName,
      direction,
      frameId,
      styles: this.getStyles(),
      fixup: this.fixupFrame.bind(this),
    });

    const focusContainer = this.getContainerByName('Focus');
    if (focusContainer) {
      const shadowContainer = this.getContainerByName(this.shadowSprite, frame.container);
      shadowContainer.addChild(focusContainer);
    }

    // Reset frame offsets
    this.frame.position.x = 0;
    this.frame.position.y = 0;

    this.frame.removeChildren();
    this.frame.addChild(frame.container);
    return this;
  }
  drawTurn(direction = this.direction) {
    if (!isNaN(direction)) direction = this.board.getRotation(this.direction, direction);

    return this.drawFrame('turn', direction);
  }
  drawStand(direction = this.direction) {
    if (this.directional === false)
      direction = 'S';
    else {
      if (!isNaN(direction)) direction = this.board.getRotation(this.direction, direction);
    }

    return this.drawFrame('stand', direction);
  }
  drawStagger(direction = this.direction) {
    if (!this.hasAction('stagger'))
      return this.drawStand(direction);

    if (this.directional === false)
      direction = 'S';
    else {
      if (!isNaN(direction)) direction = this.board.getRotation(this.direction, direction);
    }

    return this.drawFrame('stagger', direction);
  }
  hasAction(actionName) {
    return this._sprite.hasAction(actionName);
  }
  renderAnimation(actionName, direction = this.direction) {
    return this._sprite.renderAnimation({
      actionName,
      direction,
      container: this.frame,
      styles: this.getStyles(),
      fixup: this.fixupFrame.bind(this),
    });
  }
  getContainerByName(name, container = this.frame) {
    for (let child of container.children) {
      if (!(child instanceof PIXI.Container)) continue;

      if (child.label === name)
        return child;

      let hit = this.getContainerByName(name, child);
      if (hit !== undefined)
        return hit;
    }
  }
  offsetFrame(offsetRatio, direction, reset = false) {
    let offset = this.board.getOffset(offsetRatio, direction);
    let frame = this.frame;

    if (reset) {
      frame.position.x = offset[0];
      frame.position.y = offset[1];
    } else {
      frame.position.x += offset[0];
      frame.position.y += offset[1];
    }

    return this;
  }
  /*
   * DEPRECATED: Use Board.assign() instead.
   */
  assign(assignment) {
    let pixi = this.pixi;

    if (this.assignment && this.assignment.assigned === this)
      this.assignment.dismiss();
    this.assignment = assignment;

    if (assignment) {
      assignment.assign(this);

      if (pixi)
        pixi.position = assignment.getCenter().clone();
    }

    return this;
  }
  /*
   * Specify the relative direction using "degrees" of rotation, e.g. 90.
   * - OR -
   * Specify the absolute direction, e.g. 'N'.
   */
  stand(direction) {
    if (this.directional === false)
      direction = 'S';
    else {
      if (!direction) direction = this.direction;
      if (!isNaN(direction)) direction = this.board.getRotation(this.direction, direction);
    }

    this.direction = direction;
    if (this.pixi)
      this.drawStand();
  }
  /*
   * This is called before a focusing unit moves, attacks, or turns.
   */
  break(action) {
    return Promise.resolve();
  }
  /*
   * Animate movement to a new tile assignment
   * Currently assumes walking, but this will change
   */
  move(action, speed) {
    let anim = new Tactics.Animation({ speed });

    if (this.mType === 'path')
      anim.splice(this.animWalk(action.assignment));
    else if (this.mType === 'teleport')
      anim.splice(this.animTeleport(action));
    else
      throw 'Unknown movement type';

    return anim.play();
  }
  attack(action, speed) {
    let anim = new Tactics.Animation({ speed });

    if (this.directional !== false)
      anim.splice(this.animTurn(action.direction));

    anim.splice(this.animAttack(action));

    return anim.play();
  }
  attackSpecial(action, speed) {
    let anim = new Tactics.Animation({ speed });

    if (this.directional !== false)
      anim.splice(this.animTurn(action.direction));

    anim.splice(this.animAttackSpecial(action));
    anim.addFrame(() => this.stand());

    return anim.play();
  }
  transform(action, speed) {
    const anim = new Tactics.Animation({ speed });

    anim.splice(this.animTransform(action));
    anim.addFrame(() => this.stand());

    return anim.play();
  }
  turn(action, speed) {
    if (this.directional === false) return this;

    let anim = new Tactics.Animation({ speed });

    anim.splice(this.animTurn(action.direction));

    return anim.play();
  }
  brightness(intensity, whiteness) {
    let name = 'brightness';
    let filter;
    let matrix;

    if (intensity === 1 && !whiteness) {
      this._setFilter(name, undefined);
    }
    else {
      filter = this._setFilter(name, 'ColorMatrixFilter');
      filter.brightness(intensity);

      if (whiteness) {
        matrix = filter.matrix;
        matrix[1 ] = matrix[2 ] =
        matrix[5 ] = matrix[7 ] =
        matrix[10] = matrix[11] = whiteness;
      }
    }

    return this;
  }
  whiten(intensity) {
    const name = 'whiten';

    if (!intensity) {
      this._setFilter(name, undefined);
    } else {
      const matrix = this._setFilter(name, 'ColorMatrixFilter').matrix;
      matrix[3] = matrix[8] = matrix[13] = intensity;
    }

    return this;
  }
  tint(color) {
    const name = 'tint';

    if (typeof color === 'number')
      color = [
        (color & 0xFF0000) / 0xFF0000,
        (color & 0x00FF00) / 0x00FF00,
        (color & 0x0000FF) / 0x0000FF,
      ];

    if (color === null || color.join() === '1,1,1') {
      this._setFilter(name, undefined);
    } else {
      const matrix = this._setFilter(name, 'ColorMatrixFilter').matrix;
      matrix[0]  = color[0];
      matrix[6]  = color[1];
      matrix[12] = color[2];
    }

    return this;
  }
  /*
   * Add color to the unit.
   * Example, increase the redness by 128 (0x880000).
   *   this.colorize(0xFF0000, 0.5);
   */
  colorize(color, lightness) {
    const name = 'colorize';

    if (typeof color === 'number')
      color = [
        (color & 0xFF0000) / 0xFF0000,
        (color & 0x00FF00) / 0x00FF00,
        (color & 0x0000FF) / 0x0000FF,
      ];

    if (typeof lightness === 'number')
      color = color.map(c => Math.min(c * lightness, 1));

    if (color === null || lightness === 0) {
      this._setFilter(name, undefined);
    } else {
      const matrix = this._setFilter(name, 'ColorMatrixFilter').matrix;
      matrix[4]  = color[0];
      matrix[9]  = color[1];
      matrix[14] = color[2];
    }

    return this;
  }
  focus(view_only) {
    if (this.focused) return;
    this.focused = true;

    let pulse = this._pulse;
    return this.assignment.painted === 'focus' && !pulse && !view_only ? this._startPulse(6) : this;
  }
  blur() {
    if (!this.focused) return this;
    this.focused = false;

    let pulse = this._pulse;
    return pulse && !this.activated ? this._stopPulse() : this;
  }
  /*
   * A unit is activated when it is selected either directly or indirectly.
   *
   * The activation may optionally activate a specific 'mode'.
   * Modes include 'move', 'attack', 'turn', and 'direction':
   * * 'move' mode shows all possible move targets as blue tiles.
   * * 'attack' mode shows all possible attack targets as orange tiles.
   * * 'turn' mode shows all 4 arrows for assigning a direction.
   * * 'direction' mode shows 1 arrow to show current unit direction.
   *
   * The bot activates units without a mode so that it pulses, but does not
   * show movement or attack tiles.
   *
   * A unit may be activated in 'view'-only mode.  This typically occurs
   * when selecting an enemy unit to view its movement or attack range.
   */
  activate(mode, view_only) {
    mode = mode || this.activated || true;
    if (this.activated === mode) return;

    this.activated = mode;

    return view_only ? this : this._startPulse(4, 2);
  }
  deactivate() {
    if (!this.activated) return this;
    this.activated = false;

    return this._stopPulse();
  }
  change(changes) {
    const dirty = Object.keys(changes).some(k => changes[k] !== this[k]);
    if (dirty) {
      Object.assign(this, changes);

      this._emit({ type:'change', changes });
    }

    return this;
  }
  hasFocus() {
    return !!this.getContainerByName('Focus');
  }
  showFocus(alpha = 1, color = this.color) {
    let focusContainer = this.getContainerByName('Focus');
    if (!focusContainer) {
      const core = Tactics.getSprite('core');
      focusContainer = core.renderFrame({ spriteName:'Focus' }).container;

      const shadowContainer = this.getContainerByName(this.shadowSprite);
      shadowContainer.addChild(focusContainer);
    }

    focusContainer.children[0].tint = numifyColor(color);
    focusContainer.alpha = alpha;

    return this;
  }
  hideFocus() {
    let focus = this.getContainerByName('Focus');
    if (focus)
      focus.parent.removeChild(focus);

    return focus;
  }
  hasBarrier() {
    return !!this.getContainerByName('Barrier', this.pixi);
  }
  showBarrier() {
    if (!this.hasBarrier()) {
      let barrier = Tactics.getSprite('Barrier');
      let container = new PIXI.Container();
      container.label = 'Barrier';
      this.pixi.addChild(container)

      container.addChild(barrier.renderFrame({
        actionName: 'show',
        styles: {
          Barrier: { rgb:numifyColor(this.color) },
        },
      }).container);
    }

    return this;
  }
  hideBarrier() {
    let container = this.getContainerByName('Barrier', this.pixi);
    if (container)
      this.pixi.removeChild(container);

    return this;
  }
  activateBarrier() {
    if (!this.hasBarrier())
      throw new Error('No barrier');

    if (this._animActivateBarrier)
      return;

    this._animActivateBarrier = this.animActivateBarrier();
    this._animActivateBarrier.play();
  }
  deactivateBarrier() {
    if (!this.hasBarrier())
      throw new Error('No barrier');

    if (!this._animActivateBarrier)
      return;

    this._animActivateBarrier.stop();
    this._animActivateBarrier = null;
  }
  animFocus() {
    const anim = new Tactics.Animation();
    const alphas = [0.25, 0.50, 0.75, 1];
    let focus = this.getContainerByName('Focus');

    if (!focus)
      anim.addFrame(() => {
        this.showFocus(0);
        focus = this.getContainerByName('Focus');
      });

    anim.splice(0, {
      script: frame => focus.alpha = alphas[frame.repeat_index],
      repeat: alphas.length,
    });

    return anim;
  }
  animDefocus() {
    let anim = new Tactics.Animation();
    let alphas = [0.75, 0.50, 0.25];
    let focus = this.getContainerByName('Focus');

    anim.addFrame({
      script: frame => focus.alpha = alphas[frame.repeat_index],
      repeat: alphas.length,
    });
    anim.addFrame(() => this.hideFocus());

    return anim;
  }
  animShowBarrier() {
    let anim = new Tactics.Animation();
    let barrier = Tactics.getSprite('Barrier');
    let container = this.getContainerByName('Barrier', this.pixi);
    if (!container) {
      container = new PIXI.Container();
      container.label = 'Barrier';
      anim.addFrame(() => this.pixi.addChild(container));
    }

    anim.splice(0, barrier.renderAnimation({
      actionName: 'invoke',
      container,
      styles: {
        Barrier: { rgb:this.color },
      },
    }));

    return anim;
  }
  animActivateBarrier() {
    let anim = new Tactics.Animation({ loop:true, fps:8 });
    let barrier = Tactics.getSprite('Barrier');
    let container = this.getContainerByName('Barrier', this.pixi);
    let child = container.children[0];

    anim.splice(barrier.renderAnimation({
      actionName: 'active',
      container,
      styles: {
        Barrier: { rgb:this.color },
      },
    }));

    anim.on('stop', () => {
      container.removeChildren();
      container.addChild(child);
    });

    return anim;
  }
  animBarrierDeflect(attacker, attackType) {
    let anim = new Tactics.Animation();
    let barrier = Tactics.getSprite('Barrier');
    let container = this.getContainerByName('Barrier', this.pixi);

    if (attackType === undefined)
      attackType = attacker.aType;

    anim.splice(barrier.renderAnimation({
      actionName: 'deflect',
      container,
      silent: attackType !== 'melee',
      styles: {
        Barrier: { rgb:this.color },
      },
    }));

    return anim;
  }
  animHideBarrier() {
    let anim = new Tactics.Animation();
    let barrier = Tactics.getSprite('Barrier');
    let container = this.getContainerByName('Barrier', this.pixi);

    anim.splice(barrier.renderAnimation({
      actionName: 'revoke',
      container,
      styles: {
        Barrier: { rgb:this.color },
      },
    }));

    anim.addFrame(() => this.pixi.removeChild(container));

    return anim;
  }
  animPulse(steps, speed) {
    let step = steps;
    let stride = 0.1 * (speed || 1);

    return new Tactics.Animation({
      loop:   true,
      frames: [
        {
          script: () => this.brightness(1 + (step-- * stride)),
          repeat: steps,
        },
        {
          script: () => this.brightness(1 + (step++ * stride)),
          repeat: steps,
        }
      ]
    });
  }
  /*
   * Units turn in the direction they are headed before they move there.
   * This method returns an animation that does just that, if needed.
   */
  animTurn(direction, andStand = true) {
    let anim = new Tactics.Animation();

    // Do nothing if already facing the desired direction
    if (!direction || direction === this.direction) return anim;

    // If turning to the opposite direction, first turn right.
    if (direction === this.board.getRotation(this.direction, 180)) {
      let spriteAction = this._sprite.getAction('turn');

      if (spriteAction.sounds)
        anim.addFrame(spriteAction.sounds);
      else
        anim.addFrame([]);
      anim.addFrame(() => this.drawTurn(90));
    }

    // Now stand facing the desired direction.
    if (andStand)
      anim.addFrame(() => this.stand(direction));

    return anim;
  }
  animWalk(assignment) {
    let anim = new Tactics.Animation();
    let board = this.board;
    let path = board.findPath(this, assignment);
    // Keep track of the frame offset for the next move animation
    let nextMoveFrameId = 0;

    // Produce a readable error if a bug prevented path finding.
    if (path.length === 0) {
      let fromTile = this.assignment && this.assignment.id;
      let toTile = assignment && assignment.id;

      throw new Error(`No path: ${fromTile} => ${toTile}`);
    }

    anim.addFrame(() => this.assignment.dismiss());

    // Turn frames are not typically required while walking unless the very
    // next tile is in the opposite direction of where the unit is facing.
    let direction = board.getDirection(this.assignment, path[0]);
    if (direction === board.getRotation(this.direction, 180)) {
      // Skip standing after turning (false)
      let turnAnimation = this.animTurn(direction, false);

      anim.splice(0, turnAnimation);
      nextMoveFrameId += turnAnimation.frames.length;
    }

    path.forEach((toTile, i) => {
      // Determine the direction of the next tile and turn in that direction.
      let fromTile = i === 0 ? this.assignment : path[i-1];
      let direction = board.getDirection(fromTile, toTile);
      let moveAnimation = this.animMove(direction);
      let moveFrameCount = moveAnimation.frames.length;

      // Make any unit before us step out of the way.
      let toUnit = toTile.assigned;
      if (toUnit) {
        let nextTile = path[i+1];
        // The unit needs to back up in a direction that isn't in my way.
        let badDirections = [
          // Don't block my way entering the tile
          direction,
          // Don't block my way leaving the tile
          board.getDirection(nextTile, toTile)
        ];

        // Find the first available direction in preference order.
        let backDirection = [
          toUnit.direction,
          board.getRotation(toUnit.direction,  90),
          board.getRotation(toUnit.direction, -90),
        ].find(direction => !badDirections.includes(direction));

        // Start getting out of my way immediately
        moveAnimation.splice(0, toUnit.animMoveBack(backDirection));

        // After I arrive, wait 3 frames as I move out again.
        moveAnimation.addFrame({
          scripts: [],
          repeat: 3,
        });

        // Now return to your post
        moveAnimation.splice(toUnit.animMoveForward(backDirection));
      }

      anim.splice(nextMoveFrameId, moveAnimation);
      nextMoveFrameId += moveFrameCount;

      // If this is our final destination, stand ready
      if (toTile === assignment)
        anim.splice(nextMoveFrameId, () => {
          board.assign(this, assignment);
          this.stand(direction);
        });
      else
        anim.splice(nextMoveFrameId, () => this.setPositionToTile(toTile));
    });

    return anim;
  }
  /*
   * To ensure the moving unit overlaps naturally between other units, estimate
   * its "visual" position as an offset from its "real" position.  This "visual"
   * position is used instead of the "real" position to determine depth.
   *
   * The first movement frame is slightly away from the origin tile.
   * The last movement frame is centered on the destination tile.
   */
  animMove(direction) {
    let anim = this.renderAnimation('move', direction);
    let board = this.board;
    let pixi = this.pixi;

    anim.frames.forEach((frame, frameId) => {
      let offsetRatio = (frameId + 1) / anim.frames.length;
      let offset = board.getOffset(offsetRatio, direction);

      anim.splice(frameId, () => pixi.data.position = new PIXI.Point(
        pixi.position.x + offset[0],
        pixi.position.y + offset[1],
      ));
    });

    return anim;
  }
  /*
   * Moving back and forward is similar to moving.  But the offset ratio is cut
   * in half to reflect that the destination is half-a-tile away.  Also, it is
   * a negative ratio, since the offset is behind the unit.
   */
  animMoveBack(direction) {
    let anim = this.renderAnimation('moveBack', direction);
    let board = this.board;
    let pixi = this.pixi;

    anim.frames.forEach((frame, frameId) => {
      let offsetRatio = (frameId + 1) / anim.frames.length;
      let offset = board.getOffset(-offsetRatio / 2, direction);

      anim.splice(frameId, () => pixi.data.position = new PIXI.Point(
        pixi.position.x + offset[0],
        pixi.position.y + offset[1],
      ));
    });

    return anim;
  }
  animMoveForward(direction) {
    let anim = this.renderAnimation('moveForward', direction);
    let board = this.board;
    let pixi = this.pixi;

    anim.frames.forEach((frame, frameId) => {
      let offsetRatio = (anim.frames.length - (frameId + 1)) / anim.frames.length;
      let offset = board.getOffset(-offsetRatio / 2, direction);

      anim.splice(frameId, () => pixi.data.position = new PIXI.Point(
        pixi.position.x + offset[0],
        pixi.position.y + offset[1],
      ));
    });

    anim.addFrame(() => this.drawStand());

    return anim;
  }
  animTeleport(action) {
    let anim = new Tactics.Animation();
    let board = this.board;

    if (this.directional !== false)
      anim.splice(this.animTurn(action.direction));

    anim.splice(this.renderAnimation('moveOut', action.direction));
    let index = anim.frames.length;
    anim.splice(index, () => board.assign(this, action.assignment));
    anim.splice(index, this.renderAnimation('moveIn', action.direction));
    anim.addFrame(() => this.stand(action.direction));

    return anim;
  }
  animAttack(action) {
    const anim = this.renderAnimation('attack', action.direction);
    const spriteAction = this._sprite.getAction('attack');
    const effectOffset = spriteAction.events.find(e => e[1] === 'react')[0];

    anim.addFrame(() => this.stand());

    let targets = [];
    if (this.aLOS === true) {
      const targetUnit = this.getLOSTargetUnit(action.target);
      if (targetUnit)
        targets.push(targetUnit.assignment);
    } else
      targets = this.getTargetTiles(action.target);

    targets.forEach(target => {
      const result = action.results.find(r => r.unit === target.assigned);
      const isHit = result && !result.miss;

      if (anim.frames.length < effectOffset)
        anim.addFrame({
          scripts: [],
          repeat: effectOffset - anim.frames.length,
        });

      anim.splice(
        effectOffset,
        this.animAttackEffect(spriteAction.effect, target, isHit),
      );
    });

    return anim;
  }
  animAttackEffect(effect, target, isHit) {
    let anim = new Tactics.Animation();
    let board = this.board;
    let effectSprite = effect.spriteId && Tactics.getSprite(effect.spriteId);
    let offset = [0, 0];

    if (!effect.type)
      effect.type = this.aType;

    // Render stagger animation before the effect so that it may be colored
    let targetUnit = target.assigned;
    if (!isHit && targetUnit && targetUnit.type === 'Shrub' && targetUnit.name !== 'Golden Shrub')
      targetUnit = null;

    if (targetUnit) {
      if (effectSprite) {
        let reactOffset = effectSprite.frames.findIndex(f => f.interrupt) + 1;
        if (anim.frames.length < reactOffset)
          anim.addFrame({
            scripts: [],
            repeat: reactOffset - anim.frames.length,
          });
      } else
        anim.addFrame([]);

      let offsetRatio;
      if (!isHit) {
        anim.splice(targetUnit.animMiss(this, effect.type));
        offsetRatio = 0.50;
      } else if (targetUnit !== this) {
        anim.splice(-1, targetUnit.animHit(this, effect.type, effect.silent));
        offsetRatio = 0.25;
      }

      if (targetUnit.type === 'ChaosSeed')
        offsetRatio = 0.25;
      else if (targetUnit.type === 'Shrub')
        offsetRatio = 0.125;

      if (effect.type === 'melee') {
        if (targetUnit.type === 'Shrub') {
          offset = board.getOffset(
            offsetRatio,
            board.getDirection(
              targetUnit.assignment,
              this.assignment,
              true, // allow directions such as SE and NW
            ),
          );
          // Shrubs are short, so lower the offset further
          offset[1] += 7;
        } else
          offset = board.getOffset(
            offsetRatio,
            board.getDirection(
              targetUnit.assignment,
              this.assignment,
              targetUnit.direction,
            ),
          );
      }
    } else
      anim.addFrame([]);

    // Some effects aren't dispayed if no unit is impacted
    if (effectSprite && (targetUnit || !effect.impactOnly)) {
      let unitsContainer = board.unitsContainer;
      let pos = target.getCenter();
      let container = new PIXI.Container();
      container.position = new PIXI.Point(pos.x, pos.y);

      let effectAnimation = effectSprite.renderAnimation({
        container,
        // Attack effects can apply coloring to an affected unit
        unit: isHit && targetUnit,
        styles: {
          [effectSprite.name]: { position:offset },
        },
      });
      effectAnimation.splice(0, () => unitsContainer.addChild(container));
      effectAnimation.addFrame(() => unitsContainer.removeChild(container));

      anim.splice(1, effectAnimation);
    }

    return anim;
  }
  animMiss(attacker, attackType) {
    let anim;

    if (this.barriered)
      anim = this.animBarrierDeflect(attacker, attackType);
    else if (this.hasAction('block')) {
      let direction;
      if (this.directional !== false)
        direction = this.board.getDirection(
          this.assignment,
          attacker.assignment,
          this.direction,
        );

      anim = this.renderAnimation('block', direction);

      /*
       * Poisoned units can block.  Maintain focus as they do so.
       */
      let focusContainer = this.getContainerByName('Focus');
      if (focusContainer) {
        anim.splice(0, {
          script: () => {
            let shadowContainer = this.getContainerByName(this.shadowSprite);
            shadowContainer.addChild(focusContainer);
          },
          repeat: anim.frames.length,
        });
      }

      anim.addFrame(() => this.stand(direction));
    } else if (attackType === 'melee' && this.disposition === 'unbreakable')
      anim = new Tactics.Animation({ frames:[() => this.sounds.block.howl.play()] });

    return anim;
  }
  /*
   * This method is called when this unit is successfully hit.
   *
   * An impact sound will play for melee attacks.
   * This unit will react if hit by melee/magic attacks and not paralyzed.
   * Melee attacks will push the unit off-center briefly.
   * Nothing happens at all for effect attacks, i.e. heal, poison, barrier, paralyze
   */
  animHit(attacker, attackType, silent = false) {
    let anim = new Tactics.Animation();
    let doStagger;
    let direction;

    if (attackType === undefined)
      attackType = attacker.aType;

    if (attackType === 'melee') {
      // Melee attacks cause a stagger
      doStagger = true;

      // Melee attacks cause the victim to stagger in a particular direction
      direction = this.board.getDirection(attacker.assignment, this.assignment, this.direction);

      /*
       * An impact sound only plays for melee attacks
       */
      let spriteAction = this._sprite.getAction('stagger');

      if (silent)
        anim.addFrame([]);
      else
        anim.addFrame(spriteAction.sounds);
    }
    else if (attackType === 'magic') {
      // Magic attacks cause a stagger
      doStagger = true;

      // No impact sound for magic attacks
      anim.addFrame([]);
    }

    /*
     * Show a stagger animation if appropriate
     */
    if (doStagger) {
      anim.addFrame([]);

      if (this.paralyzed)
        anim.addFrames([
          () => this.offsetFrame(0.12, direction),
          () => this.offsetFrame(-0.16, direction),
        ]);
      else
        anim.addFrames([
          () => this.drawStagger().offsetFrame(0.12, direction),
          () => this.offsetFrame(-0.16, direction),
        ]);

      anim.addFrame(() => this.drawStand());
    }

    return anim;
  }
  animTransform(action) {
    const anim = new Tactics.Animation();
    const unit = Object.assign({
      id: this.id,
      assignment: this.assignment,
      direction: this.direction,
      color: this.color,
    }, action.results[0].changes);

    anim.addFrame(() => this.board.dropUnit(this));
    anim.addFrame(() => this.board.addUnit(unit, this.team));

    return anim;
  }
  animDie() {
    let core = Tactics.getSprite('core');
    let container = new PIXI.Container();
    let anim = core.renderAnimation({
      spriteName: 'Die',
      container,
    });

    anim
      .splice(0, [
        () => {
          // The setup component does not lock a board while animating.
          // So, a player might drag-n-drop a unit while it is dying.
          // Dismissing the unit as a first step solves this problem.
          this.assignment.dismiss();
          this.pixi.addChild(container);
        },
        {
          script: () => this.frame.alpha /= 1.8,
          repeat: 7,
        },
        () => this.board.dropUnit(this),
      ]);

    return anim;
  }
  animCaption(caption, options = {}) {
    if (options.color === undefined)
      options.color = 'white';

    return this._animText(
      caption,
      {
        fontFamily:      'Arial',
        fontSize:        '12px',
        stroke:          { color:0x000000, width:3 },
        letterSpacing:   0,
        fill:            options.color,
      },
      options,
    );
  }
  animChange(changes, { instant, andDie } = {}) {
    instant ??= false;
    andDie ??= true;

    const anim = new Tactics.Animation();
    anim.addFrame(() => {
      if (changes.direction)
        this.stand(changes.direction);

      this.change(changes);

      if (instant) {
        if (this.focusing || this.paralyzed || this.poisoned)
          this.showFocus();
        else
          this.hideFocus();

        if (this.barriered)
          this.showBarrier();
        else
          this.hideBarrier();
      }
    });

    if (!instant) {
      if ('focusing' in changes || 'paralyzed' in changes || 'poisoned' in changes) {
        const hasFocus = this.hasFocus();
        const needsFocus = (
          ('focusing' in changes ? changes.focusing : this.focusing) ||
          ('paralyzed' in changes ? changes.paralyzed : this.paralyzed) ||
          ('poisoned' in changes ? changes.poisoned : this.poisoned)
        );
        if (!hasFocus && needsFocus)
          anim.splice(0, this.animFocus());
        else if (hasFocus && !needsFocus)
          anim.splice(0, this.animDefocus());
      }

      /*
       * Check for barrier changes to ensure that a BW barriering itself doesn't
       * get double barriered.
       */
      if ('barriered' in changes) {
        const hasBarrier = this.hasBarrier();
        const needsBarrier = changes.barriered;
        if (!hasBarrier && needsBarrier)
          anim.splice(0, this.animShowBarrier());
        else if (hasBarrier && !needsBarrier)
          anim.splice(0, this.animHideBarrier());
      }
    }

    // Chaos Seed doesn't die.  It hatches.
    if (andDie && changes.disposition === 'dead' && this.type !== 'ChaosSeed')
      if (instant)
        anim.splice(0, () => this.board.dropUnit(this));
      else
        anim.splice(0, this.animDie());

    return anim;
  }
  setTargetNotice(targetUnit, target, stats = null) {
    if (this.canSpecial() && (target ?? targetUnit.assignment) === this.assignment && !stats)
      return this.setSpecialTargetNotice(targetUnit);

    const calc = this.calcAttack(targetUnit, null, target, stats);
    const chance =
      calc.chance === 100 ? 'Hit' :
      calc.chance === 0 ? `${calc.miss.toUpperCase('first')}` :
      `${Math.min(99, Math.max(1, Math.round(calc.chance)))}%`;
    let notice;

    if (calc.effect)
      notice = calc.effect.toUpperCase('first')+'!';
    else if (calc.miss === 'immune')
      notice = 'Immune!';
    else if (!targetUnit.health)
      notice = `Destroy!`;
    else if (calc.damage === 0)
      notice = `No Damage!`;
    else if (calc.damage < 0)
      notice = `+${Math.abs(calc.damage)} • ${chance}`;
    else
      notice = `-${calc.damage} • ${chance}`;

    targetUnit.change({ notice });
  }
  setSpecialTargetNotice(targetUnit) {
    return;
  }
  /*
   * Certain actions can break certain status effects.
   */
  getBreakAction(action) {
    const breakAction = { type:'break', unit:this, results:[] };

    // Any action will break focus.
    if (this.focusing)
      breakAction.results.push(this.getBreakFocusResult());

    // Any action except turning will break barrier.
    if (this.barriered && action.type !== 'turn') {
      const results = [];
      for (const fUnit of this.barriered) {
        // Skip if the unit barriered itself
        if (fUnit === this)
          continue;

        results.push({
          unit: fUnit,
          changes: {
            focusing: fUnit.focusing.length === 1
              ? false
              : fUnit.focusing.filter(u => u !== this),
          },
        });
      }

      // If none, it means we broke our own barrier
      if (results.length) {
        const result = breakAction.results.find(r => r.unit === this);
        const changes = { barriered:false };
        if (result) {
          result.changes.merge(changes);
          if (result.results)
            result.results.push(...results);
          else
            result.results = results;
        } else
          breakAction.results.push({ unit:this, changes, results });
      }
    }

    // Only moving breaks poison
    if (this.poisoned && action.type === 'move') {
      const results = [];
      for (const fUnit of this.poisoned) {
        results.push({
          unit: fUnit,
          changes: {
            focusing: fUnit.focusing.length === 1
              ? false
              : fUnit.focusing.filter(u => u !== this),
          },
        });
      }

      if (results.length) {
        const result = breakAction.results.find(r => r.unit === this);
        const changes = { poisoned:false };
        if (result) {
          result.changes.merge(changes);
          if (result.results)
            result.results.push(...results);
          else
            result.results = results;
        } else
          breakAction.results.push({ unit:this, changes, results });
      }
    }

    if (breakAction.results.length === 0)
      return null;

    return breakAction;
  }
  validateAction(action) {
    let actionType = action.type.charAt(0).toUpperCase() + action.type.slice(1);
    let validate = 'validate'+actionType+'Action';

    if (validate in this)
      return this[validate](action);

    return null;
  }
  validateMoveAction(validate) {
    const action = { type:'move', unit:validate.unit };

    if (validate.direction && this.directional === false)
      return null;

    if (!validate.assignment)
      return null;

    const tiles = this.getMoveTiles();
    if (!tiles.find(tile => tile === validate.assignment))
      return null;

    action.assignment = validate.assignment;

    if (this.directional !== false) {
      const board = this.board;
      let direction;
      if (this.mType === 'path') {
        const path = board.findPath(this, action.assignment);
        path.unshift(this.assignment);

        direction = board.getDirection(path[path.length-2], path[path.length-1]);
      } else
        direction = board.getDirection(this.assignment, action.assignment, this.direction);

      if (validate.direction && validate.direction !== direction)
        return null;
      if (direction !== this.direction)
        action.direction = direction;
    }

    action.results = this.getMoveResults(action);

    return action;
  }
  validateAttackAction(validate) {
    const action = { type:'attack', unit:validate.unit };

    if (validate.direction && this.directional === false)
      return null;

    if (this.aAll) {
      // Tile data is forbidden when attacking all tiles.
      if (validate.target)
        return null;

      // Not opinionated on presence or absense of 'direction'
      if (validate.direction)
        action.direction = validate.direction;
    } else {
      // Tile data is required when not attacking all tiles.
      if (!validate.target)
        return null;

      const tiles = this.getAttackTiles();
      if (!tiles.find(tile => tile === validate.target))
        return null;

      if (validate.direction) {
        const direction = this.board.getDirection(this.assignment, validate.target);
        if (direction.indexOf(validate.direction) === -1)
          return null;

        if (validate.direction !== this.direction)
          action.direction = validate.direction;
      } else if (this.directional !== false) {
        const direction = this.board.getDirection(this.assignment, validate.target, this.direction);
        if (direction !== this.direction)
          action.direction = direction;
      }

      action.target = validate.target;
    }

    action.results = this.getAttackResults(action);

    return action;
  }
  validateAttackSpecialAction(validate) {
    const action = { type:'attackSpecial', unit:validate.unit };

    if (!this.canSpecial())
      return null;

    action.results = this.getAttackSpecialResults(action);

    return action;
  }
  validateTurnAction(validate) {
    let action = { type:'turn', unit:validate.unit };

    if (this.directional === false)
      return null;

    if (!validate.direction)
      return null;

    action.direction = validate.direction;

    return action;
  }
  canMove() {
    return !!this.getMoveTiles().length;
  }
  canSpecial() {
    return false;
  }
  canCounter() {
    return false;
  }
  canTurn() {
    return this.directional !== false;
  }
  isPassable() {
    return (
      !this.focusing &&
      !this.paralyzed &&
      !this.barriered &&
      !this.poisoned &&
      this.mPass !== false
    );
  }
  canBlock() {
    return !this.focusing && !this.paralyzed;
  }

  clone() {
    return this.board.makeUnit(this.toJSON());
  }

  toJSON() {
    const state = {
      type: this.type,
      assignment: this.assignment && this.assignment.toJSON(),
    };

    if (this.id)
      state.id = this.id;

    if (this.name !== this.data.name)
      state.name = this.name;

    if (this.directional !== false)
      state.direction = this.direction;

    if (this.team?.colorId && this.color) {
      const teamColor = colorFilterMap.get(this.team.colorId).join();
      const myColor = this.color.join();
      if (myColor !== teamColor)
        state.color = this.color;
    }

    const properties = [
      'disposition',
      'mHealth',
      'mLifespan',
      'mBlocking',
      'mPower',
      'mArmor',
      'mRecovery',
      'focusing',
      'paralyzed',
      'barriered',
      'poisoned',
      'armored',
    ];

    properties.forEach(prop => {
      if (this[prop])
        if (
          prop === 'focusing' ||
          prop === 'paralyzed' ||
          prop === 'barriered' ||
          prop === 'poisoned' ||
          prop === 'armored'
        )
          state[prop] = this[prop].map(u => u.id);
        else
          state[prop] = this[prop];
    });

    return state;
  }

  /*
   * Applies and returns a new filter to the base and trim sprites.
   * If the filter name already exists, it just returns it.
   */
  _setFilter(name, type) {
    const filters = this.filters;

    if (type) {
      if (!(name in filters)) {
        if (type === 'ColorMatrixFilter')
          filters[name] = new PIXI.filters.ColorMatrixFilter();
        else if (type === 'BlurFilter')
          filters[name] = new PIXI.filters.BlurFilter();
        else
          throw new Error(`Unsupported filter: ${name}`);

        const unitContainer = this.getContainerByName(this.unitSprite);
        unitContainer.filters = Object.values(filters);
      }
    } else {
      if (name in filters) {
        delete filters[name];

        const unitContainer = this.getContainerByName(this.unitSprite);
        if (unitContainer.filters.length > 1)
          unitContainer.filters = Object.values(filters);
        else
          unitContainer.filters = null;
      }
    }

    return filters[name];
  }

  async _startPulse(steps, speed) {
    if (this._pulse) await this._stopPulse();

    const anim = this.animPulse(steps, speed);
    const pulse = this._pulse = anim.play().then(() => this.brightness(1));
    pulse.stop = anim.stop;

    return this;
  }

  async _stopPulse() {
    const pulse = this._pulse;
    if (!pulse) return this;

    pulse.stop();
    await pulse;
    this._pulse = null;

    return this;
  }

  _animText(text, style, options) {
    let anim = new Tactics.Animation();
    let pixi = this.pixi;
    let container = new PIXI.Container();
    let w = 0;

    options = options || {};

    text.split('').forEach((v, i) => {
      let letter = new PIXI.Text({ text:v, style });
      letter.position.x = w;
      w += letter.width;

      anim.splice(i, () => container.addChild(letter));
      anim.splice(i, this._animLetter(letter));
    });

    container.position = new PIXI.Point(-((w / 2) | 0),-71);
    container.position.x += options.x || 0;
    container.position.y += options.y || 0;

    anim
      .splice(0, () => pixi.addChild(container))
      // Add a 4-frame pause before removing text
      .splice({
        script: () => {},
        repeat: 4,
      })
      .splice(() => pixi.removeChild(container));

    return anim;
  }

  _animLetter(letter) {
    return new Tactics.Animation({frames: [
      () => letter.position.y -= 7,
      () => letter.position.y -= 2,
      () => letter.position.y += 1,
      () => letter.position.y += 2,
    ]});
  }
};

emitter(Unit);
