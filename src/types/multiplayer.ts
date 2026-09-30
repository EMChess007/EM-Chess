import type { PieceColor } from './chess';

// Mirrors backend/src/game/types.ts by hand — the mobile app and backend are separate npm
// projects with no shared module boundary, so this is a deliberate duplicate of the wire
// contract rather than an import. Keep the two in sync if the protocol ever changes.

export interface OnlineTimeControl {
  initialSeconds: number;
  incrementSeconds: number;
}

export type GameOverReason =
  | 'checkmate'
  | 'stalemate'
  | 'draw'
  | 'timeout'
  | 'abandonment'
  | 'resignation'
  | 'kingOfTheHill'
  | 'threeCheck';

export interface JoinQueuePayload {
  timeControl: OnlineTimeControl;
  isChess960?: boolean;
  isKingOfTheHill?: boolean;
  isThreeCheck?: boolean;
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

export interface ResignPayload {
  roomId: string;
}

export interface OfferDrawPayload {
  roomId: string;
}

export interface RespondDrawPayload {
  roomId: string;
  accept: boolean;
}

export interface SendChatPayload {
  roomId: string;
  text: string;
}

export interface MatchFoundPayload {
  roomId: string;
  color: PieceColor;
  playerToken: string;
  opponent: { userId: string | null };
  timeControl: OnlineTimeControl;
  isChess960: boolean;
  isKingOfTheHill: boolean;
  isThreeCheck: boolean;
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

export interface DrawOfferedPayload {
  by: PieceColor;
}

export interface ChatMessagePayload {
  from: PieceColor;
  text: string;
  sentAt: number;
}

export interface RejoinStatePayload {
  fen: string;
  turn: PieceColor;
  color: PieceColor;
  timeControl: OnlineTimeControl;
  isChess960: boolean;
  isKingOfTheHill: boolean;
  isThreeCheck: boolean;
  whiteMs: number;
  blackMs: number;
  moves: { from: string; to: string; promotion?: string; san: string }[];
  opponentConnected: boolean;
}

/** Same live game state a rejoining player gets, minus the two fields that only make sense for
 * an actual seated player — see the backend's identical type for why. */
export type SpectateStatePayload = Omit<RejoinStatePayload, 'color' | 'opponentConnected'>;

export interface SpectatorMovePayload extends OpponentMovePayload {
  mover: PieceColor;
}

export interface ActiveGameSummary {
  roomId: string;
  timeControlLabel: string;
  isChess960: boolean;
  whiteUsername: string;
  blackUsername: string;
}

export interface CreateChallengePayload {
  timeControl: OnlineTimeControl;
  isChess960?: boolean;
  isKingOfTheHill?: boolean;
  isThreeCheck?: boolean;
  timeControlLabel?: string;
}

export interface JoinChallengePayload {
  code: string;
}

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

// --- Tournaments -------------------------------------------------------------

export type TournamentStatus = 'lobby' | 'active' | 'finished';

export interface CreateTournamentPayload {
  name: string;
  timeControl: OnlineTimeControl;
  timeControlLabel?: string;
  isChess960?: boolean;
  isKingOfTheHill?: boolean;
  isThreeCheck?: boolean;
}

export interface JoinTournamentPayload {
  code: string;
}

export interface TournamentIdPayload {
  tournamentId: string;
}

export interface TournamentParticipantSummary {
  userId: string;
  username: string;
}

export interface TournamentLobbyState {
  id: string;
  code: string;
  name: string;
  timeControl: OnlineTimeControl;
  isChess960: boolean;
  isKingOfTheHill: boolean;
  isThreeCheck: boolean;
  status: TournamentStatus;
  creatorUserId: string;
  participants: TournamentParticipantSummary[];
}

export interface TournamentStandingRow {
  userId: string;
  username: string;
  points: number;
  played: number;
}

export interface TournamentNextMatch {
  status: 'pending' | 'active';
  opponentUsername: string;
  timeControl: OnlineTimeControl;
  isChess960: boolean;
  isKingOfTheHill: boolean;
  isThreeCheck: boolean;
  roomId: string | null;
  playerToken: string | null;
  color: PieceColor | null;
  fen: string | null;
  whiteMs: number | null;
  blackMs: number | null;
}

export interface TournamentStandingsPayload {
  standings: TournamentStandingRow[];
  status: TournamentStatus;
  yourNextMatch: TournamentNextMatch | null;
}

/** Same shape as MatchFoundPayload — a tournament match is an ordinary game room in every
 * respect once it starts, so the client reuses OnlineGameScreen unchanged for it. */
export interface TournamentMatchReadyPayload {
  roomId: string;
  color: PieceColor;
  playerToken: string;
  opponent: { userId: string; username: string };
  timeControl: OnlineTimeControl;
  isChess960: boolean;
  isKingOfTheHill: boolean;
  isThreeCheck: boolean;
  fen: string;
  whiteMs: number;
  blackMs: number;
}
