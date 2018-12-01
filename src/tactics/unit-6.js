(function () {
  'use strict';

  Tactics.units[6].extend = function (self) {
    var board = Tactics.board;
    var data = Tactics.units[self.type];
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);

    Object.assign(self, {
      onAttackSelect: function (event) {
        let direction = board.getDirection(self.assignment, event.target);

        board.clearHighlight();

        // This makes it possible to click the attack button to switch from target
        // mode to attack mode.
        self.activated = 'target';
        self._targets = [];

        let context = self.assignment;
        while (self._targets.length < 4) {
          context = context[direction];
          if (!context) break;

          self._targets.push(context);
          self.highlightTarget(context);
        }
      },
      attack: function () {
        let targets   = self._targets;
        let first     = self._targets[0];
        let anim      = new Tactics.Animation();
        let direction = board.getDirection(self.assignment, first, self.direction);
        let darkness  = [-0.3, -0.4, -0.5, -0.3, -0.2, 0];
        let all_target_units = [];

        let attackAnim = self.animAttack(first);
        attackAnim.splice(0, sounds.attack1.play());
        attackAnim.splice(3, sounds.attack2.play());

        targets.forEach(target => {
          attackAnim.splice(4, self.animBlackSpike(target, first));

          let target_unit = target.assigned;
          if (target_unit) {
            all_target_units.push(target_unit);

            attackAnim.splice(6, target_unit.animStagger(self));
            attackAnim.splice(6, {
              script: frame => target_unit.colorize(0xFFFFFF, darkness[frame.repeat_index]),
              repeat: darkness.length,
            });
          }
        });

        anim.splice(self.animTurn(direction));
        anim.splice(attackAnim);

        /*
         * Get the effect of the attack on all units in the target area.
         */
        let results = self.calcAttackResults(all_target_units);

        return anim.play().then(() => results);
      },
      animBlock: function (attacker) {
        let anim = new Tactics.Animation();
        let direction = board.getDirection(self.assignment, attacker.assignment, self.direction);

        anim.addFrame(() => self.origin.direction = self.direction = direction);
        anim.addFrame(() => {
          sounds.block1.play();
          sounds.block2.play();
        });

        let indexes = [];
        for (let index = data.blocks[direction][0]; index <= data.blocks[direction][1]; index++) {
          indexes.push(index);
        }
        indexes.forEach((index, i) => anim.splice(i, () => self.drawFrame(index)));

        anim.addFrame(() => self.drawFrame(data.stills[direction]));

        return anim;
      },
      animBlackSpike: function (target, first) {
        let anim = new Tactics.Animation();
        let parent = Tactics.stage;

        let pos = target.getCenter();
        let container = new PIXI.Container();
        container.position = new PIXI.Point(pos.x, pos.y);

        anim.addFrame(() => parent.addChild(container));

        let frames;
        if (target === first)
          frames = self.effects.black_spike;
        else
          frames = data.effects.black_spike.frames.map(frame => self.compileFrame(frame, data.effects.black_spike));

        let index = 0;
        frames.forEach(frame => {
          anim.splice(index, [
            () => container.addChild(frame),
            () => container.removeChild(frame),
          ]);

          index++;
        });

        anim.splice(anim.frames.length-1, () => parent.removeChild(container));

        return anim;
      },
    });

    return self;
  };

})();
