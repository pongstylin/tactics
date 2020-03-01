import Unit from 'tactics/Unit.js';

export default class Enchantress extends Unit {
  getBreakFocusResult() {
    return {
      unit: this,
      changes: {
        focusing: false,
      },
      results: [
        ...this.focusing.map(tUnit => ({
          unit: tUnit,
          changes: {
            paralyzed: tUnit.paralyzed.length === 1
              ? false
              : tUnit.paralyzed.filter(t => t !== this),
          },
        })),
      ],
    };
  }
}

// Dynamically add unit data properties to the class.
Enchantress.prototype.type = 'Enchantress';
