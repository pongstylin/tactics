import ActiveModel, { type AbstractEvents } from '#models/ActiveModel.js';
import type Team from '#models/Team.js';
// @ts-ignore
import serializer from '#utils/serializer.js';

type TurnEvents = AbstractEvents & {
  'change:startedAt': {},
  'change:drawCounts': {},
  'change:actionId': {},
  'change:pushAction': {},
  'change:set': {},
};
interface CreateProps {
  id?: number,
  team?: Team,
  data: {
    startedAt?: Date,
    actions?: any[],
    units: any[][],
    drawCounts: {
      passedTurnCount: number,
      attackTurnCount: number,
    } | null;
  }
  isCurrent?: boolean,
  timeLimit?: number | null,
};

export default class Turn extends ActiveModel<TurnEvents> {
  protected data: {
    // startedAt can be null in a fork game that hasn't started yet
    startedAt: Date | null,
    actions: any[],
    units: any[][],
    drawCounts: {
      passedTurnCount: number,
      attackTurnCount: number,
    } | null,

    // e.g. timeBuffer?: number
    [ x:string ]: unknown,
  }
  public id: number | null;
  public team: Team | null;
  protected _isCurrent: boolean;
  protected _timeLimit: number | null;

  constructor(props:{
    isClean?: boolean,
    isPersisted?: boolean,
    data: Turn['data'],
    id?: number,
    team?: Team,
    isCurrent?: boolean,
    timeLimit?: number | null,
  }) {
    super(props.pick('isClean', 'isPersisted'));

    Object.assign(this, {
      data: Object.assign({
        startedAt: null,
        actions: [],
        units: [],
        drawCounts: null,
      }, props.data.clone()),
      id: props.id ?? null,
      team: props.team ?? null,
      _isCurrent: props.isCurrent === undefined ? false : props.isCurrent,
      _timeLimit: props.timeLimit === undefined ? null : props.timeLimit,
    });

    if (this.team)
      this.team.isCurrent = this._isCurrent;
  }
  static fromJSON(data:Turn['data']) {
    return new Turn({ data });
  }

  static create(props:CreateProps) {
    return new Turn(Object.assign({
      isCurrent: true,
      isClean: false,
      isPersisted: false,
    }, props, {
      data: Object.assign({
        // The date and time the turn started
        startedAt: null,

        // Actions performed during this turn
        actions: [],
      }, props.data),
    }));
  }

  get startedAt() {
    return this.data.startedAt;
  }
  set startedAt(startedAt:Date | null) {
    if (!startedAt)
      throw new TypeError(`Can not set startedAt to null`);

    this.data.startedAt = startedAt;
    this.emit('change:startedAt');
  }
  get actions() {
    return this.data.actions.clone();
  }
  get units() {
    return this.data.units.clone();
  }
  get drawCounts() {
    return this.data.drawCounts;
  }
  set drawCounts(drawCounts:{ passedTurnCount:number, attackTurnCount:number } | null) {
    this.data.drawCounts = drawCounts;
    this.emit('change:drawCounts');
  }
  /*
   * Right now, the only consumer expects number of seconds, rounded down.
   */
  get timeElapsed() {
    if (!this.data.startedAt)
      return null;

    return Math.floor(((this.endedAt ?? new Date()).getTime() - this.data.startedAt.getTime()) / 1000);
  }

  get isCurrent() {
    return this._isCurrent;
  }
  set isCurrent(v) {
    this._isCurrent = this.team!.isCurrent = v;
  }
  get timeLimit() {
    return this._timeLimit;
  }
  set timeLimit(v) {
    this._timeLimit = v;
  }

  get unit() {
    return this.data.actions[0]?.unit ?? null;
  }

  get lastActionId() {
    return this.data.actions.length - 1;
  }
  get nextActionId() {
    return this.data.actions.length;
  }
  set nextActionId(actionId) {
    if (actionId >= this.data.actions.length)
      return;
    this.data.actions.length = actionId;
    this.emit('change:actionId');
  }

  pushAction(action:any) {
    this.data.actions.push(action);
    this.emit('change:pushAction');
  }
  resetTimeLimit(timeLimit:number) {
    if (!this.data.startedAt)
      return;

    this._timeLimit = Math.floor((Date.now() - this.data.startedAt.getTime()) / 1000) + timeLimit;
  }

