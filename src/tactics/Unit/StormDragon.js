import { TILE_WIDTH, TILE_HEIGHT } from '#tactics/Board.js';
import Unit from '#tactics/Unit.js';

const OVERALL_SCALE = 0.65;

/*
 * Fog appearance — tweak freely.
 *
 * Three PIXI.Graphics cloud shapes are built once in draw() (after this.pixi
 * exists) and repositioned/re-alphaed every frame.  Two sit behind the dragon,
 * one in front at lower opacity so the dragon remains readable.
 *
 * The cloud shape is a horizontally-stretched bumpy ellipse built from
 * concentric filled polygons at decreasing alpha (opaque core → transparent
 * fringe) plus per-layer sine-wave noise on the outline.  A BlurFilter
 * softens the edges.
 */

// Cloud body colour — cool mid-gray, slightly blue (darker than the whitened dragon)
const FOG_COLOR   = 0x949EAA;
const FOG_ALPHA_BACK  = 0.90;   // back layer master opacity
const FOG_ALPHA_WISP  = 0.65;   // upper back wisp
const FOG_ALPHA_FRONT = 0.38;   // front layer (partially obscures dragon)

// Fog drift: how many local-px the clouds rise while fading out
const FOG_DRIFT_PX = 8;

export default class StormDragon extends Unit {
  attach() {
    this._adjustBonusListener = this._adjustBonus.bind(this);
    this.board
      .on('addUnit', this._adjustBonusListener)
      .on('dropUnit', this._adjustBonusListener)
      .on('moveUnit', this._adjustBonusListener);
    // Clouds are built in draw() once this.pixi exists, not here.
  }
  detach() {
    this.board
      .off('addUnit', this._adjustBonusListener)
      .off('dropUnit', this._adjustBonusListener)
      .off('moveUnit', this._adjustBonusListener);
    this._destroyClouds();
  }

