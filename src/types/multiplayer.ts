import type { PieceColor, SpellCast } from './chess';
import type { SpellChessState } from '../logic/spellChess';

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
  | 'giveaway'
  | 'atomic'
  | 'duckChess'
  | 'spellChess'
  | 'horde';

export interface JoinQueuePayload {
  timeControl: OnlineTimeControl;
  isChess960?: boolean;
  isKingOfTheHill?: boolean;
  isThreeCheck?: boolean;
  isSetupChess?: boolean;
  isFogOfWar?: boolean;
  isGiveaway?: boolean;
  isAtomic?: boolean;
  isDuckChess?: boolean;
  isSpellChess?: boolean;
  isHorde?: boolean;
}

export interface MakeMovePayload {
  roomId: string;
  from: string;
  to: string;
  /** 'k' is only ever legal in Giveaway (a pawn may promote to a king there). */
  promotion?: 'n' | 'b' | 'r' | 'q' | 'k';
  /** Duck Chess only — where the duck goes as the second half of the turn; required with every move that does
   * not capture a king (the server refuses the whole turn otherwise). */
  duckTo?: string;
  /** Spell Chess only — the spell (if any) cast immediately before this move. The server recomputes a Freeze's
   * `squares` itself, so only `type`+`center`/`square` need to be sent; at most one per turn. */
  spell?: { type: 'freeze'; center: string } | { type: 'jump'; square: string };
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
  isAtomic: boolean;
  isDuckChess: boolean;
  isSpellChess: boolean;
  /** Horde — see horde.ts: the room started from the Horde position (36 White pawns, no White king). */
  isHorde: boolean;
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
  /** Duck Chess only — the square the duck was just placed on (absent after a king capture) and where it now
   * stands. */
  duck?: string;
  duckSquare?: string | null;
  /** Spell Chess only — the spell (if any) cast immediately before this move, and the full resulting state
   * (charges/cooldowns/pending effects). */
  spell?: SpellCast;
  spellState?: SpellChessState;
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
  isAtomic: boolean;
  isDuckChess: boolean;
  /** Duck Chess only — where the duck stands now. */
  duckSquare?: string | null;
  isSpellChess: boolean;
  /** Horde — see horde.ts: the room started from the Horde position (36 White pawns, no White king). */
  isHorde: boolean;
  /** Spell Chess only — charges/cooldowns/pending effects right now. */
  spellState?: SpellChessState;
  whiteMs: number;
  blackMs: number;
  /** Each entry's fields are all omitted together for a Fog of War move this viewer never
   * witnessed — always fully populated outside Fog of War. */
  moves: { from?: string; to?: string; promotion?: string; san?: string; duck?: string; spell?: SpellCast }[];
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
  isAtomic?: boolean;
  isDuckChess?: boolean;
  isSpellChess?: boolean;
  isHorde?: boolean;
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
