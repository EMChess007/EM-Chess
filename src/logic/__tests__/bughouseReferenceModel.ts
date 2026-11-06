// DEV/TEST-ONLY: chessops is GPL-3.0-or-later and lives in devDependencies; like crazyhouseOracle.test.ts this file may use it as an independent oracle, and must never be imported from
// anything that ships.
import { makeFen, parseFen } from 'chessops/fen';
import { parseUci } from 'chessops/util';
import { Crazyhouse } from 'chessops/variant';

/**
 * THE REFERENCE MODEL of a whole Bughouse match (BUGHOUSE_SPEC.md HP1, W1 test 2b): two boards, four pockets, four clocks, the flag settlement, the verdicts and the result - written
 * independently of src/logic/bughouse, with the simplest code that can be right.
 *
 *  - ONE-BOARD RULES (legal moves, legal drops, check, castling, en passant, promotion, promoted marks, what a capture takes) come from chessops's `Crazyhouse` - lichess's
 *    implementation, not chess.js and not this repo's crazyhouse.ts - rebuilt from a FEN with the two pockets for every question. Nothing is cached between steps.
 *  - EVERYTHING ABOVE ONE BOARD is plain arithmetic here: the credit to the capturer's partner, the clocks (a deadline is `since + remaining`), the settlement of due flags before an
 *    input, the tie-break, `stuck`, the result. "Could a dropped piece EVER answer this check" is answered by brute force: give the side to move one knight, bishop, rook and queen and
 *    ask chessops whether ANY drop is legal.
 *
 * Seats and boards are numbers here (board 0 = A, 1 = B; seat = 2 * board + (0 White | 1 Black); the partner of seat s is 3 - s; the opponent is s ^ 1; team of seat s: 1 for seats 0 and
 * 3, 2 for seats 1 and 2) - deliberately not the engine's tables.
 */
const ROLE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' } as const;
type Letter = keyof typeof ROLE;
const LETTERS: Letter[] = ['p', 'n', 'b', 'r', 'q'];
type Pos = ReturnType<typeof Crazyhouse.default>;

const sqName = (i: number) => 'abcdefgh'[i & 7] + ((i >> 3) + 1);
const teamOf = (seat: number) => (seat === 0 || seat === 3 ? 1 : 2);
const boardOfSeat = (seat: number) => seat >> 1;
const BOARD_NAME = ['A', 'B'];

export interface RefClock {
  remaining: number;
  since: number | null;
  startSeq: number;
}
export interface RefResult {
  winnerTeam?: number;
  reason: string;
  board?: string;
  loserSeat?: number;
  voided?: true;
}
export interface RefVerdict {
  status: 'playing' | 'check' | 'checkmate' | 'stuck';
  turn: 'w' | 'b';
  inCheck: boolean;
  stuck: 'check' | 'noAction' | null;
}
export type RefOutcome =
  | { kind: 'idle' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'applied'; banked: { seat: number; piece: Letter } | null }
  | { kind: 'flag'; discarded: boolean };

export class RefMatch {
  seq = 0;
  now: number;
  /** per board: the FEN of the position WITHOUT its pockets (placement with ~ marks, turn, castling, en passant, clocks) */
  rest: string[] = ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'];
  plies = [0, 0];
  pockets: Record<Letter, number>[] = [0, 1, 2, 3].map(() => ({ p: 0, n: 0, b: 0, r: 0, q: 0 }));
  clocks: RefClock[];
  result: RefResult | null = null;
  verdicts: RefVerdict[];

  constructor(readonly initial: number, readonly increment: number, readonly room: number, start: number) {
    this.now = start;
    this.clocks = [0, 1, 2, 3].map((seat) => ({ remaining: initial, since: seat % 2 === 0 ? start : null, startSeq: 0 }));
    this.verdicts = [this.judge(0), this.judge(1)];
  }

  // --- one board, through chessops ----------------------------------------------------------------------------------------------------------

  private pocketText(board: number, whiteExtra?: Record<Letter, number>, blackExtra?: Record<Letter, number>): string {
    const w = whiteExtra ?? this.pockets[2 * board];
    const b = blackExtra ?? this.pockets[2 * board + 1];
    return LETTERS.map((l) => l.toUpperCase().repeat(w[l])).join('') + LETTERS.map((l) => l.repeat(b[l])).join('');
  }