  _adjustBonus({ type, unit, source = unit.assignment, target = unit.assignment, addResults }) {
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
    const isInRange = type !== 'dropUnit' && Unit.prototype.getAttackTiles
      .call(LW, unit === LW ? target : undefined)
      .some(t => t === (unit === this ? target : this.assignment));
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

  _applyScale(container) {
    container.scale.set(OVERALL_SCALE);
  }

  /*
   * Build one cloud: a horizontally-stretched bumpy ellipse rendered as
   * layered filled polygons at decreasing opacity, then blurred.
   */
  _makeCloud(w, h, seed) {
    // Seeded xorshift32
    let s = seed | 0;
    const rand = () => {
      s ^= s << 13; s ^= s >> 17; s ^= s << 5;
      return (s >>> 0) / 0xFFFFFFFF;
    };

    const nFreqs = 14;
    const freqData = [];
    for (let i = 1; i <= nFreqs; i++) {
      freqData.push({
        freq:  i,
        amp:   i <= 6
          ? (0.04 + rand() * 0.10) / Math.sqrt(i)
          : (0.01 + rand() * 0.03),
        phase: rand() * Math.PI * 2,
      });
    }

    const rx = w * 0.44;
    const ry = h * 0.40;

    // Radial layers: opaque core → transparent fringe
    const layers = [
      { scale: 0.45, alpha: 0.90 },
      { scale: 0.65, alpha: 0.72 },
      { scale: 0.82, alpha: 0.46 },
      { scale: 0.95, alpha: 0.20 },
      { scale: 1.06, alpha: 0.06 },
    ];

    const g = new PIXI.Graphics();
    const nPts = 64;

    for (const { scale: sc, alpha: la } of layers) {
      const pts = [];
      for (let i = 0; i < nPts; i++) {
        const angle = (i / nPts) * Math.PI * 2;
        let noise = 0;
        for (const { freq, amp, phase } of freqData)
          noise += amp * Math.sin(freq * angle + phase);
        const r = 1.0 + noise;
        pts.push(rx * sc * r * Math.cos(angle), ry * sc * r * Math.sin(angle));
      }
      g.poly(pts).fill({ color: FOG_COLOR, alpha: la });
    }
    g.filters = [ new PIXI.filters.BlurFilter({ strength:2.5 }) ];
    return g;
  }

  _destroyClouds() {
    this._fogBack?.destroy({ children: true });
    this._fogFront?.destroy({ children: true });
    this._fogBack  = null;
    this._fogFront = null;
    this._cloud1 = this._cloud2 = this._cloud3 = null;
  }

  // ── Fog state update (called every fixupFrame and directly from animation callbacks) ──
  /*
   * alpha: 0 = invisible, 1 = fully visible
   * drift: local-px offset applied upward (negative y) as the fog rises on takeoff
   *
   * Ground level in the dragon's local coordinate space is y = 0.
   * The dragon body hangs above this with negative ty values baked into the
   * sprite frames.  We anchor the fog at y ≈ -10 (just above the tile centre,
   * near the dragon's feet).
   *
   * This method is called both from fixupFrame (for stand/attack/block frames
   * that render via AnimatedSprite with our fixup hook) and directly from
   * animation frame callbacks (for moveOut/moveIn frames rendered by
   * super.animTeleport without our fixup hook).
   */
  _updateFogState(alpha, drift = 0) {
    if (!this._fogBack) return;

    const groundY = -10;
    const visible = alpha > 0.001;

    // Back layer
    this._fogBack.visible = visible;
    if (visible) {
      this._cloud1.position.set(0,   groundY + drift);
      this._cloud1.alpha = FOG_ALPHA_BACK * alpha;

      this._cloud2.position.set(-8, groundY - 14 + drift);
      this._cloud2.alpha = FOG_ALPHA_WISP * alpha;
    }

    // Front layer
    this._fogFront.visible = visible;
    if (visible) {
      this._cloud3.position.set(6, groundY + 3 + drift);
      this._cloud3.alpha = FOG_ALPHA_FRONT * alpha;
    }
  }

  drawPIXI(frame) {
    const pixi = super.drawPIXI(frame);

    if (!this._cloud1) {
      this._cloud1 = this._makeCloud(90, 28, /*seed*/3);
      this._cloud2 = this._makeCloud(74, 20, /*seed*/11);
      this._cloud3 = this._makeCloud(68, 18, /*seed*/23);

      this._fogBack = new PIXI.Container();
      this._fogBack.label = 'fogBack';
      this._fogBack.addChild(this._cloud1);
      this._fogBack.addChild(this._cloud2);

      this._fogFront = new PIXI.Container();
      this._fogFront.label = 'fogFront';
      this._fogFront.addChild(this._cloud3);
      this._updateFogState(1, 0);
    }

    pixi.addChildAt(this._fogBack, 0);   // behind frame
    pixi.addChildAt(this._fogFront, 2);  // in front of frame

    return pixi;
  }

  fixupFrame(frame, direction = this.direction) {
    const unitContainer = this.getContainerByName(this.unitSprite, frame.container);

    // 1. Uniform scale
    this._applyScale(frame.container);

    // 2. Whiten unit body
    if (unitContainer && unitContainer.children.length > 1) {
      const f = new PIXI.filters.ColorMatrixFilter();
      f.matrix[0] = 2; f.matrix[6] = 2; f.matrix[12] = 2;
      unitContainer.children[0].filters = [ f ];
    }

    // 3. Fog — full opacity for all frames rendered through fixupFrame (stand,
    //    attack, block).  Movement frames bypass fixupFrame entirely and call
    //    _updateFogState directly from their animation callbacks instead.
    this._updateFogState(1, 0);

    return super.fixupFrame(frame, direction);
  }

  // ── Fog animation helpers ─────────────────────────────────────────────────
  /*
   * Returns an array of `count` per-frame callbacks that interpolate alpha
   * from `fromAlpha` to `toAlpha` inclusive, with drift proportional to how
   * far from fully-visible the fog is (fog rises as it fades out, settles as
   * it fades in).
   *
   * Callbacks call _updateFogState directly so they work inside animTeleport
   * frames, which are built by the base class without our fixup hook and
   * therefore never invoke fixupFrame.
   */
  _fogFadeCallbacks(fromAlpha, toAlpha, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const t     = count > 1 ? i / (count - 1) : 1;
      const alpha = fromAlpha + (toAlpha - fromAlpha) * t;
      const drift = -Math.round((1 - alpha) * FOG_DRIFT_PX);
      out.push(() => this._updateFogState(alpha, drift));
    }
    return out;
  }

