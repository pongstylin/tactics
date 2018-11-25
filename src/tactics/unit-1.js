(function () {
  'use strict';

  Tactics.units[1].extend = function (self) {
    var board = Tactics.board;
    var data = Tactics.units[self.type];
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);

    Object.assign(self, {
      onAttackSelect: function (event) {
        let target = event.target;

        board.clearHighlight();

        // This makes it possible to click the attack button to switch from target
        // mode to attack mode.
        self.activated = 'target';
        self._targets = [
          target,
          board.getTile(target.x - 1, target.y),
          board.getTile(target.x + 1, target.y),
          board.getTile(target.x, target.y - 1),
          board.getTile(target.x, target.y + 1),
        ].filter(target => !!target);

        self._targets.forEach(target => self.highlightTarget(target));
      },
      attack: function () {
        let targets          = self._targets;
        let center           = targets[0];
        let anim             = new Tactics.Animation();
        let direction        = board.getDirection(self.assignment, center, self.direction);

        /*
         * Animate the attack.  Blast closer tiles before further tiles.
         */
        targets.sort((a, b) => board.getDistance(self.assignment, a) - board.getDistance(self.assignment, b));

        let closest = board.getDistance(self.assignment, targets[0]);
        let attackAnim = self.animAttack(center);

        attackAnim.splice(0, () => sounds.attack.play());

        targets.forEach(target => {
          let index = 3 + (board.getDistance(self.assignment, target) - closest);

          attackAnim.splice(index, self.animFireBlast(target, center));
        });

        anim.splice(self.animTurn(direction));
        anim.splice(attackAnim);

        /*
         * Get the effect of the attack on all units in the blast area.
         */
        let all_target_units = [];
        targets.forEach(target => {
          if (target.assigned)
            all_target_units.push(target.assigned);
        });

        let results = self.calcAttackResults(all_target_units);

        return anim.play().then(() => results);
      },
      animFireBlast: function (target, center) {
        let anim = new Tactics.Animation();
        let parent = Tactics.stage.children[1];
        let lightness = [0.6, 0.8, 0.8, 0.6, 0.4, 0];

        let pos = target.getCenter();
        let container = new PIXI.Container();
        container.position = new PIXI.Point(pos.x, pos.y);

        anim.addFrame(() => parent.addChild(container));

        let frames;
        if (target === center)
          frames = self.effects.fireblast;
        else
          frames = data.effects.fireblast.frames.map(frame => self.compileFrame(frame, data.effects.fireblast));

        let index = 0;
        frames.forEach(frame => {
          anim.splice(index, [
            () => container.addChild(frame),
            () => container.removeChild(frame),
          ]);

          index++;
        });

        let target_unit = target.assigned;
        if (target_unit) {
          if (target_unit !== self)
            anim.splice(5, target_unit.animStagger(self));

          anim.splice(5, {
            script: () => target_unit.colorize(0xFF8800, lightness.shift()),
            repeat: lightness.length,
          });
        }

        anim.splice(anim.frames.length-1, () => parent.removeChild(container));

        return anim;
      },
    });

    return self;
  };

})();