  private fenWith(board: number, white?: Record<Letter, number>, black?: Record<Letter, number>): string {
    const [placement, ...tail] = this.rest[board].split(' ');
    return `${placement}[${this.pocketText(board, white, black)}] ${tail.join(' ')}`;
  }

  private position(board: number, white?: Record<Letter, number>, black?: Record<Letter, number>): Pos {
    return Crazyhouse.fromSetup(parseFen(this.fenWith(board, white, black)).unwrap()).unwrap();
  }

  /** Legal moves as "e2e4" / "e7e8q" keys, castling written as the king's two-square move, sorted. */
  moveKeys(pos: Pos): string[] {
    const keys: string[] = [];
    for (const [from, dests] of pos.allDests()) {
      const role = pos.board.getRole(from);
      for (const to of dests) {
        const target = pos.board.get(to);
        if (role === 'king' && target && target.color === pos.turn && target.role === 'rook') keys.push(sqName(from) + sqName((from >> 3) * 8 + ((to & 7) > (from & 7) ? 6 : 2)));
        else if (role === 'pawn' && (to >> 3 === 7 || to >> 3 === 0)) for (const p of 'qrbn') keys.push(sqName(from) + sqName(to) + p);
        else keys.push(sqName(from) + sqName(to));
      }
    }
    return keys.sort();
  }

  /** Legal drops as "n@f3" keys, sorted. */
  dropKeys(pos: Pos): string[] {
    const keys: string[] = [];
    const pocket = pos.pockets?.[pos.turn];
    if (!pocket) return keys;
    for (const letter of LETTERS) {
      if (!pocket[ROLE[letter]]) continue;
      for (let sq = 0; sq < 64; sq++) if (!pos.board.has(sq) && pos.isLegal({ role: ROLE[letter], to: sq })) keys.push(`${letter}@${sqName(sq)}`);
    }
    return keys.sort();
  }

  /** What chessops says about a position, cached by the FULL FEN TEXT (pockets included): the same text can only ever mean the same answers, so no invalidation is needed. */
  private cache = new Map<string, { moves: string[]; drops: string[]; check: boolean; turn: 'w' | 'b'; promoted: string[] }>();

  private info(board: number, white?: Record<Letter, number>, black?: Record<Letter, number>) {
    const key = this.fenWith(board, white, black);
    let entry = this.cache.get(key);
    if (!entry) {
      const pos = Crazyhouse.fromSetup(parseFen(key).unwrap()).unwrap();
      entry = { moves: this.moveKeys(pos), drops: this.dropKeys(pos), check: pos.isCheck(), turn: pos.turn === 'white' ? 'w' : 'b', promoted: [...pos.board.promoted].map(sqName).sort() };
      if (this.cache.size > 400) this.cache.clear();
      this.cache.set(key, entry);
    }
    return entry;
  }

  legalMoveKeys(board: number): string[] {
    return this.result ? [] : this.info(board).moves;
  }

  legalDropKeys(board: number): string[] {
    return this.result ? [] : this.info(board).drops;
  }

  private judge(board: number): RefVerdict {
    const here = this.info(board);
    const { turn, check: inCheck } = here;
    if (here.moves.length > 0 || here.drops.length > 0) return { status: inCheck ? 'check' : 'playing', turn, inCheck, stuck: null };
    if (!inCheck) return { status: 'stuck', turn, inCheck: false, stuck: 'noAction' };
    // in check with nothing to do: could ANY piece, if the player had it, answer? Give them one of each (not a pawn: a pawn is no better than a knight on a blocking square it can use)
    // and ask whether any drop is legal.
    const one: Record<Letter, number> = { p: 0, n: 1, b: 1, r: 1, q: 1 };
    const rich = turn === 'w' ? this.info(board, one, undefined) : this.info(board, undefined, one);
    return rich.drops.length > 0 ? { status: 'stuck', turn, inCheck: true, stuck: 'check' } : { status: 'checkmate', turn, inCheck: true, stuck: null };
  }

