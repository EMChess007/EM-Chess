import type { PieceColor } from './chess';

// Mirrors backend/src/game/types.ts by hand — the mobile app and backend are separate npm
// projects with no shared module boundary, so this is a deliberate duplicate of the wire
// contract rather than an import. Keep the two in sync if the protocol ever changes.

export interface OnlineTimeControl {
  initialSeconds: number;
  incrementSeconds: number;
}

export type GameOverReason = 'checkmate' | 'stalemate' | 'draw' | 'timeout' | 'abandonment';

export interface JoinQueuePayload {
  timeControl: OnlineTimeControl;
  isChess960?: boolean;
}

export interface MakeMovePayload {
  roomId: string;
  from: string;
  to: string;
  promotion?: 'n' | 'b' | 'r' | 'q';
}

export interface RejoinGamePayload {
  roomId: string;
  playerToken: string;
}

export interface MatchFoundPayload {
  roomId: string;
  color: PieceColor;
  playerToken: string;
  opponent: { userId: string | null };
  timeControl: OnlineTimeControl;
  isChess960: boolean;
  fen: string;
  whiteMs: number;
  blackMs: number;
}

export interface OpponentMovePayload {
  from: string;
  to: string;
  promotion?: 'n' | 'b' | 'r' | 'q';
  san: string;
  fen: string;
  turn: PieceColor;
  whiteMs: number;
  blackMs: number;
}

export interface GameOverPayload {
  reason: GameOverReason;
  winner: PieceColor | null;
}

export interface RejoinStatePayload {
  fen: string;
  turn: PieceColor;
  color: PieceColor;
  timeControl: OnlineTimeControl;
  isChess960: boolean;
  whiteMs: number;
  blackMs: number;
  moves: { from: string; to: string; promotion?: string; san: string }[];
  opponentConnected: boolean;
}

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