  // ── Movement ──────────────────────────────────────────────────────────────
  /*
   * The Storm Dragon uses mType='teleport', so Unit.move() calls animTeleport.
   * We override animTeleport to splice fog fade callbacks onto the moveOut and
   * moveIn frames produced by the base class.
   *
   * animTeleport (base) builds 23 frames (assuming no turn is needed):
   *   0-9:   moveOut  (10 frames)
   *   10-21: moveIn   (12 frames)
   *   22:    stand()  (1 frame appended)
   *
   * All callbacks call _updateFogState directly — they must, because the
   * moveOut/moveIn frames were rendered without our fixup hook.
   */
  animTeleport(action) {
    const inner = super.animTeleport(action);
    const n = inner.frames.length;   // 23 with no turn, 24 with turn, so use negative offsets.

    const FADE_OUT_COUNT  = 5;
    const FADE_OUT_OFFSET = -18;
    const FADE_IN_COUNT   = 5;
    const FADE_IN_OFFSET  = -11;

    // Fade out old assignment
    this._fogFadeCallbacks(1, 0, FADE_OUT_COUNT)
      .forEach((fn, i) => inner.splice(FADE_OUT_OFFSET + i, fn));

    // Fade in new assignment
    this._fogFadeCallbacks(0, 1, FADE_IN_COUNT)
      .forEach((fn, i) => inner.splice(FADE_IN_OFFSET + i, fn));

    return inner;
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
    if (effect.spriteId !== 'sprite:FireBlast')
      return super.animAttackEffect(effect, target, miss);

    let board     = this.board;
    let anim      = new Tactics.Animation();
    let tunit     = target.assigned;
    let whiten    = [0.25, 0.5, 0];
    let unitsContainer = board.unitsContainer;
    let container = new PIXI.Container();
    let filter1   = new PIXI.filters.BlurFilter({ strength:6 });
    let filter2   = new PIXI.filters.BlurFilter({ strength:2 });
    let streaks1  = new PIXI.Graphics;
    let streaks2  = new PIXI.Graphics;
    let streaks3  = new PIXI.Graphics;

    // Make sure streaks overlap naturally
    // If the dragon is facing N or E, then streaks appear behind dragon.
    // Otherwise, streaks appear before dragon.
    container.data = { position:{ y:this.pixi.position.y } };
    container.data.position.y += ['N','E'].includes(this.direction) ? -1 : 1;

    streaks1.filters = [filter1];
    container.addChild(streaks1);

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
  animDie() {
    const anim = super.animDie();

    anim
      .splice(1, {
        script: () => this._updateFogState(this.frame.alpha),
        repeat: 7,
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
  canMove() {
    if (this.disposition === 'grounded')
      return false;
    return super.canMove();
  }
  canContinue() {
    if (this.disposition === 'grounded')
      return true;
    return super.canContinue();
  }
  canBlock() {
    return !this.paralyzed;
  }
  canBlockAllSides() {
    return this.disposition === 'grounded';
  }
  getBreakAction(action) {
    if (this.disposition === 'grounded' && action.type === 'turn')
      return null;
    return super.getBreakAction(action);
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

    result.changes ??= {};
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
        mRecovery: 1,
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