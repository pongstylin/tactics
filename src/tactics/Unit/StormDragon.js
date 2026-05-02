import Unit from '#tactics/Unit.js';

const DIAGONAL_SCALE_X = 0.72;
const VERTICAL_SCALE_Y = 0.78;

export default class StormDragon extends Unit {
  attach() {
    this._adjustBonusListener = this._adjustBonus.bind(this);
    this.board
      .on('addUnit', this._adjustBonusListener)
      .on('dropUnit', this._adjustBonusListener);
  }
  detach() {
    this.board
      .off('addUnit', this._adjustBonusListener)
      .off('dropUnit', this._adjustBonusListener);
  }

  _adjustBonus({ type, unit, addResults }, assignment = this.assignment) {
    if (unit !== this && unit.type !== 'LightningWard' || unit.team !== this.team)
      return;

    const SDs = this.team.units.filter(u => u.type === 'StormDragon');
    if (SDs.length !== 1)
      return;

    const LW = (() => {
      const LWs = this.team.units.filter(u => u.type === 'LightningWard');
      if (LWs.length === 1)
        return LWs[0];
    })();
    if (!LW)
      return;

    // Don't allow a channeling disposition to prevent us from getting the LW's attack tiles.
    const isInRange = type !== 'dropUnit' && Unit.prototype.getAttackTiles.call(LW).some(t => t === assignment);
    const wasInRange = this.mPower === 6;
    if (isInRange === wasInRange)
      return;

    const results = [];
    if (isInRange) {
      results.push(
        {
          unit: this,
          changes: {
            mPower: Math.max(0, LW.power - this.power),
          },
        },
        {
          unit: LW,
          changes: {
            disposition: 'channeling',
          },
        },
      );
    } else {
      results.push(
        {
          unit: this,
          changes: {
            mPower: 0,
          },
        },
        {
          unit: LW,
          changes: {
            disposition: null,
          },
        },
      );
    }

    addResults(results);
  }
  getMoveResults(action) {
    const results = [];
    this._adjustBonus({ type:'moveUnit', unit:this, addResults:rs => results.push(...rs) }, action.assignment);
    return results;
  }