  get(name:string, defaultValue:unknown = null) {
    return this.data[name] === undefined ? defaultValue : this.data[name];
  }
  set(name:string, value:unknown) {
    if (this.data[name] === value)
      return;
    this.data[name] = value;
    this.emit('change:set');
  }

  /*
   * Number of whole seconds that the turn has lasted.
   */
  get duration() {
    if (!this.data.startedAt)
      return null;

    const turnEndedAt = this.isEnded ? this.data.actions.last.createdAt.getTime() : Date.now();
    return Math.floor((turnEndedAt - this.data.startedAt.getTime()) / 1000);
  }
  get updatedAt() {
    return this.isEmpty ? this.startedAt : this.data.actions.last.createdAt;
  }
  get endedAt() {
    return this.isEnded ? this.data.actions.last.createdAt : null;
  }
  get gameEndedAt() {
    return this.isGameEnded ? this.data.actions.last.createdAt : null;
  }

  get isEmpty() {
    return this.data.actions.length === 0;
  }
  get isEnded() {
    return this.data.actions.last?.type === 'endTurn';
  }
  get isForcedEnded() {
    const lastAction = this.data.actions.last;
    return lastAction?.type === 'endTurn' && lastAction?.forced === true;
  }
  get isGameEnded() {
    return this.data.actions.last?.type === 'endGame';
  }
  get isPlayable() {
    const actions = this.data.actions;
    // If more than one action took place, it must be playable.
    if (actions.length !== 1)
      return true;
    // If the only action is not an end turn or end game action, it must be playable.
    if (![ 'endTurn', 'endGame' ].includes(actions[0].type))
      return true;
    // If the end turn or end game action was not forced, it must be playable.
    if (!actions[0].forced)
      return true;
    // If this turn ended the game in a truce, this turn must be playable.
    if (actions[0].type === 'endGame' && actions[0].winnerId === 'truce')
      return true;

    return false;
  }
  get isSkipped() {
    const actions = this.data.actions;
    return actions.length === 1 && actions[0].type === 'endTurn';
  }
  get isAutoSkipped() {
    const actions = this.data.actions;
    return actions.length === 1 && [ 'endTurn', 'endGame' ].includes(actions[0].type) && actions[0].forced;
  }

  /*
   * The full turn data as sent to the client.
   */
  getData() {
    const data:any = {
      id: this.id,
      teamId: this.team!.id,
      startedAt: this.startedAt,
      units: this.units, // a clone
      actions: this.actions, // a clone
    };

    if (this.drawCounts)
      data.drawCounts = this.drawCounts;
    if (this._timeLimit)
      data.timeLimit = this._timeLimit;

    return data;
  }

  /*
   * Turn digest sent to the client as part of recent turns.
   * Only the first turn includes units.
   * Only the last turn includes drawCounts.
   */
  getDigest(includeUnits = true, includeDrawCounts = true, includeTimeLimit = true) {
    const digest:any = {
      startedAt: this.startedAt,
      units: this.units, // a clone
      actions: this.actions, // a clone
      drawCounts: this.drawCounts ?? null,
    };

    if (!includeUnits)
      delete digest.units;
    if (!includeDrawCounts)
      delete digest.drawCounts;
    if (includeTimeLimit && this._timeLimit)
      digest.timeLimit = this._timeLimit;

    return digest;
  }
}

serializer.addType({
  name: 'Turn',
  constructor: Turn,
  schema: {
    type: 'object',
    required: [ 'startedAt', 'actions', 'units' ],
    properties: {
      startedAt: { type:[ 'string', 'null' ], subType:'Date' },
      actions: {
        type: 'array',
        items: { $ref:'#/definitions/action' },
        minItems: 1,
      },
      units: { $ref:'#/definitions/units' },
    },
    additionalProperties: true,
    definitions: {
      units: {
        type: 'array',
        minItems: 2,
        items: {
          type: 'array',
          items: { type:'object' },
        },
      },
      action: {
        type: 'object',
        required: [ 'type' ],
        properties: {
          type: { type:'string' },
          unit: { type:'number' },
          results: {
            type: 'array',
            items: { type:'object' },
          },
          teamId: { type:'number' },
          forced: { type:'boolean', const:true },
          createdAt: { type:'string', subType:'Date' },
        },
        additionalProperties: true,
      },
    },
  },
});