  // --- clocks and settlement ---------------------------------------------------------------------------------------------------------------

  private freeze(at: number): void {
    for (const c of this.clocks) {
      if (c.since !== null) {
        c.remaining = Math.max(0, c.remaining - (at - c.since));
        c.since = null;
      }
    }
  }

  private due(now: number): { seat: number; deadline: number }[] {
    const out: { seat: number; deadline: number }[] = [];
    this.clocks.forEach((c, seat) => {
      if (c.since !== null && c.since + c.remaining <= now) out.push({ seat, deadline: c.since + c.remaining });
    });
    return out;
  }

  private loserOf(due: { seat: number; deadline: number }[]): { seat: number; deadline: number } {
    const losingBoard = this.room % 2; // 0 = A, 1 = B
    return [...due].sort((a, b) => {
      if (a.deadline !== b.deadline) return a.deadline - b.deadline;
      const sa = this.clocks[a.seat].startSeq;
      const sb = this.clocks[b.seat].startSeq;
      if (sa !== sb) return sa - sb;
      return (boardOfSeat(a.seat) === losingBoard ? 0 : 1) - (boardOfSeat(b.seat) === losingBoard ? 0 : 1);
    })[0];
  }

  // --- one step of the funnel --------------------------------------------------------------------------------------------------------------

  step(input: { seat: any; action: any } | null, now: number): RefOutcome {
    if (this.result) return input === null ? { kind: 'idle' } : { kind: 'rejected', reason: 'over' };
    if (!Number.isSafeInteger(now) || now < 0 || now < this.now) return { kind: 'rejected', reason: 'time' };
    const due = this.due(now);
    if (due.length > 0) {
      const loser = this.loserOf(due);
      this.seq += 1;
      this.now = now;
      this.freeze(loser.deadline);
      this.result = { winnerTeam: 3 - teamOf(loser.seat), reason: 'flag', board: BOARD_NAME[boardOfSeat(loser.seat)], loserSeat: loser.seat };
      return { kind: 'flag', discarded: input !== null };
    }
    if (input === null) return { kind: 'idle' };
    return this.apply(input.seat, input.action, now);
  }