  /*
   * Dragon Tyrant fire effects should be hidden
   */
  getStyles() {
    return Object.assign(super.getStyles(), {
      fire: { alpha:0 },
    });
  }
  getStandRenderOptions() {
    if (this.disposition !== 'grounded')
      return super.getStandRenderOptions();

    return [ 'block', 2 ];
  }
  applyDiagonalScale(container, direction = this.direction) {
    const scaleX = DIAGONAL_SCALE_X;
    const scaleY = VERTICAL_SCALE_Y;
    const halfCompression = (1 - scaleX) / 2;
    const diagonalSign = [ 'N', 'S' ].includes(direction) ? 1 : -1;
    const diagonalScale = 1 - halfCompression;
    const x = container.position.x;
    const y = container.position.y;

    container.setFromMatrix(new PIXI.Matrix(
      diagonalScale,
      diagonalSign * halfCompression,
      diagonalSign * halfCompression * scaleY,
      diagonalScale * scaleY,
      x,
      y,
    ));
  }
  fixupFrame(frame, direction = this.direction) {
    const unit = this.getContainerByName(this.unitSprite, frame.container);
    if (!unit || unit.children.length === 1) return;

    let filter = new PIXI.filters.ColorMatrixFilter();
    filter.matrix[0] = 2;    // R multiply
    filter.matrix[6] = 2;    // G multiply
    filter.matrix[12] = 2;   // B multiply

    // Apply whitening to base sprite
    unit.children[0].filters = [ filter ];
    // Narrow the dragon along the board diagonal that matches its facing.
    this.applyDiagonalScale(frame.container, direction);

    return super.fixupFrame(frame, direction);
  }
  animAttack(action) {
    let anim = this._sprite.renderAnimation({
      actionName: 'attack',
      direction: action.direction || this.direction,
      container: this.frame,
      silent: true,
      styles: Object.assign(super.getStyles(), {
        fire: { effects:[{ method:'grayscale', args:[0.75] }] },
      }),
      fixup: frame => this.fixupFrame(frame, action.direction || this.direction),
    });
    let spriteAction = this._sprite.getAction('attack');
    let effectOffset = spriteAction.events.find(e => e[1] === 'react')[0];
    let charge = this.sounds.charge.howl;

    anim
      .splice(0, () => charge.fade(0, 1, 500, charge.play()))
      .splice(3, () => {
        this.sounds.buzz.howl.play();
        charge.stop();
        this.sounds.attack.howl.play();
      })
      .addFrame(() => {
        this.sounds.buzz.howl.stop();
        this.stand();
      });

    let targets = [];
    if (this.aLOS === true) {
      let targetUnit = this.getLOSTargetUnit(action.target);
      if (targetUnit)
        targets.push(targetUnit.assignment);
    } else
      targets = this.getAttackTargetTiles(action.target);

    targets.forEach(target => {
      let result = action.results.find(r => r.unit === target.assigned);

      if (anim.frames.length < effectOffset)
        anim.addFrame({
          scripts: [],
          repeat: effectOffset - anim.frames.length,
        });

      anim.splice(
        effectOffset,
        this.animAttackEffect(spriteAction.effect, target, result?.miss),
      );
    });

    return anim;
  }
  animAttackEffect(effect, target, miss) {
    let board     = this.board;
    let anim      = new Tactics.Animation();
    let tunit     = target.assigned;
    let direction = board.getDirection(this.assignment, target, 1);
    let whiten    = [0.25, 0.5, 0];
    let unitsContainer = board.unitsContainer;
    let container = new PIXI.Container();
    let filter1   = new PIXI.filters.BlurFilter();
    let filter2   = new PIXI.filters.BlurFilter();
    let streaks1  = new PIXI.Graphics;
    let streaks2  = new PIXI.Graphics;
    let streaks3  = new PIXI.Graphics;

    // Make sure streaks overlap naturally
    // If the dragon is facing N or E, then streaks appear behind dragon.
    // Otherwise, streaks appear before dragon.
    container.data = { position:{ y:this.pixi.position.y } };
    container.data.position.y += ['N','E'].includes(this.direction) ? -1 : 1;

    //filter1.blur = 6;
    streaks1.filters = [filter1];
    container.addChild(streaks1);

    filter2.strength = 4;
    streaks2.filters = [filter2];
    container.addChild(streaks2);

    streaks3.filters = [filter2];
    container.addChild(streaks3);

    let glowFrame2;
    let start;
    let end = target.getTop().clone();
    let offset = { x:0, y:0 };
    let parent = unitsContainer;
    while (parent) {
      offset.x += parent.x;
      offset.y += parent.y;
      parent = parent.parent;
    }

    anim
      .addFrame({
        script: ({ repeat_index }) => {
          let glow = this.getContainerByName('fire');
          if (!glow) return;
          if (repeat_index === 2)
            glowFrame2 = glow;
          if (repeat_index === 4) {
            let parent = glow.parent;
            let index = parent.getChildIndex(glow);
            parent.removeChild(glow);
            parent.addChildAt(glow = glowFrame2, index);
          }

          let bounds = glow.getBounds();
          start = new PIXI.Point(bounds.x - offset.x, bounds.y - offset.y);
          start.x += Math.floor(glow.width  / 2);
          start.y += Math.floor(glow.height / 2);
        },
        repeat: 5,
      })
      .splice(2, tunit.animHit(this))
      .splice(3, {
        script: () => tunit.whiten(whiten.shift()),
        repeat: 3,
      })
      .splice(3, () => {
        this.drawStreaks(container, target, start, end);
        unitsContainer.addChild(container);
      })
      .splice(4, () => {
        this.drawStreaks(container, target, start, end);
      })
      .splice(5, () => {
        unitsContainer.removeChild(container);
      });

    return anim;
  }
  drawStreaks(container, target, start, end) {
    // Determine the stops the lightning will make.
    let stops = [
      {
        x: start.x + Math.floor((end.x - start.x) * 1/3),
        y: start.y + Math.floor((end.y - start.y) * 1/3),
      },
      {
        x: start.x + Math.floor((end.x - start.x) * 2/3),
        y: start.y + Math.floor((end.y - start.y) * 2/3),
      },
      {x:end.x, y:end.y},
    ];

    let streaks1 = container.children[0];
    let streaks2 = container.children[1];
    let streaks3 = container.children[2];

    streaks1.clear();
    streaks2.clear();
    streaks3.clear();

    for (let i=0; i<3; i++) {
      let alpha     = i % 2 === 0 ? 0.6 : 1;
      let deviation = alpha === 1 ? 9 : 19;
      let midpoint  = (deviation + 1) / 2;

      streaks1.moveTo(start.x, start.y);
      streaks2.moveTo(start.x, start.y);
      streaks3.moveTo(start.x, start.y);

      stops.forEach((stop, j) => {
        let offset;
        let x = stop.x;
        let y = stop.y;

        if (j < 2) {
          // Now add a random offset to the stops.
          offset = Math.floor(Math.random() * deviation) + 1;
          if (offset > midpoint) offset = (offset-midpoint) * -1;
          x += offset;

          offset = Math.floor(Math.random() * deviation) + 1;
          if (offset > midpoint) offset = (offset-midpoint) * -1;
          y += offset;
        }

        streaks1.lineTo(x, y);
        streaks2.lineTo(x, y);
        streaks3.lineTo(x, y);
      });

      streaks1.stroke({ width:1, color:0x8888FF, alpha });
      streaks2.stroke({ width:2, color:0xFFFFFF, alpha });
      streaks3.stroke({ width:2, color:0xFFFFFF, alpha });
    }

    return this;
  }

