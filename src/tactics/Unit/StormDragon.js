import Unit from '#tactics/Unit.js';

const DIAGONAL_SCALE_X = 0.82;
const VERTICAL_SCALE_Y = 0.88;

export default class StormDragon extends Unit {
  constructor(data, board) {
    super(data, board);

    Object.assign(this, {
    });
  }

  /*
   * Dragon Tyrant fire effects should be hidden
   */
  getStyles() {
    return Object.assign(super.getStyles(), {
      fire: { alpha:0 },
    });
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
    const shadow = this.getContainerByName(this.shadowSprite, frame.container);
    const unit = this.getContainerByName(this.unitSprite, frame.container);
    if (unit.children.length === 1) return;

    let filter = new PIXI.filters.ColorMatrixFilter();
    filter.matrix[0] = 2;    // R multiply
    filter.matrix[6] = 2;    // G multiply
    filter.matrix[12] = 2;   // B multiply

    // Apply whitening to base sprite
    unit.children[0].filters = [ filter ];
    // Narrow the dragon along the board diagonal that matches its facing.
    this.applyDiagonalScale(shadow, direction);
    this.applyDiagonalScale(unit, direction);
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
    }
    else
      targets = this.getTargetTiles(action.target);

    targets.forEach(target => {
      let result = action.results.find(r => r.unit === target.assigned);
      let isHit = result && !result.miss;

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
      .splice(1, tunit.animHit(this))
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

  /*
   * Implement ability to self-heal
   */
  canSpecial() {
    return this.mHealth < 0;
  }
  getSpecialTargetTiles(target, source = this.assignment) {
    return [ source ];
  }
  animAttackSpecial(action) {
    let anim = new Tactics.Animation();
    let block = this._sprite.renderAnimation({
      actionName: 'block',
      direction: action.direction || this.direction,
      container: this.frame,
      silent: true,
      styles: super.getStyles(),
      fixup: frame => this.fixupFrame(frame, action.direction || this.direction),
    });

    anim
      .splice(block.frames.slice(0, 2))
      .splice(0, () => this.sounds.heal.howl.play())
      .splice(0, super.animAttackEffect(
        { spriteId:'sprite:Sparkle', type:'heal' },
        this.assignment,
        true, // isHit
      ))
      .splice(-1, block.frames.slice(3));

    return anim;
  }
}
