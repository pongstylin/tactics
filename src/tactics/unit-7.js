(function () {
  'use strict';

  Tactics.units[7].extend = function (self) {
    var _super = Object.assign({}, self);
    var board = Tactics.board;
    var data = Tactics.units[self.type];
    var sounds = Object.assign({}, Tactics.sounds, data.sounds);
    var special_ready = false;

    Object.assign(self, {
      highlightAttack: function () {
        if (self.viewed)
          _super.highlightAttack();
        else
          self.getAttackTiles().forEach(target => self.highlightTarget(target));

        return self;
      },
      attack: function (target) {
        let anim             = new Tactics.Animation();
        let direction        = board.getDirection(self.assignment, target, self.direction);

        let all_target_units = [];
        self.getAttackTiles().forEach(tile => {
          if (tile.assigned)
            all_target_units.push(tile.assigned);
        });

        // The result is required to display the effect of an attack, whether it
        // is a miss or how much health was lost or gained.
        let results = self.calcAttackResults(all_target_units);

        let attackAnim = self.animAttack(target);
        attackAnim.splice(1, () => sounds.attack1.play());
        attackAnim.splice(3, () => sounds.attack2.play());
        attackAnim.addFrame(() => self.drawFrame(data.stills[direction]));

        results.forEach(result => {
          let target_unit = result.unit;

          // Animate the target unit's reaction starting with the 4th attack frame.
          if (result.blocked)
            attackAnim
              .splice(3, target_unit.animBlock(self));
          else
            attackAnim
              .splice(3, self.animStrike(target_unit))
              .splice(4, target_unit.animStagger(self));
        });

        anim.splice(self.animTurn(direction));
        anim.splice(attackAnim)

        return anim.play().then(() => results);
      },
      canSpecial: function () {
        if (!self.canAttack())
          return false;
        else
          return (self.health + self.mHealth) < 5;
      },
      attackSpecial: function () {
        let anim = self.animSpecial();
        let cries = ['My legs!', 'What?', 'Mommy!', 'No fair!'];
        let taunts = ['Worth it', 'Bye', '...'];

        anim.splice(1, () => sounds.bomb1.play());

        let results = [];
        self.getAttackTiles().forEach(tile => {
          anim.splice(6, self.animExplode(tile));

          let target_unit = tile.assigned;
          if (!target_unit)
            return;

          let result = {unit:target_unit};

          if (target_unit.barriered)
            result.miss = true;
          else {
            result.mHealth = -target_unit.health;
            result.notice  = cries.randomize().shift();
          }

          results.push(result);
        });

        anim.splice(6, self.animExplode(self.assignment));
        anim.splice(9, () => sounds.bomb2.play());

        results.push({
          unit:    self,
          mHealth: -self.health,
          notice:  taunts.randomize()[0],
        });

        return anim.play().then(() => results);
      },
      animSpecial: function () {
        let anim = new Tactics.Animation();
        let direction = self.direction;

        let indexes = [];
        for (let index = data.special[direction][0]; index <= data.special[direction][1]; index++) {
          indexes.push(index);
        }
        indexes.forEach(index => anim.addFrame(() => self.drawFrame(index)));
        anim.addFrame(() => self.drawFrame(data.stills[direction]));

        return anim;
      },
      animExplode: function (tile) {
        let anim = new Tactics.Animation();
        let parent = Tactics.stage.children[1];
        let whiten = [0.60, 1, 0.80, 0.60, 0];

        let pos = tile.getCenter();
        let container = new PIXI.Container();
        container.position = new PIXI.Point(pos.x, pos.y);

        anim.addFrame(() => parent.addChild(container));

        let frames;
        if (tile === self.assignment)
          frames = self.effects.explode;
        else
          frames = data.effects.explode.frames.map(frame => self.compileFrame(frame, data.effects.explode));

        let index = 0;
        frames.forEach(frame => {
          anim.splice(index, [
            () => container.addChild(frame),
            () => container.removeChild(frame),
          ]);

          index++;
        });

        let target_unit = tile.assigned;
        if (target_unit) {
          if (target_unit !== self) {
            anim.splice(4, () => target_unit.drawTurn());
            anim.splice(5, () => target_unit.drawStand());
          }

          anim.splice(3, {
            script: () => target_unit.whiten(whiten.shift()),
            repeat: whiten.length,
          });
        }

        anim.splice(anim.frames.length-1, () => parent.removeChild(container));

        return anim;
      },
    });

    return self;
  };

})();
