(function () {
  'use strict';

  Tactics.units[1].extend = function (self) {
    var _super = Object.assign({}, self);
    var board = Tactics.board;
    var data = Tactics.units[self.type];
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);

    Object.assign(self, {
      getAttackTiles: function () {
        let tiles = _super.getAttackTiles();
        tiles.unshift(self.assignment);

        return tiles;
      },
      getTargetTiles: function (target) {
        let target_tiles = [
          target,
          target.S,
          target.W,
          target.N,
          target.E,
        ].filter(tile => !!tile);

        // Blast closer tiles before further tiles.
        target_tiles.sort((a, b) =>
          board.getDistance(self.assignment, a) - board.getDistance(self.assignment, b)
        );

        return self._targets = target_tiles;
      },
      playAttack: function (center, results) {
        let targets   = self._targets;
        let anim      = new Tactics.Animation();
        let direction = board.getDirection(self.assignment, center, self.direction);

        /*
         * Animate the attack.  Blast closer tiles before further tiles.
         */
        let closest = board.getDistance(self.assignment, targets[0]);
        let attackAnim = self.animAttack(center);

        attackAnim.splice(0, () => sounds.attack.play());

        targets.forEach(target => {
          let index = 3 + (board.getDistance(self.assignment, target) - closest);

          attackAnim.splice(index, self.animFireBlast(target, center));
        });

        anim.splice(self.animTurn(direction));
        anim.splice(attackAnim);

        return anim.play();
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