  private apply(seat: any, action: any, now: number): RefOutcome {
    const kinds = ['move', 'drop', 'resign'];
    if (!Number.isInteger(seat) || seat < 0 || seat > 3 || typeof action !== 'object' || action === null || !kinds.includes(action.kind)) return { kind: 'rejected', reason: 'malformed' };
    const square = /^[a-h][1-8]$/;
    if (action.kind === 'move' && !(BOARD_NAME.includes(action.board) && typeof action.from === 'string' && square.test(action.from) && typeof action.to === 'string' && square.test(action.to) && (action.promotion === undefined || (typeof action.promotion === 'string' && action.promotion.length === 1 && 'qrbn'.includes(action.promotion))))) return { kind: 'rejected', reason: 'malformed' };
    if (action.kind === 'drop' && !(BOARD_NAME.includes(action.board) && typeof action.piece === 'string' && LETTERS.includes(action.piece as Letter) && typeof action.square === 'string' && square.test(action.square))) return { kind: 'rejected', reason: 'malformed' };

    if (action.kind === 'resign') {
      this.seq += 1;
      this.now = now;
      this.freeze(now);
      this.result = { winnerTeam: 3 - teamOf(seat), reason: 'resign', board: BOARD_NAME[boardOfSeat(seat)], loserSeat: seat };
      return { kind: 'applied', banked: null };
    }

    const board = boardOfSeat(seat);
    if (action.board !== BOARD_NAME[board]) return { kind: 'rejected', reason: 'wrongBoard' };
    if (this.verdicts[board].turn !== (seat % 2 === 0 ? 'w' : 'b')) return { kind: 'rejected', reason: 'notYourTurn' };

    const here = this.info(board);
    let banked: { seat: number; piece: Letter } | null = null;
    let pos: Pos;
    if (action.kind === 'move') {
      const key = action.from + action.to;
      const legal = here.moves;
      const promoting = legal.filter((k) => k.startsWith(key) && k.length === 5);
      const wanted = promoting.length > 0 ? key + action.promotion : key; // a promotion move needs its piece; any other ignores the field
      if (!legal.includes(wanted)) return { kind: 'rejected', reason: 'illegalMove' };
      pos = this.position(board);
      const color = pos.turn;
      const fromSq = 'abcdefgh'.indexOf(action.from[0]) + 8 * (Number(action.from[1]) - 1);
      const role = pos.board.getRole(fromSq);
      let uci = wanted;
      if (role === 'king' && Math.abs('abcdefgh'.indexOf(action.to[0]) - 'abcdefgh'.indexOf(action.from[0])) === 2) uci = action.from + (action.to[0] === 'g' ? 'h' : 'a') + action.from[1]; // chessops writes castling king -> rook
      const before = pos.pockets![color];
      const beforeCounts = LETTERS.map((l) => before[ROLE[l]]);
      pos.play(parseUci(uci)!);
      const after = pos.pockets![color];
      LETTERS.forEach((l, i) => {
        if (after[ROLE[l]] > beforeCounts[i]) banked = { seat: 3 - seat, piece: l };
      });
    } else {
      const pocket = this.pockets[seat];
      if (!(pocket[action.piece as Letter] > 0)) return { kind: 'rejected', reason: 'dropNotInPocket' };
      if (!here.drops.includes(`${action.piece}@${action.square}`)) return { kind: 'rejected', reason: 'illegalDrop' };
      pos = this.position(board);
      pos.play({ role: ROLE[action.piece as Letter], to: 'abcdefgh'.indexOf(action.square[0]) + 8 * (Number(action.square[1]) - 1) });
      pocket[action.piece as Letter] -= 1;
    }

    // commit: keep chessops's new position WITHOUT its pockets (ours are the four seats' own); the capture goes to the partner, not to the mover
    this.rest[board] = makeFen(pos.toSetup()).replace(/\[[^\]]*\]/, '');
    this.plies[board] += 1;
    if (banked) this.pockets[(banked as { seat: number }).seat][(banked as { piece: Letter }).piece] += 1;
    this.seq += 1;
    this.now = now;
    this.verdicts = [this.judge(0), this.judge(1)]; // both boards, every time: the model assumes nothing about which board a commit can touch

    const mover = this.clocks[seat];
    mover.remaining = mover.remaining - (now - (mover.since as number)) + this.increment;
    mover.since = null;
    if (this.verdicts[board].status === 'checkmate') {
      this.freeze(now);
      this.result = { winnerTeam: teamOf(seat), reason: 'checkmate', board: BOARD_NAME[board], loserSeat: seat ^ 1 };
      return { kind: 'applied', banked };
    }
    const opponent = this.clocks[seat ^ 1];
    opponent.since = now;
    opponent.startSeq = this.seq;
    return { kind: 'applied', banked };
  }

  voidIt(now: number): boolean {
    if (this.result || now < this.now) return false;
    this.seq += 1;
    this.now = now;
    this.freeze(now);
    this.result = { voided: true, reason: 'abandoned' };
    return true;
  }

  /** The promoted squares of a board, sorted - chessops's own record. */
  promotedSquares(board: number): string[] {
    return this.info(board).promoted;
  }

  /** What a comparison with the engine looks at, as plain text. */
  describe(): string {
    const parts: string[] = [`seq ${this.seq} now ${this.now}`];
    for (let board = 0; board < 2; board++) {
      const f = this.rest[board].split(' ');
      parts.push(`${BOARD_NAME[board]} ${f[0].replace(/~/g, '')} ${f[1]} ${f[2]} promoted ${this.promotedSquares(board).join(',')} plies ${this.plies[board]} verdict ${JSON.stringify(this.verdicts[board])}`);
    }
    parts.push(`pockets ${this.pockets.map((p) => LETTERS.map((l) => p[l]).join('')).join('|')}`);
    parts.push(`clocks ${this.clocks.map((c) => `${c.remaining}/${c.since}/${c.startSeq}`).join('|')}`);
    parts.push(`result ${JSON.stringify(this.result)}`);
    return parts.join('\n');
  }
}
