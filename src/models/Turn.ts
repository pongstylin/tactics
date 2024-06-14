import ActiveModel from '#models/ActiveModel.js';
import Team from '#models/Team.js';
import ServerError from '#server/Error.js';
import serializer from '#utils/serializer.js';

interface CreateProps {
  id: number
  team: any
  data: {
    startedAt?: Date
    actions?: any[]
    units: any[][]
    isLocked?: boolean
  }
  isCurrent?: boolean
  timeLimit?: number | null
}

export default class Turn extends ActiveModel {
  protected data: {
    startedAt: Date
    actions: any[]
    units: any[][]
    isLocked: boolean

    // e.g. timeBuffer?: number
    [x: string]: unknown;
  }
  readonly id: number
  readonly team: Team
  protected _isCurrent: boolean
  protected _timeLimit: number | null

  constructor(props) {
    super();

    if (props.isCurrent !== undefined) {
      props._isCurrent = props.isCurrent;
      delete props.isCurrent;
    }

    if (props.timeLimit !== undefined) {
      props._timeLimit = props.timeLimit;
      delete props.timeLimit;
    }

    Object.assign(this, {
      _isCurrent: false,
      _timeLimit: null,
    }, props, {
      data: Object.assign({
        // Whether the turn acts as a barrier against undo.
        isLocked: false,
      }, props.data.clone()), 
    });
  }

  static create(props:CreateProps) {
    return new Turn(Object.assign({
      isCurrent: true,
    }, props, {
      data: Object.assign({
        // The date the turn started
        startedAt: new Date(),

        // Actions performed during this turn
        actions: [],
      }, props.data),
    }));
  }

  get startedAt() {
    return this.data.startedAt;
  }
  set startedAt(v) {
    this.data.startedAt = v;
  }
  get actions() {
    return (this.data.actions as any).clone();
  }
  get units() {
    return (this.data.units as any).clone();
  }
  /*
   * Right now, the only consumer expects number of seconds, rounded down.
   */
  get timeElapsed() {
    return Math.floor(((this.endedAt ?? new Date()).getTime() - this.startedAt.getTime()) / 1000);
  }

  get isCurrent() {
    return this._isCurrent;
  }
  set isCurrent(v) {
    this._isCurrent = v;
  }
  get timeLimit() {
    return this._timeLimit;
  }
  set timeLimit(v) {
    this._timeLimit = v;
  }
  get isLocked() {
    return this.data.isLocked;
  }
  set isLocked(v) {
    if (this.data.isLocked === v)
      return;
    this.data.isLocked = v;
    this.emit('change:isLocked');
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

  pushAction(action) {
    this.data.actions.push(action);
    this.emit('change:pushAction');
  }
  resetTimeLimit(timeLimit) {
    this._timeLimit = Math.floor((Date.now() - this.startedAt.getTime())) / 1000 + timeLimit;
  }

  get(name, defaultValue = null) {
    return this.data[name] === undefined ? defaultValue : this.data[name];
  }
  set(name, value) {
    if (this.data[name] === value)
      return;
    this.data[name] = value;
    this.emit('change:set');
  }

  /*
   * Number of whole seconds that the turn has lasted.
   */
  get duration() {
    const turnEndedAt = this.isEnded ? (this.data.actions as any).last.createdAt.getTime() : Date.now();
    return Math.floor((turnEndedAt - this.startedAt.getTime()) / 1000);
  }
  get updatedAt() {
    return this.isEmpty ? this.startedAt : (this.data.actions as any).last.createdAt;
  }
  get endedAt() {
    return this.isEnded ? (this.data.actions as any).last.createdAt : null;
  }
  get gameEndedAt() {
    return this.isGameEnded ? (this.data.actions as any).last.createdAt : null;
  }

  get isEmpty() {
    return this.data.actions.length === 0;
  }
  get isEnded() {
    return (this.data.actions as any).last?.type === 'endTurn';
  }
  get isGameEnded() {
    return (this.data.actions as any).last?.type === 'endGame';
  }
  get isPlayable() {
    const actions = this.data.actions;
    return actions.length !== 1 || ![ 'endTurn', 'endGame' ].includes(actions[0].type) || !actions[0].forced;
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
      teamId: this.team.id,
      startedAt: this.startedAt,
      units: this.units, // a clone
      actions: this.actions, // a clone
    };

    if (this._timeLimit)
      data.timeLimit = this._timeLimit;

    return data;
  }

  /*
   * Turn digest sent to the client as part of recent turns.
   * Only the first turn includes units.
   */
  getDigest(includeUnits = true, includeTimeLimit = true) {
    const digest:any = {
      startedAt: this.startedAt,
      units: this.units, // a clone
      actions: this.actions, // a clone
    };

    if (!includeUnits)
      delete digest.units;

    if (includeTimeLimit && this._timeLimit)
      digest.timeLimit = this._timeLimit;

    return digest;
  }

  toJSON() {
    const data = super.toJSON();

    if (data.isLocked === false)
      delete data.isLocked;

    return data;
  }
}

serializer.addType({
  name: 'Turn',
  constructor: Turn,
  schema: {
    type: 'object',
    required: [ 'startedAt', 'actions', 'units' ],
    properties: {
      startedAt: { type:'string', subType:'Date' },
      actions: {
        type: 'array',
        items: { $ref:'#/definitions/action' },
        minItems: 1,
      },
      units: { $ref:'#/definitions/units' },
      isLocked: { type:'boolean' },
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
