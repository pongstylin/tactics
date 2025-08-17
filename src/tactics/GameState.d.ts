import type Board from '#tactics/Board.js';
import type Team from '#models/Team.ts';
import type Turn from '#models/Turn.ts';

export default class GameState {
  board: Board;
  id: string;
  type: string;
  teams: (Team | null)[];
  isPracticeMode: boolean;
  undoMode: 'strict' | 'loose' | null;
  strictFork: boolean;
  randomHitChance: boolean;

  turns: Turn[];
  actions: any[];
  timeLimit: any;
  startedAt: Date | null;
  turnStartedAt: Date | null;
  currentTeamId: number | null;
  lastUnloadedTurnId: number;
  endedAt: Date | null;
  winnerId: number | 'draw' | 'truce' | null;

  rated: boolean;
  unratedReason: string | null;

  _data: any;

  static create(data: {
    numTeams: number;
  }): GameState;

  start(): void;
  getTeamForPlayer(playerId:string): Team | null;
  getDataForPlayer(playerId:string): any | null;
  getTurnTimeLimit(turnId:number): number | null;
  submitAction(actions: any[]): void;
  canUndo(team?:Team): boolean;
  undo(team?:Team, approved?:boolean): void;
  getTurn(turnId:number): Turn;
  end(winnerId?:number | 'draw' | 'truce'): void;
};