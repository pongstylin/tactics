import Unit from '#tactics/Unit.js';
import { colorFilterMap } from '#tactics/colorMap.js';

export default class ChaosDragon extends Unit {
  constructor(data, board) {
    super(data, board);

    Object.assign(this, {
      title: 'Awakened!',
      banned: [],
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
  fixupFrame(frame) {
    let unit = this.getContainerByName('unit', frame.container);
    // This heuristic skips empty frames (while dragon flies)
    if (unit.children.length === 1) return;
    let trim = this.getContainerByName('trim', frame.container);
    let filter = new PIXI.filters.ColorMatrixFilter();
    filter.matrix[0] = 2;
    filter.matrix[6] = 2;
    filter.matrix[12] = 2;

    unit.children[0].filters = [filter];
    trim.children[0].filters = [filter];
  }
  drawHatch(frameId = 0) {
    let hatchFrame = this.hatch[frameId];

    return this.drawFrame(hatchFrame[0], this.direction, hatchFrame[1]);
  }
  getPhaseAction(attacker, result) {
    const banned = this.banned.slice();
    if (attacker)
      banned.push(attacker.team.id);

    const board = this.board;
    let teamsData = board.getWinningTeams().reverse();
    let colorId = 'White';

    if (teamsData.length > 1) {
      teamsData = teamsData.filter(teamData => !banned.includes(teamData.id));

      if (teamsData.length)
        colorId = board.teams[teamsData[0].id].colorId;
    }

    if (colorFilterMap.get(colorId).join() === this.color.join())
      return;

    const phaseAction = {
      type: 'phase',
      unit: this,
      colorId: colorId,
    };

    if (attacker)
      phaseAction.results = [{
        unit: this,
        changes: { banned },
      }];

    return phaseAction;
  }
  phase(action) {
    return this.animPhase(action.colorId).play();
  }
  animPhase(colorId) {
    const old_color = this.color;
    const new_color = colorFilterMap.get(colorId);
    const trim = this.getContainerByName('trim');
    let tint;

    if (trim.filters)
      tint = trim.filters[0];
    else
      tint = (trim.filters = [new PIXI.filters.ColorMatrixFilter()])[0];

    return new Tactics.Animation({frames: [
      () => this.sounds.phase.howl.play(),
      {
        script: ({ repeat_index }) => {
          repeat_index++;

          const color = Tactics.utils.getColorFilterStop(old_color, new_color, repeat_index / 12);
          tint.matrix[0]  = color[0];
          tint.matrix[6]  = color[1];
          tint.matrix[12] = color[2];

          this.change({ color });
        },
        repeat: 12,
      }
    ]});
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
      fixup: this.fixupFrame.bind(this),
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
    return [source];
  }
  getAttackSpecialResults(action) {
    return [{
      unit: this,
      damage: -this.power,
      changes: {
        mHealth: Math.min(0, this.mHealth + this.power),
      },
    }];
  }
  animAttackSpecial(action) {
    let anim = new Tactics.Animation();
    let block = this._sprite.renderAnimation({
      actionName: 'block',
      direction: action.direction || this.direction,
      container: this.frame,
      silent: true,
      styles: super.getStyles(),
      fixup: this.fixupFrame.bind(this),
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

  /*
   * Implement ability to get angry with attacking allies.
   */
  canCounter() {
    return this.mHealth !== -this.health;
  }
  getCounterAction(attacker, result) {
    if (attacker !== this && attacker.color.join() === this.color.join())
      return this.getPhaseAction(attacker, result);
  }

  toJSON() {
    let data = super.toJSON();

    if (this.banned.length)
      data.banned = this.banned.slice();

    return data;
  }
}
