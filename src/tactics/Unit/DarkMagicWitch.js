import Unit from 'tactics/Unit.js';

export default class DarkMagicWitch extends Unit {
  getTargetTiles(target) {
    let direction = this.board.getDirection(this.assignment, target);
    let targets = [];

    let context = this.assignment;
    while (targets.length < 4) {
      context = context[direction];
      if (!context) break;

      targets.push(context);
    }

    return targets;
  }
}

// Dynamically add unit data properties to the class.
DarkMagicWitch.prototype.type = 'DarkMagicWitch';
