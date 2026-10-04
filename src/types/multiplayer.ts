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
  | 'threeCheck'
  | 'fogOfWar'
  | 'giveaway';

export interface JoinQueuePayload {
  timeControl: OnlineTimeControl;
  isChess960?: boolean;
  isKingOfTheHill?: boolean;
  isThreeCheck?: boolean;
  isSetupChess?: boolean;
  isFogOfWar?: boolean;
  isGiveaway?: boolean;
}

export interface MakeMovePayload {
  roomId: string;
  from: string;
  to: string;
  /** 'k' is only ever legal in Giveaway (a pawn may promote to a king there). */
  promotion?: 'n' | 'b' | 'r' | 'q' | 'k';
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
  isSetupChess: boolean;
  isFogOfWar: boolean;
  isGiveaway: boolean;
  fen: string;
  whiteMs: number;
  blackMs: number;
  /** Fog of War only — this recipient's own current visibility (square names); see
   * ChessBoard's visibleSquares prop. Even the classical starting position isn't fully visible
   * to either side under this variant's rule, so it's populated from the very first
   * `match_found` already. Omitted outside Fog of War. */
  visibleSquares?: string[];
}

export interface OpponentMovePayload {
  /** Omitted together (along with `san`) when this move happened outside the Fog of War
   * recipient's own visibility — the new (redacted) `fen`/`turn`/clocks/`visibleSquares` still
   * arrive, just not what specifically happened. Always present outside Fog of War. */
  from?: string;
  to?: string;
  promotion?: 'n' | 'b' | 'r' | 'q' | 'k';
  san?: string;
  fen: string;
  turn: PieceColor;
  whiteMs: number;
  blackMs: number;
  /** Fog of War only — see MatchFoundPayload.visibleSquares. */
  visibleSquares?: string[];
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
  isSetupChess: boolean;
  isFogOfWar: boolean;
  isGiveaway: boolean;
  whiteMs: number;
  blackMs: number;
  /** Each entry's fields are all omitted together for a Fog of War move this viewer never
   * witnessed — always fully populated outside Fog of War. */
  moves: { from?: string; to?: string; promotion?: string; san?: string }[];
  /** Fog of War only — see MatchFoundPayload.visibleSquares. */
  visibleSquares?: string[];
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
  isSetupChess?: boolean;
  isFogOfWar?: boolean;
  isGiveaway?: boolean;
  timeControlLabel?: string;
}

export interface JoinChallengePayload {
  code: string;
}

// --- Setup Chess (blind, simultaneous army-building before the room is created) --------------

export interface SetupChessPieceWire {
  square: string;
  type: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
}

/** Sent to both players the instant they're paired for a Setup Chess game — replaces
 * `match_found` for this one variant, since no room/roomId exists until both armies are in. */
export interface SetupChessPairedPayload {
  pairingId: string;
  color: PieceColor;
  opponent: { userId: string | null };
  timeControl: OnlineTimeControl;
}

export interface SubmitSetupChessPayload {
  pairingId: string;
  pieces: SetupChessPieceWire[];
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
