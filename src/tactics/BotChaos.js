import Bot from '#tactics/Bot.js';

export default class extends Bot {
  constructor(state, team) {
    super(state, team);
  }

  startTurn() {
    let agent = this.team.units[0];

    if (agent.name === 'Chaos Seed')
      this.state.submitAction({ type:'endTurn' });
    else
      this.startTurnDragon();
  }
  startTurnDragon() {
    let agent = this.team.units[0];

    this.choices = [];
    this.friends = [agent];
    this.enemies = [];

    this.state.activeTeams.forEach(team => {
      if (team.units[0].color === agent.color) return;

      this.enemies.push(...team.units);
    });

    // Give the card time to fade.
    setTimeout(() => {
      let calc;

      this.addChoice(this.calcTeamFuture(this.team));

      if (this.inRange())
        this.considerUnit();
      else {
        this.considerPosition();

        if (agent.mRecovery === 0 && agent.mHealth < 0) {
          this.choices[0].first  = 'attack';
          this.choices[0].target = agent.assignment;
        }

        this.endTurn();
      }
    }, 1000);
  }
  considerUnit() {
    var unit = this.friends.pop();
    var start = unit.assignment;
    var direction = unit.direction;
    var tile,tiles;
    var i;

    if (unit.mRecovery === 0) {
      this.considerTurnOnly(unit);

      let targetData = this.considerTarget(unit);
      if (targetData)
        this.considerAttackOnly(unit, targetData);
      if (unit.mHealth < 0)
        this.considerSpecialOnly(unit);

      tiles = unit.getMoveTiles();

      for (i=0; i<tiles.length; i++) {
        unit.assign(tile = tiles[i]);

        if (targetData)
          this.considerAttackFirst(unit, tile, targetData);
        if (unit.mHealth < 0)
          this.considerSpecialFirst(unit, tile, { tile:start });
        this
          .considerMoveFirst(unit, tile)
          .considerMoveOnly(unit, tile);
      }

      unit.assign(start);
      unit.direction = direction;
      unit.mRecovery = 0;
    }

    // Use setTimeout to give the browser a chance to think while we think.
    if (this.friends.length)
      setTimeout(this.considerUnit, 10);
    else
      this.endTurn();

    return this;
  }
  considerSpecialOnly(unit) {
    let mHealth = unit.mHealth;

    unit.mRecovery = Math.ceil(unit.recovery / 2);
    unit.mHealth   = Math.min(0, unit.mHealth + unit.power);

    this.addChoice(Object.assign({
      unit:      unit,
      first:     'attack',
      target:    unit.assignment,
      direction: this.considerDirection(unit)
    }, this.calcTeamFuture(unit.team)));

    unit.mHealth = mHealth;
    return this;
  }
  considerSpecialFirst(unit, end, targetData) {
    let mHealth = unit.mHealth;

    unit.mRecovery = unit.recovery;
    unit.mHealth   = Math.min(0, unit.mHealth + unit.power);

    this.addChoice(Object.assign({
      unit:      unit,
      first:     'attack',
      target:    targetData.tile,
      end:       end,
      direction: this.considerDirection(unit)
    }, this.calcTeamFuture(unit.team)));

    unit.mHealth = mHealth;
    return this;
  }
}
