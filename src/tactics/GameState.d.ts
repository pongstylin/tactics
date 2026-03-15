import type Board from '#tactics/Board.js';
import type GameType from '#models/GameType.js';
import type Team from '#models/Team.js';
import type Turn from '#models/Turn.js';
import { type TypedEmitter } from '#utils/emitter.js';

type GameStateEvents = {
  'startTurn': {},
  'endGame': {},
  'sync': {},
  'join': { data:Team },
};

export default class GameState extends TypedEmitter<GameStateEvents> {
  board: Board;
  gameType: GameType;
  id: string;
  playerIds: string[];
  type: string | null;
  teams: (Team | null)[];
  isSimulation: boolean;
  isPracticeMode: boolean;
  isTournamentMode: boolean;
  isSinglePlayer: boolean;
  undoMode: 'strict' | 'loose' | null;
  strictFork: boolean;
  randomFirstTurn: boolean;
  randomHitChance: boolean;

  turns: Turn[];
  actions: any[];
  timeLimit: any;
  startedAt: Date | null;
  turnStartedAt: Date | null;
  turnEndedAt: Date | null;
  currentTurnId: number | null;
  currentTeamId: number | null;
  currentTeam: Team | null;
  currentTurn: Turn | null;
  currentTurnTimeLimit: number | null;
  lastUnloadedTurnId: number;
  endedAt: Date | null;
  winnerId: number | 'draw' | 'truce' | null;

  rated: boolean;
  unratedReason?: string;

  _data: any;

  static create(data: {
    numTeams: number;
  }): GameState;

  start(): void;
  getTeamForPlayer(playerId:string): Team | null;
  getDataForPlayer(playerId:string | undefined): any | null;
  getTurnTimeLimit(turnId:number): number | null;
  submitAction(actions: any[]): void;
  canUndo(team?:Team): boolean;
  undo(team?:Team, approved?:boolean): void;
  getTurn(turnId:number): Turn;
  teamHasPlayed(team:Team): boolean;
  end(winnerId?:number | 'draw' | 'truce'): void;
};