  isImmune(attacker, stats) {
    if (attacker.type === 'LightningWard' && !this.paralyzed)
      return true;

    return super.isImmune(attacker, stats);
  }
  /*
   * Implement ability to self-heal
   */
  canSpecial() {
    return this.mHealth < 0;
  }
  canContinue() {
    if (this.disposition === 'grounded')
      return false;
    return super.canContinue();
  }
  canBlock() {
    return !this.paralyzed;
  }
  canBlockAllSides() {
    return this.disposition === 'grounded';
  }
  getSpecialTargetNotice(_targetUnit, _target, _source = this.assignment) {
    return 'Recharge!';
  }
  getBreakFocusResult(flatten = false) {
    const result = {
      unit: this,
      changes: {
        focusing: false,
        disposition: null,
        blocking: this.data.blocking,
        mBlocking: 0,
        mRecovery: this.mRecovery + 1,
      },
    };

    return flatten ? [ result ] : result;
  }
  /*
   * Apply stun effect on a unit that is successfully hit.
   */
  getAttackResult(action, unit, cUnit) {
    const result = super.getAttackResult(action, unit, cUnit);
    if (result.miss) return result;

    result.changes.mRecovery = result.unit.mRecovery + 1;
    return result;
  }
  getAttackSpecialResults(action) {
    return [{
      unit: this,
      changes: {
        focusing: [ this ],
        disposition: 'grounded',
        blocking: 100,
        mBlocking: 0,
      },
    }];
  }
  getStartTurnAction() {
    if (this.disposition !== 'grounded' || this.mRecovery !== 0)
      return null;

    return {
      type: 'recharge',
      unit: this,
      results: [{
        unit: this,
        damage: -this.power,
        changes: {
          focusing: false,
          disposition: null,
          blocking: this.data.blocking,
          mHealth: Math.min(0, this.mHealth + this.power),
        },
      }],
    };
  }
  animHit(attacker, attackType, silent = false) {
    const anim = super.animHit(attacker, attackType, silent);
    if (
      this.disposition === 'grounded' &&
      this.canBreakFocus({ miss:undefined, stats:{ aType:attackType } })
    )
      anim.splice(this.animUncover());

    return anim;
  }
  animBlock(attacker) {
    if (this.disposition !== 'grounded')
      return super.animBlock(attacker);

    const anim = this.animUncover();
    anim.splice(0, () => this.sounds.block.howl.play());

    return anim;
  }
  animCover() {
    const anim = new Tactics.Animation();
    const block = this._sprite.renderAnimation({
      actionName: 'block',
      direction: this.direction,
      container: this.frame,
      silent: true,
      styles: super.getStyles(),
      fixup: frame => this.fixupFrame(frame, this.direction),
    });

    anim.splice(0, () => this.sounds.flap.howl.play());
    anim.splice(block.frames.slice(0, 2));
    anim.splice(() => {
      this.change({ disposition:'grounded' })
      this.drawStand();
    });

    return anim;
  }
  animUncover() {
    const anim = new Tactics.Animation();
    const block = this._sprite.renderAnimation({
      actionName: 'block',
      direction: this.direction,
      container: this.frame,
      silent: true,
      styles: super.getStyles(),
      fixup: frame => this.fixupFrame(frame, this.direction),
    });

    anim.splice(0, block.frames.slice(3))
    anim.splice(2, () => this.sounds.flap.howl.play())
    anim.splice(() => {
      this.change({ disposition:null });
      this.drawStand();
    });

    return anim;
  }
  animAttackSpecial(_action) {
    return this.animCover();
  }
  recharge(action, speed) {
    return this.animRecharge(action, speed).play();
  }
  animRecharge(action, speed) {
    const direction = action.direction || this.direction;
    const block = this._sprite.renderAnimation({
      actionName: 'block',
      direction,
      container: this.frame,
      silent: true,
      styles: super.getStyles(),
      fixup: frame => this.fixupFrame(frame, direction),
    });
    const anim = new Tactics.Animation({ speed })
      .splice(0, () => this.change({ disposition:'recharge' }))
      .splice(0, super.animAttackEffect(
        { spriteId:'sprite:Lightning', type:'heal' },
        this.assignment,
        undefined, // miss
      ))
      .splice(4, () => this.sounds.buzz.howl.play())
      .splice(10, () => this.sounds.strike.howl.play())
      .splice(-1, block.frames.slice(3))
      .splice(() => this.stand(direction));

    return anim;
  }
}
