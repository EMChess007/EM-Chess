import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ChessEngine } from '../logic/ChessEngine';
import { getLegalDuckPlacementSquares } from '../logic/duckChess';
import { getGiveawayMoves } from '../logic/giveaway';
import { isTouchInside, subscribeToScreenTouches } from '../logic/screenTouches';
import { PROMOTION_LABELS, type PromotionPiece, getPromotionChoices, isPromotionMove } from '../logic/promotion';
import {
  activeJumpSquare,
  canCastFreeze,
  canCastJump,
  checkIsWaivedByFreeze,
  frozenSquaresFor,
  getFreezeZoneSquares,
  type SpellChessState,
} from '../logic/spellChess';
import { useActiveBoardTheme, useActivePieceTheme } from '../logic/themeHooks';
import type { ExplodedPiece, Move, PieceColor, Piece as PieceModel, SpellCast } from '../types/chess';
import BoardAnnotations, { type BoardArrow, type GridPoint } from './BoardAnnotations';
import { getBoardSize } from './boardSize';
import Piece from './Piece';
import Square from './Square';

// How long a hold must last before it's treated as "start drawing an arrow/highlight" instead of
// a normal tap-to-select/tap-to-move — long enough that an ordinary quick tap never triggers it.
const LONG_PRESS_MS = 400;
// How far (in raw screen pixels) a touch may drift before the long-press timer even has a chance
// to fire and still count as "held in place" — beyond this it's read as an intentional drag
// starting immediately, not a long-press.
const MOVE_THRESHOLD_PX = 10;

export interface PremoveIntent {
  from: string;
  to: string;
  promotion?: Move['promotion'];
}

interface ChessBoardProps {
  fen: string;
  onMove: (move: Move, fen: string) => void;
  disabled?: boolean;
  chess960?: boolean;
  initialFen?: string;
  /** Which side's pieces render at the bottom. Defaults to 'w' (White at bottom, as usual). */
  orientation?: PieceColor;
  /** The move that produced the current `fen` (from whichever position was displayed just
   * before it), if any — highlights its two squares and, when it looks like a genuine single
   * forward step (see the animation effect below), slides the piece in from origin to
   * destination instead of it just appearing at the destination. Pass `null`/omit for a
   * freshly-set-up board with no "last move" to show. */
  lastMove?: Move | null;
  /** Lets the player long-press-drag to draw arrows and tap-and-hold to highlight squares (see
   * BoardAnnotations) — cleared automatically whenever `fen` changes. Off by default; only
   * Analysis/Local/Bot screens turn it on today. */
  enableAnnotations?: boolean;
  /** When set (to the local player's own color) and it isn't currently that color's turn, lets
   * the player select one of their own pieces and a destination anyway — instead of attempting a
   * real move, this calls `onPremove` with the raw (unvalidated) intent. The caller owns queuing/
   * executing/cancelling it once it's actually this color's turn (see OnlineGameScreen/
   * BotGameScreen's premove state) — ChessBoard itself doesn't preview legal targets for it, since
   * whether it's still legal can only really be known once it's actually that color's turn. */
  premoveColor?: PieceColor;
  onPremove?: (move: PremoveIntent) => void;
  /** Lightly highlights the 4 center squares (d4/d5/e4/e5) — the King of the Hill win condition —
   * so it's clear what the target is. Off by default; only screens actually playing that variant
   * turn it on. */
  kingOfTheHill?: boolean;
  /** Fog of War only — switches move interaction from legal moves (king-safety enforced) to
   * pseudo-legal moves (see ChessEngine.getPseudoLegalMoves/movePseudoLegal): a move is allowed
   * even if it leaves the mover's own king exposed, and landing on the enemy king is a normal,
   * allowed capture rather than something chess.js would otherwise refuse to generate. Also
   * suppresses check highlighting and the normal isGameOver() gate — see getStatus()'s own
   * chess.js-driven checkmate/stalemate detection, which doesn't apply to this variant at all
   * (rule: no check/checkmate concept); the caller alone decides when the game ends, via
   * `move.captured === 'k'` on whatever movePseudoLegal/onMove returns. */
  fogOfWar?: boolean;
  /** Giveaway (Antichess) only — see giveaway.ts. Like fogOfWar, switches move interaction to the
   * pseudo-legal generator (no check concept, capturable kings, no king-safety filtering), but
   * narrowed by the mandatory-capture rule via getGiveawayMoves, and the promotion picker also
   * offers a king. Also drops the normal isGameOver()/check highlighting; the caller decides when
   * the game ends (getGiveawayWinner). Mutually exclusive with every other variant. */
  giveaway?: boolean;
  /** Atomic chess only — see atomic.ts. The engine (constructed with { atomic: true }) answers
   * legal moves, check and game state itself, so unlike fogOfWar/giveaway this does NOT switch to the
   * pseudo-legal generator and normal check highlighting stays on (it is Atomic-aware). Capture-
   * promotions skip the piece picker (a queen is auto-picked: the new piece explodes with the
   * capturer, so every choice is identical), and a move's `exploded` pieces get a short flash/fade.
   * Mutually exclusive with every other variant. */
  atomic?: boolean;
  /** Duck Chess only — see duckChess.ts. A turn is TWO actions: after a regular move commits, the board
   * enters a "placing the duck" state (the post-move position is shown, every empty square except the
   * duck's own is highlighted) and only once a square is tapped does `onMove` fire — with the duck's
   * square on `move.duck`, as one atomic turn (nothing is handed to the caller before that, so clocks,
   * history and the opponent only ever see complete turns). A move that captures a king ends the game at
   * once, with no placement. Tapping the piece that just moved takes the move back. Like Fog of War this
   * uses the pseudo-legal generator (no check concept), with the duck blocking. */
  duckChess?: boolean;
  /** Duck Chess: where the duck stands in the position `fen` (null before White's first move). */
  duckSquare?: string | null;
  /** Duck Chess: told whenever the board enters/leaves the "placing the duck" state, so the screen can
   * say so in its status line. */
  onDuckPlacementChange?: (placing: boolean) => void;
  /** Spell Chess only — see spellChess.ts. A turn is "optionally cast a spell, THEN make a move" — the
   * reverse order of Duck Chess's "move, then place the duck", but the same shape: this component owns
   * the in-progress cast (see pendingCast/castMode below) and only calls `onMove` once a real move is
   * made, with the cast (if any) attached as `move.spell`. `spellState` is the charges/cooldowns/pending
   * freeze+jump carried in from the PREVIOUS ply (GameHistoryEntry.spellState, or
   * spellChess.initialSpellChessState() before White's first move) — this component derives
   * frozenSquares/jumpSquare/freezeEscapeActive from it (plus whatever is being cast THIS turn) itself,
   * rather than have the caller duplicate that math. The caller is only responsible for advancing
   * `spellState` for the NEXT render once `onMove` reports a committed `move.spell` (see
   * LocalGameScreen/BotGameScreen: castFreeze/castJump then afterSpellChessMove, mirroring how they
   * already derive duckSquare from history). Mutually exclusive with every other variant. */
  spellChess?: boolean;
  spellState?: SpellChessState;
  /** Fog of War only — the squares currently visible to the LOCAL viewer. Squares outside this
   * set render fogged (see Square's isFogged) regardless of what `fen`/the engine actually has
   * there: for Local/Bot this is still the true fen client-side (there's no network boundary to
   * protect there, just a display-correctness concern), and for Online the fen arriving here is
   * already server-redacted, but a blank square in a redacted fen is ambiguous between "known
   * empty" and "fogged" — this set is what actually disambiguates the two. Omit entirely outside
   * Fog of War (undefined means "nothing is fogged").
   */
  visibleSquares?: Set<string>;
}

const KING_OF_THE_HILL_SQUARES = ['d4', 'd5', 'e4', 'e5'];
// Stable (never-recreated) empty array for the "nothing frozen" case below — a fresh `[]` literal
// on every render would be a new reference each time, defeating the `engine` useMemo's dependency
// check for every variant, not just Spell Chess (see its own `spellFrozenSquares` doc comment).
const NO_FROZEN_SQUARES: string[] = [];

const ANIMATION_DURATION_MS = 200;
// Atomic explosion flash/fade: starts when the sliding piece lands, then fades out over this long.
const EXPLOSION_DURATION_MS = 450;

/** The side to move in a FEN string, read directly off its own 2nd field — far cheaper than
 * building a whole ChessEngine just to call getTurn() when all that's needed is this one field
 * (see the Spell Chess derivations above, which need it before `engine` itself exists). */
function turnFromFen(fen: string): PieceColor {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

function squareToRowCol(square: string, orientation: PieceColor): { row: number; col: number } {
  const file = square.charCodeAt(0) - 97; // 'a' -> 0
  const rank = parseInt(square[1], 10);
  let row = 8 - rank; // 0 = rank 8 (top, unflipped)
  let col = file; // 0 = file a (left, unflipped)
  if (orientation === 'b') {
    row = 7 - row;
    col = 7 - col;
  }
  return { row, col };
}

/** Inverse of squareToRowCol — the grid cell under a finger back to an algebraic square id. */
function rowColToSquare(row: number, col: number, orientation: PieceColor): string {
  const r = orientation === 'b' ? 7 - row : row;
  const c = orientation === 'b' ? 7 - col : col;
  const rank = 8 - r;
  const file = String.fromCharCode(97 + c);
  return `${file}${rank}`;
}

function ChessBoard({
  fen,
  onMove,
  disabled,
  chess960,
  initialFen,
  orientation = 'w',
  lastMove,
  enableAnnotations = false,
  premoveColor,
  onPremove,
  kingOfTheHill = false,
  fogOfWar = false,
  giveaway = false,
  atomic = false,
  duckChess = false,
  duckSquare = null,
  onDuckPlacementChange,
  spellChess = false,
  spellState,
  visibleSquares,
}: ChessBoardProps) {
  const { width, height } = useWindowDimensions();
  // The board is the SAME size in every variant, Spell Chess included — its Freeze/Jump row is made to fit by trimming
  // spacing elsewhere (GameScreenBody's `compact`), never by shrinking this. See SPELL_BAR_HEIGHT below.
  const boardSize = getBoardSize(width, height);
  const squareSize = boardSize / 8;
  const boardTheme = useActiveBoardTheme();
  const pieceTheme = useActivePieceTheme();

  // skipValidation: Online Fog of War's `fen` is server-redacted and can legitimately be missing
  // a king the viewer can't currently see — see ChessEngine's own doc comment on the option.
  // Giveaway also skips validation: a captured king leaves later fens without one, like Fog of War.
  const usesPseudoLegalMoves = fogOfWar || giveaway || duckChess;
  // Spell Chess: a king captured via Jump leaves a FEN missing a king, same as Duck Chess/Fog of
  // War/Giveaway — see ChessEngine's own doc comment on skipValidation. Ordinary moves otherwise
  // still go through chess.js's own strict legality (see moveSpellChess), unaffected by this.
  const needsSkipValidation = usesPseudoLegalMoves || spellChess;
  // Duck Chess: while the duck is being placed the board shows the position AFTER the just-made move (which
  // the caller has not been told about yet — see pendingDuck below); otherwise it is simply `fen`.
  const [pendingDuck, setPendingDuck] = useState<{ move: Move; fen: string } | null>(null);
  const shownFen = pendingDuck ? pendingDuck.fen : fen;

  // Spell Chess only (see spellChess.ts and the `spellChess`/`spellState` prop doc comments above):
  // a turn here is "optionally cast a spell, THEN make a move", assembled entirely within this
  // component the same way Duck Chess assembles "move, then place the duck" via pendingDuck above —
  // `castMode` is "the player just tapped Freeze/Jump and is now picking a target square" (an active
  // UI mode, nothing committed yet); `pendingCast` is "a target has been picked" (committed to this
  // turn, but NOT yet to game state — no charge is spent until the move itself actually lands, see
  // handleSquarePress/finishRegularMove). Both reset whenever `fen` changes (a move actually landed,
  // the game was reset, Undo, etc.) via the same effect pendingDuck/selectedSquare already use.
  const [castMode, setCastMode] = useState<'freeze' | 'jump' | null>(null);
  const [pendingCast, setPendingCast] = useState<SpellCast | null>(null);
  // The 3x3 zone a committed Freeze cast would cover — only ever read for a `pendingCast` of that
  // type, computed once here rather than at each of its few call sites below.
  const pendingFreezeZone = pendingCast?.type === 'freeze' ? pendingCast.squares : null;
  // Squares immobilized for the CURRENT mover this ply (the opponent's Freeze cast last turn) — see
  // ChessEngineOptions.spellChess. Never affected by what the mover themselves is casting THIS turn
  // (Freeze only ever restricts the opponent's NEXT move, never the caster's own current one).
  const spellFrozenSquares = spellChess && spellState ? frozenSquaresFor(spellState, turnFromFen(shownFen)) : NO_FROZEN_SQUARES;
  // The square currently "jumpable" for this move: whatever the mover is casting Jump on RIGHT NOW
  // takes effect immediately for their own upcoming move (see spellChess.ts's own doc comment on
  // Jump's timing); otherwise whatever is still active from state (an opponent's Jump cast last turn,
  // still live for this one reply — see spellChess.activeJumpSquare).
  const spellJumpSquare = !spellChess ? null : pendingCast?.type === 'jump' ? pendingCast.square : spellState ? activeJumpSquare(spellState) : null;
  // True only when the mover is in check right now AND the Freeze zone they are actively casting (not
  // one carried over from state — see spellChess.checkIsWaivedByFreeze) covers every checking piece.
  // Computed from a throwaway engine on the pre-cast position (cheap, and this is already recomputed
  // on every render regardless) rather than threading the real `engine` through before it exists.
  const spellFreezeEscapeActive =
    spellChess && pendingFreezeZone
      ? checkIsWaivedByFreeze(new ChessEngine(shownFen, { skipValidation: true }), turnFromFen(shownFen), pendingFreezeZone)
      : false;

  const engine = useMemo(
    () =>
      new ChessEngine(shownFen, {
        chess960,
        initialFen,
        skipValidation: needsSkipValidation,
        giveaway,
        atomic,
        duckChess,
        duckSquare,
        spellChess,
        frozenSquares: spellFrozenSquares,
        jumpSquare: spellJumpSquare,
        freezeEscapeActive: spellFreezeEscapeActive,
      }),
    [shownFen, chess960, initialFen, needsSkipValidation, giveaway, atomic, duckChess, duckSquare, spellChess, spellFrozenSquares, spellJumpSquare, spellFreezeEscapeActive]
  );
  const board = useMemo(() => engine.getBoard(), [engine]);
  // Reversing both axes together preserves each square's light/dark identity (a 180° rotation
  // keeps checkerboard parity), so the same `(rowIndex + colIndex) % 2` coloring below still
  // works unchanged for either orientation — only the render order (and thus what's "at the
  // bottom") changes; square-id-based logic (selection, legal moves, clicks) is unaffected.
  const displayRows = useMemo(
    () => (orientation === 'b' ? [...board].reverse().map((row) => [...row].reverse()) : board),
    [board, orientation]
  );
  const turn = engine.getTurn();
  // Fog of War has no checkmate/stalemate concept at all, and chess.js's own isGameOver() can
  // still (correctly, but irrelevantly) report one once a position reaches such a pattern via
  // movePseudoLegal — the caller alone decides when a Fog of War game ends (king capture), via
  // the `disabled` prop, so this never gates input itself in that mode.
  const gameOver = usesPseudoLegalMoves ? false : engine.isGameOver();
  const status = engine.getStatus();

  // Reuses the same check/checkmate detection already driving status text and game-end logic
  // elsewhere (ChessEngine.getStatus(), itself chess.js's own isCheck()/isCheckmate()) rather
  // than a second detector — isCheck()/isCheckmate() are always about the side TO MOVE, so this
  // naturally covers "my king" or "the opponent's king" depending on whose turn it now is, in
  // every mode (including Chess960, since it's derived from the same board/turn everything else
  // already uses). Checkmate intentionally keeps this highlighted (status stays 'checkmate'),
  // same as check. Never highlighted in Fog of War — check isn't announced there at all.
  const checkedKingSquare = useMemo(() => {
    if (usesPseudoLegalMoves || (status !== 'check' && status !== 'checkmate')) return null;
    for (const row of board) {
      for (const square of row) {
        if (square.piece?.type === 'k' && square.piece.color === turn) return square.square;
      }
    }
    return null;
  }, [board, turn, status, usesPseudoLegalMoves]);

  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);

  // A human move that promotes a pawn is frozen here until they pick the piece — see
  // handleSquarePress/completePromotion. `kind` records whether it resolves into a real move or a
  // queued premove once chosen.
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string; color: PieceColor; kind: 'move' | 'premove' } | null>(null);

  useEffect(() => {
    setSelectedSquare(null);
    setPendingPromotion(null);
    setPendingDuck(null);
    setCastMode(null);
    setPendingCast(null);
  }, [fen]);

  // Lets the screen show "place the duck" while a turn is half-made.
  const placingDuck = pendingDuck !== null;
  useEffect(() => {
    onDuckPlacementChange?.(placingDuck);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placingDuck]);
  // The previewed move is already on the board when the turn is committed, so its slide animation is skipped.
  const skipAnimationRef = useRef(false);

  // Arrows/highlights (see BoardAnnotations) — always reset on a real position change (a move
  // played, a rewind/forward through history, a "New Game"), same as selectedSquare above.
  const [arrows, setArrows] = useState<BoardArrow[]>([]);
  const [highlights, setHighlights] = useState<GridPoint[]>([]);
  const [liveArrow, setLiveArrow] = useState<{ from: GridPoint; toX: number; toY: number } | null>(null);

  useEffect(() => {
    setArrows([]);
    setHighlights([]);
    setLiveArrow(null);
  }, [fen]);

  // Slide animation: a moving piece "sprite" overlaid on top of the static grid, translated from
  // the origin square's pixel position to the destination's over ANIMATION_DURATION_MS. The
  // destination square's own (already-updated) piece is hidden for the duration so it doesn't
  // just appear there instantly underneath the incoming sprite (see `hidePiece` below).
  const animatedOffset = useRef(new Animated.ValueXY()).current;
  const [slidingMove, setSlidingMove] = useState<{ to: string; piece: PieceModel } | null>(null);
  const prevFenRef = useRef(fen);

  // Atomic explosion overlay (see the animation effect below): the pieces a capture just removed, one
  // per square (a later entry wins a shared square), shown fading out under a flash.
  const explosionProgress = useRef(new Animated.Value(0)).current;
  const explosionRunRef = useRef(0);
  const [explosion, setExplosion] = useState<ExplodedPiece[] | null>(null);

  useEffect(() => {
    const prevFen = prevFenRef.current;
    prevFenRef.current = fen;
    if (skipAnimationRef.current) {
      skipAnimationRef.current = false;
      return;
    }
    if (!lastMove || prevFen === fen) return;

    // Fog of War: the sliding sprite below is a separate overlay rendered on top of the whole
    // grid, entirely outside Square's own fog check — animating it for a move whose squares
    // aren't in the viewer's own current visibility would show the piece moving in full view for
    // the animation's duration, then hide it, a flash leak of exactly the information this mode
    // exists to hide. Skipping the animation outright and letting the static (correctly fogged)
    // board render directly is what actually prevents that — not narrowing the sprite's own
    // visuals, since by the time any narrowing could apply the leak has already happened.
    if (visibleSquares && (!visibleSquares.has(lastMove.from) || !visibleSquares.has(lastMove.to))) return;

    // Only animate when the position just before this one actually had the mover's piece
    // sitting on `lastMove.from` — i.e. this really is one forward step from what was just on
    // screen, not e.g. a jump to an arbitrary position while scrubbing move history. A relatively
    // cheap, self-verifying check rather than threading a separate "did a live move just happen"
    // flag through every caller.
    let movingPiece: PieceModel | null = null;
    try {
      movingPiece = new ChessEngine(prevFen, { chess960, initialFen, skipValidation: needsSkipValidation, giveaway, atomic, duckChess }).getPieceAt(lastMove.from);
    } catch {
      movingPiece = null;
    }
    if (!movingPiece) return;

    const from = squareToRowCol(lastMove.from, orientation);
    const to = squareToRowCol(lastMove.to, orientation);
    animatedOffset.setValue({ x: from.col * squareSize, y: from.row * squareSize });
    setSlidingMove({ to: lastMove.to, piece: movingPiece });

    Animated.timing(animatedOffset, {
      toValue: { x: to.col * squareSize, y: to.row * squareSize },
      duration: ANIMATION_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      // The web Animated implementation doesn't support the native driver at all — this only
      // ever runs the JS-driven timing loop there regardless, but passing true anyway causes it
      // to log a dev warning on every single move.
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => setSlidingMove(null));

    // Atomic: once the capturing piece has landed, flash the blast and fade out what it destroyed.
    // Purely visual — the board underneath already shows the post-explosion position.
    if (lastMove.exploded && lastMove.exploded.length > 0) {
      const run = ++explosionRunRef.current;
      explosionProgress.stopAnimation();
      explosionProgress.setValue(0);
      setExplosion(lastMove.exploded);
      Animated.sequence([
        Animated.delay(ANIMATION_DURATION_MS),
        Animated.timing(explosionProgress, {
          toValue: 1,
          duration: EXPLOSION_DURATION_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]).start(() => {
        if (explosionRunRef.current === run) setExplosion(null);
      });
    }
    // Only `fen` actually needs to retrigger this — lastMove/chess960/initialFen/orientation/
    // squareSize are all read fresh from the closure at the moment `fen` changes, which is
    // exactly when they're relevant (the move that produced this new fen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen]);

  // Premove mode: true only while it's genuinely NOT premoveColor's turn — once it becomes their
  // turn, this is exactly normal play again (the caller is expected to have already applied/
  // cancelled any pending premove by then, see OnlineGameScreen/BotGameScreen).
  const isPremoveMode = premoveColor !== undefined && premoveColor !== turn;
  const selectableColor = isPremoveMode ? premoveColor : turn;
  // Fog of War: pseudo-legal targets (see ChessBoard's own fogOfWar doc comment) instead of
  // king-safety-filtered legal ones — getPseudoLegalMoves already generates for `selectableColor`
  // regardless of whose turn it actually is, which is also what makes this correct in premove mode.
  // Giveaway: the same pseudo-legal primitive, collapsed to mandatory captures when any exist.
  // Duck Chess: while the duck is being placed the "targets" are the squares it may go to instead.
  const duckTargets = pendingDuck ? getLegalDuckPlacementSquares(engine, duckSquare) : [];
  const legalTargets = pendingDuck
    ? duckTargets
    : selectedSquare && !isPremoveMode
      ? giveaway
        ? getGiveawayMoves(engine, selectedSquare).map((m) => m.to)
        : fogOfWar || duckChess
        ? engine
            .getPseudoLegalMoves(selectableColor)
            .filter((m) => m.from === selectedSquare)
            .map((m) => m.to)
        : engine.getLegalMoves(selectedSquare)
      : [];

  /** Applies a human move on a SCRATCH engine (never the memoized one — see handleSquarePress) and
   * returns the resulting move + fen, or null if the position doesn't allow it. In Giveaway the
   * attempted move is first checked against getGiveawayMoves: unlike Fog of War, not every
   * pseudo-legal move is legal there (mandatory capture can rule it out), so movePseudoLegal alone
   * would be too permissive a gate. */
  const tryMove = (from: string, to: string, promotion?: Move['promotion']): { move: Move; fen: string } | null => {
    const moveEngine = new ChessEngine(fen, {
      chess960,
      initialFen,
      skipValidation: needsSkipValidation,
      giveaway,
      atomic,
      duckChess,
      duckSquare,
      spellChess,
      frozenSquares: spellFrozenSquares,
      jumpSquare: spellJumpSquare,
      freezeEscapeActive: spellFreezeEscapeActive,
    });
    if (giveaway && !getGiveawayMoves(moveEngine, from).some((m) => m.to === to && m.promotion === promotion)) return null;
    const move = usesPseudoLegalMoves ? moveEngine.movePseudoLegal(from, to, promotion) : moveEngine.move(from, to, promotion);
    return move ? { move, fen: moveEngine.getFen() } : null;
  };

  /** Duck Chess: a regular move was just made — a king capture ends the game (no placement), anything else
   * freezes the turn until the duck is put somewhere (see handleDuckPlacementPress). Spell Chess: whatever
   * was committed to `pendingCast` this turn (if anything) rides along on `move.spell` — nothing is told
   * to the caller about a cast until the move it preceded actually lands (see the `spellChess`/`spellState`
   * prop doc comment above), mirroring how Duck Chess's own `duck` field is attached, just the other way
   * round in turn order. */
  const finishRegularMove = (result: { move: Move; fen: string }) => {
    setSelectedSquare(null);
    const move = spellChess && pendingCast ? { ...result.move, spell: pendingCast } : result.move;
    setCastMode(null);
    setPendingCast(null);
    if (duckChess && move.captured !== 'k') {
      setPendingDuck({ move, fen: result.fen });
      return;
    }
    onMove(move, result.fen);
  };

  const handleDuckPlacementPress = (square: string) => {
    if (!pendingDuck) return;
    if (square === pendingDuck.move.to) {
      setPendingDuck(null); // the player took the move back
      return;
    }
    if (!duckTargets.includes(square)) return;
    const committed: Move = { ...pendingDuck.move, duck: square };
    skipAnimationRef.current = true;
    setPendingDuck(null);
    onMove(committed, pendingDuck.fen);
  };

  const selectOwnPiece = (square: string) => {
    const squareData = board.flat().find((s) => s.square === square);
    if (squareData?.piece && squareData.piece.color === selectableColor) {
      setSelectedSquare(square);
    } else {
      setSelectedSquare(null);
    }
  };

  const handleSquarePress = (square: string) => {
    if (disabled || gameOver || pendingPromotion) return;

    // Spell Chess: while picking a target for Freeze/Jump (see the spell bar below), a tap commits
    // that target to `pendingCast` instead of going anywhere near normal piece selection/movement —
    // Freeze accepts any square as its 3x3 center; Jump only an occupied one (an empty target just
    // has nothing to jump over, so the tap is ignored rather than committing a no-op cast).
    if (castMode) {
      if (castMode === 'freeze') {
        setPendingCast({ type: 'freeze', center: square, squares: getFreezeZoneSquares(square) });
        setCastMode(null);
      } else if (engine.getPieceAt(square)) {
        setPendingCast({ type: 'jump', square });
        setCastMode(null);
      }
      return;
    }

    if (pendingDuck) {
      handleDuckPlacementPress(square);
      return;
    }

    if (!selectedSquare) {
      selectOwnPiece(square);
      return;
    }

    if (selectedSquare === square) {
      setSelectedSquare(null);
      return;
    }

    if (isPremoveMode) {
      const squareData = board.flat().find((s) => s.square === square);
      if (squareData?.piece && squareData.piece.color === selectableColor) {
        setSelectedSquare(square); // reselect a different piece to premove instead
        return;
      }
      const premovingPiece = board.flat().find((s) => s.square === selectedSquare)?.piece;
      if (premovingPiece && isPromotionMove(premovingPiece, square)) {
        setPendingPromotion({ from: selectedSquare, to: square, color: premovingPiece.color, kind: 'premove' });
        return;
      }
      onPremove?.({ from: selectedSquare, to: square });
      setSelectedSquare(null);
      return;
    }

    if (legalTargets.includes(square)) {
      // A pawn reaching its last rank — by a plain push or a capture alike — is never completed
      // automatically: the move is held until the player picks the promotion piece.
      const movingPiece = board.flat().find((s) => s.square === selectedSquare)?.piece;
      // Atomic: a promoting CAPTURE explodes the new piece with the capturer, so every choice gives the
      // same board — skip the picker and promote to a queen. Quiet promotions still ask.
      let autoPromotion: Move['promotion'];
      if (movingPiece && isPromotionMove(movingPiece, square)) {
        if (atomic && board.flat().some((s) => s.square === square && s.piece !== null)) {
          autoPromotion = 'q';
        } else {
          setPendingPromotion({ from: selectedSquare, to: square, color: movingPiece.color, kind: 'move' });
          return;
        }
      }

      // A scratch engine, NOT the memoized `engine` above — ChessEngine.move()/movePseudoLegal()
      // mutate chess.js's internal board state in place rather than returning a new instance. If
      // this called them on the memoized `engine`, it would silently fall out of sync with its
      // own useMemo cache key (still `fen`, the OLD position) the instant the move is applied —
      // for the whole window between now and the parent's re-render with the new `fen` prop (an
      // async setState), any OTHER render triggered in between (a different piece of state
      // changing) would reuse the memoized-but-now-mutated `engine` instead of recomputing it,
      // reading the NEW position's data while every other derived value on this render still
      // reflects the OLD `fen`. A disposable engine built from the same fen/options keeps the
      // memoized one untouched until the parent legitimately updates `fen`.
      const result = tryMove(selectedSquare, square, autoPromotion);
      if (result) {
        finishRegularMove(result);
        return;
      }
    }

    selectOwnPiece(square);
  };

  // Tap outside the board deselects, same as tapping inside it on an empty/unrelated square does.
  // The board's own PanResponder can only ever see touches that land on the board itself, so this
  // listens to the app-wide touch signal instead (see screenTouches.ts / App.tsx). Only subscribed
  // while something is actually selected, and skipped while the promotion picker is up (that has its
  // own full-screen cancel). The touch is NOT consumed — a tap on Resign/Hint/Undo etc. still does
  // its own job as well; this just also clears the selection.
  useEffect(() => {
    if (!selectedSquare || pendingPromotion) return;
    return subscribeToScreenTouches((pageX, pageY) => {
      boardContainerRef.current?.measure((_x, _y, width, height, boardPageX, boardPageY) => {
        if (!isTouchInside(pageX, pageY, { x: boardPageX, y: boardPageY, width, height })) {
          setSelectedSquare(null);
        }
      });
    });
  }, [selectedSquare, pendingPromotion]);

  // Cancelling also deselects the pawn, so the player is back to a clean "nothing selected" state.
  const cancelPromotion = () => {
    setPendingPromotion(null);
    setSelectedSquare(null);
  };

  const completePromotion = (piece: PromotionPiece) => {
    if (!pendingPromotion) return;
    const { from, to, kind } = pendingPromotion;
    setPendingPromotion(null);
    if (kind === 'premove') {
      onPremove?.({ from, to, promotion: piece });
      setSelectedSquare(null);
      return;
    }
    // A scratch engine, never the memoized one — see handleSquarePress's own explanation above.
    const result = tryMove(from, to, piece);
    if (result) finishRegularMove(result);
  };

  // --- Unified touch handling for the whole grid: a quick tap behaves exactly like the old
  // per-square Pressable.onPress did (see handleSquarePress above); a long-press-and-drag draws
  // an arrow (or, released back on the same square, toggles a highlight there) when
  // `enableAnnotations` is on. One PanResponder on the board container (rather than a Pressable
  // per square) is what makes it possible to track the finger continuously after the long-press
  // fires, which Pressable's onPress/onLongPress alone can't do.
  //
  // Positions are computed from `nativeEvent.pageX/pageY` (always relative to the app root) minus
  // this board's own measured on-screen offset — NOT from `locationX/locationY`, which turned out
  // to be relative to whichever of the 64 Square children the touch actually hit (a real, if
  // poorly documented, React Native behavior for a responder with overlapping/nested children),
  // not to this responder view itself. That made every tap resolve to a position within a single
  // ~squareSize-sized child instead of across the whole board, which — since squareSize divides
  // squareSize to a value under 1 — collapsed almost every tap to row/col (0, 0) regardless of
  // where the board was actually touched. This is what made tap-to-select appear completely dead.
  const gestureRef = useRef<{
    startSquare: string;
    longPressTimer: ReturnType<typeof setTimeout> | null;
    armed: boolean;
  } | null>(null);
  const boardContainerRef = useRef<View>(null);
  const boardOffsetRef = useRef({ x: 0, y: 0 });
  // The most recent not-yet-resolved remeasureBoardOffset() call, if any — see that function's
  // own doc comment for why onPanResponderRelease needs to be able to wait on this instead of
  // always trusting boardOffsetRef.current, which can be stale mid-flight.
  const pendingMeasureRef = useRef<Promise<{ x: number; y: number }> | null>(null);

  // .measure() is an async round-trip (a real native-bridge round-trip on iOS/Android; still
  // genuinely async on web), so caching its result and reading boardOffsetRef.current elsewhere
  // was a race: if something above the board changes height (e.g. the move-list strip appearing
  // after the first move, or the status line wrapping to a second line for "— Check!") and a tap
  // lands before THIS remeasurement resolves, the release handler would use the board's OLD
  // on-screen position — off by roughly whatever it shifted, silently resolving the tap to the
  // wrong square (confirmed directly: a tap on a square whose piece had legal-move dots showing
  // moments earlier failed to complete a move at all). Calling this at the start of every gesture
  // (not just on layout changes) isn't enough on its own, since "fires before release" was an
  // assumption, not a guarantee, for a fast tap. This now returns the in-flight Promise (tracked
  // in pendingMeasureRef) so onPanResponderRelease can actually wait for a fresh measurement
  // instead of hoping one already landed.
  const remeasureBoardOffset = (): Promise<{ x: number; y: number }> => {
    const node = boardContainerRef.current;
    if (!node) return Promise.resolve(boardOffsetRef.current);
    const promise = new Promise<{ x: number; y: number }>((resolve) => {
      node.measure((_x, _y, _width, _height, pageX, pageY) => {
        const offset = { x: pageX, y: pageY };
        boardOffsetRef.current = offset;
        resolve(offset);
      });
    });
    pendingMeasureRef.current = promise;
    promise.finally(() => {
      // Only clear if nothing newer has started in the meantime (a slower, older measurement
      // resolving after a fresher one must not stomp on the fresher one's own pending-ness).
      if (pendingMeasureRef.current === promise) pendingMeasureRef.current = null;
    });
    return promise;
  };

  const pixelToGrid = (localX: number, localY: number): GridPoint => ({
    row: Math.min(7, Math.max(0, Math.floor(localY / squareSize))),
    col: Math.min(7, Math.max(0, Math.floor(localX / squareSize))),
  });

  const toBoardLocal = (pageX: number, pageY: number) => ({
    x: pageX - boardOffsetRef.current.x,
    y: pageY - boardOffsetRef.current.y,
  });

  const clearGesture = () => {
    if (gestureRef.current?.longPressTimer) clearTimeout(gestureRef.current.longPressTimer);
    gestureRef.current = null;
    setLiveArrow(null);
  };

  // Deliberately NOT memoized (e.g. via useRef/useMemo) — PanResponder.create() is cheap, and its
  // handlers below close over this render's handleSquarePress/orientation/enableAnnotations/
  // squareSize. Freezing it into a ref on first mount (a common pattern elsewhere) would pin every
  // handler to that first render's values forever, silently breaking moves/orientation on every
  // render after the very first one.
  const panResponder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Without this, the board — once it claims a gesture on touch-down — never lets go for the
      // rest of that gesture, even for a vertical drag that was clearly meant to scroll the
      // surrounding screen (see GameScreenBody). A plain tap never triggers this at all (it never
      // moves enough for anything to request termination); a genuinely armed long-press-drawn
      // arrow refuses to be interrupted mid-draw. Everything else — most of all, an ordinary
      // scroll swipe that happens to start over the board — hands off to whichever ancestor
      // ScrollView asks for it.
      onPanResponderTerminationRequest: () => !gestureRef.current?.armed,
      onPanResponderGrant: (evt) => {
        // Fired here (in addition to onLayout) so this gesture's own later events — chiefly
        // onPanResponderRelease, where a tap actually resolves to a square — use a freshly
        // re-measured offset instead of a possibly-stale one (see remeasureBoardOffset).
        remeasureBoardOffset();
        const { x: localX, y: localY } = toBoardLocal(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
        const { row, col } = pixelToGrid(localX, localY);
        const startSquare = rowColToSquare(row, col, orientation);

        // Arming here only ever means "a live arrow/highlight preview may start showing if the
        // finger goes on to actually drag" — it no longer decides tap-vs-annotation by itself
        // (see onPanResponderRelease's own doc comment: that decision is distance-based now, not
        // time-based), so there's no need to suppress it just because a piece happens to be
        // selected — a genuine drag should still draw an arrow regardless.
        const timer = enableAnnotations
          ? setTimeout(() => {
              if (!gestureRef.current) return;
              gestureRef.current.armed = true;
              setLiveArrow({ from: { row, col }, toX: localX, toY: localY });
            }, LONG_PRESS_MS)
          : null;
        gestureRef.current = { startSquare, longPressTimer: timer, armed: false };
      },
      onPanResponderMove: (_evt, gestureState) => {
        const state = gestureRef.current;
        if (!state) return;

        if (!state.armed) {
          // Moved too far before the long-press timer fired — this is a fast drag/swipe, not a
          // held annotation gesture, so cancel the pending timer (it simply won't arm).
          if (Math.hypot(gestureState.dx, gestureState.dy) > MOVE_THRESHOLD_PX && state.longPressTimer) {
            clearTimeout(state.longPressTimer);
            state.longPressTimer = null;
          }
          return;
        }

        const startGrid = squareToRowCol(state.startSquare, orientation);
        const { x: localX, y: localY } = toBoardLocal(gestureState.moveX, gestureState.moveY);
        setLiveArrow({ from: startGrid, toX: localX, toY: localY });
      },
      onPanResponderRelease: (evt, gestureState) => {
        const state = gestureRef.current;
        if (!state) return;

        // moveX/moveY isn't updated until the first move event fires — for a gesture that never
        // moved at all (the common case for a plain tap), it's still 0, so fall back to the
        // release event's own pageX/pageY, which is always populated.
        const hasMoved = gestureState.moveX !== 0 || gestureState.moveY !== 0;
        const pageX = hasMoved ? gestureState.moveX : evt.nativeEvent.pageX;
        const pageY = hasMoved ? gestureState.moveY : evt.nativeEvent.pageY;
        // Captured now, before clearGesture() below — resolveRelease may run asynchronously
        // (waiting on a pending measurement), by which point gestureRef.current would already be
        // cleared.
        const armed = state.armed;
        const startSquare = state.startSquare;
        const dx = gestureState.dx;
        const dy = gestureState.dy;

        const resolveRelease = (offset: { x: number; y: number }, viaFreshMeasurement: boolean) => {
          const localX = pageX - offset.x;
          const localY = pageY - offset.y;
          const { row, col } = pixelToGrid(localX, localY);
          const resolvedSquare = rowColToSquare(row, col, orientation);

          if (__DEV__) {
            // Defensive diagnostic — if a tap ever resolves to the wrong square again, this is
            // the first thing to check: was a fresh measurement actually awaited, and does the
            // offset used look like the board's real on-screen position. Console-only (not
            // logDiagnostic): this fires on every single tap, far more often than this app's
            // other diagnostic events, and would otherwise cycle the shared 100-entry ring buffer
            // out within a handful of moves — a build that actually needs this (not just dev) can
            // still get it from a cable + adb logcat, same as before this session.
            console.log(
              `[ChessBoard] tap -> ${resolvedSquare} | page=(${pageX.toFixed(1)},${pageY.toFixed(1)}) ` +
                `offset=(${offset.x.toFixed(1)},${offset.y.toFixed(1)}) ` +
                `${viaFreshMeasurement ? '[awaited a fresh measurement]' : '[used cached offset]'}`
            );
          }

          // Root-cause fix: whether this was a genuinely STATIONARY release (finger never moved
          // past MOVE_THRESHOLD_PX) decides everything — NOT whether the long-press timer
          // happened to already fire (see onPanResponderGrant's 400ms timer above). The previous
          // version branched on `armed` first, so an entirely ordinary tap that simply took
          // >=LONG_PRESS_MS to release (easy mid-move-selection, or just hesitating over which
          // piece to pick) got silently reinterpreted as an annotation gesture instead of calling
          // handleSquarePress at all — no error, nothing in the diagnostic log above either,
          // since that only ever records the resolved square, never whether it actually reached
          // handleSquarePress. A real annotation drag always involves genuine movement past the
          // threshold; a stationary release never does, regardless of how long it was held — so
          // checking distance first, unconditionally, closes the whole timing-dependent bug
          // class rather than the specific places it was spotted.
          const isStationary = Math.hypot(dx, dy) <= MOVE_THRESHOLD_PX;
          if (isStationary) {
            handleSquarePress(resolvedSquare);
          } else if (armed) {
            const startGrid = squareToRowCol(startSquare, orientation);
            if (resolvedSquare === startSquare) {
              setHighlights((prev) =>
                prev.some((p) => p.row === startGrid.row && p.col === startGrid.col)
                  ? prev.filter((p) => !(p.row === startGrid.row && p.col === startGrid.col))
                  : [...prev, startGrid]
              );
            } else {
              setArrows((prev) => [...prev, { from: startGrid, to: { row, col } }]);
            }
          }
          // else: moved past the tap threshold without ever arming — an aborted drag/scroll
          // attempt (enableAnnotations off, or it moved too fast to arm), not a tap or an
          // annotation. Deliberately does nothing rather than acting on whatever square it
          // happened to end on.
        };

        // The crux of the fix: if a remeasure triggered at gesture-grant (or by a layout shift
        // just before it) hasn't resolved yet, WAIT for it instead of resolving this tap against
        // a boardOffsetRef that might still reflect the board's position before that shift.
        if (pendingMeasureRef.current) {
          pendingMeasureRef.current.then((offset) => resolveRelease(offset, true));
        } else {
          resolveRelease(boardOffsetRef.current, false);
        }
        clearGesture();
      },
      onPanResponderTerminate: clearGesture,
  });

  // Atomic explosion overlay values (see the animation effect): one cell per square the blast cleared.
  const explosionCells = explosion ? [...new Map(explosion.map((e) => [e.square, e])).values()] : [];
  const flashOpacity = explosionProgress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.9, 0] });
  const flashScale = explosionProgress.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.6] });
  const ghostOpacity = explosionProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <>
      <View style={styles.border}>
        <View
          ref={boardContainerRef}
          onLayout={remeasureBoardOffset}
          style={[styles.board, { width: boardSize, height: boardSize }]}
          {...panResponder.panHandlers}
        >
        {displayRows.map((row, rowIndex) =>
          row.map((square, colIndex) => (
            <Square
              key={square.square || `${rowIndex}-${colIndex}`}
              data={square}
              isLight={(rowIndex + colIndex) % 2 === 0}
              isSelected={square.square === selectedSquare}
              isLegalTarget={legalTargets.includes(square.square)}
              isChecked={square.square === checkedKingSquare}
              isLastMove={square.square === lastMove?.from || square.square === lastMove?.to}
              isKingOfTheHillTarget={kingOfTheHill && KING_OF_THE_HILL_SQUARES.includes(square.square)}
              hidePiece={slidingMove !== null && square.square === slidingMove.to}
              isFogged={visibleSquares !== undefined && !visibleSquares.has(square.square)}
              isDuck={duckChess && square.square === duckSquare}
              isFrozen={spellChess && spellFrozenSquares.includes(square.square)}
              isPendingFreeze={spellChess && pendingFreezeZone !== null && pendingFreezeZone.includes(square.square)}
              isJumpSquare={spellChess && square.square === spellJumpSquare}
              size={squareSize}
              lightColor={boardTheme.lightColor}
              darkColor={boardTheme.darkColor}
              pieceImages={pieceTheme.images}
            />
          ))
        )}

        {enableAnnotations && (
          <BoardAnnotations squareSize={squareSize} arrows={arrows} highlights={highlights} liveArrow={liveArrow} />
        )}

        {explosionCells.map(({ square, piece }) => {
          const { row, col } = squareToRowCol(square, orientation);
          return (
            <Animated.View
              key={`explosion-${square}`}
              pointerEvents="none"
              style={[styles.explosionCell, { left: col * squareSize, top: row * squareSize, width: squareSize, height: squareSize }]}
            >
              <Animated.View
                style={[
                  styles.explosionFlash,
                  {
                    width: squareSize * 0.9,
                    height: squareSize * 0.9,
                    borderRadius: squareSize * 0.45,
                    opacity: flashOpacity,
                    transform: [{ scale: flashScale }],
                  },
                ]}
              />
              <Animated.View style={[styles.explosionGhost, { opacity: ghostOpacity }]}>
                <Piece piece={piece} images={pieceTheme.images} />
              </Animated.View>
            </Animated.View>
          );
        })}

        {slidingMove && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.slidingPiece,
              {
                width: squareSize,
                height: squareSize,
                transform: [{ translateX: animatedOffset.x }, { translateY: animatedOffset.y }],
              },
            ]}
          >
            <Piece piece={slidingMove.piece} images={pieceTheme.images} />
          </Animated.View>
        )}
      </View>
      </View>

      {/* Spell Chess only — "cast, then move": tap Freeze/Jump to enter castMode and pick a target
          (see handleSquarePress's own castMode branch above), or tap the pending-cast chip to back
          out of a cast already committed this turn (before the move that would spend it lands —
          see finishRegularMove). Charges shown are the side TO MOVE's own (`turn`, not a fixed
          color), since only they may cast right now. Disabled whenever input generally is
          (disabled/gameOver), and the OTHER spell button is disabled once one is mid-pick so only
          one spell is ever in flight, matching the "at most one spell per own turn" rule. */}
      {spellChess && spellState && (
        <View style={styles.spellBar}>
          <Pressable
            disabled={disabled || gameOver || pendingCast !== null || !canCastFreeze(spellState, turn) || castMode === 'jump'}
            onPress={() => setCastMode(castMode === 'freeze' ? null : 'freeze')}
            style={[
              styles.spellButton,
              castMode === 'freeze' && styles.spellButtonActive,
              (disabled || gameOver || pendingCast !== null || !canCastFreeze(spellState, turn) || castMode === 'jump') && styles.spellButtonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Cast Freeze, ${spellState[turn].charges.freeze} remaining`}
          >
            <Text style={styles.spellButtonText}>❄️ Freeze ({spellState[turn].charges.freeze})</Text>
          </Pressable>
          <Pressable
            disabled={disabled || gameOver || pendingCast !== null || !canCastJump(spellState, turn) || castMode === 'freeze'}
            onPress={() => setCastMode(castMode === 'jump' ? null : 'jump')}
            style={[
              styles.spellButton,
              castMode === 'jump' && styles.spellButtonActive,
              (disabled || gameOver || pendingCast !== null || !canCastJump(spellState, turn) || castMode === 'freeze') && styles.spellButtonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Cast Jump, ${spellState[turn].charges.jump} remaining`}
          >
            <Text style={styles.spellButtonText}>🌀 Jump ({spellState[turn].charges.jump})</Text>
          </Pressable>
          {castMode && (
            <Text style={styles.spellHint} numberOfLines={1}>
              {castMode === 'freeze' ? 'Tap the center square' : 'Tap a piece to jump over'}
            </Text>
          )}
          {pendingCast && (
            <Pressable onPress={() => setPendingCast(null)} style={styles.spellCancelButton} accessibilityRole="button" accessibilityLabel="Cancel pending spell cast">
              <Text style={styles.spellButtonText}>
                ✕ {pendingCast.type === 'freeze' ? `Freeze @ ${pendingCast.center}` : `Jump @ ${pendingCast.square}`}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* A real Modal, not an overlay inside the board: it covers the WHOLE screen, so a tap
          anywhere outside the four buttons — on the board or off it — lands on the backdrop and
          cancels. (An earlier absolutely-positioned overlay only covered the board's own bounds,
          so taps elsewhere on the screen never reached it.) Android's back button cancels too. */}
      <Modal
        visible={pendingPromotion !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={cancelPromotion}
      >
        <Pressable style={styles.promotionBackdrop} onPress={cancelPromotion} accessibilityLabel="Cancel promotion">
          <View style={styles.promotionPanel}>
            <Text style={styles.promotionTitle}>Promote to</Text>
            <View style={styles.promotionRow}>
              {getPromotionChoices(giveaway).map((choice) => (
                <Pressable
                  key={choice}
                  style={[styles.promotionButton, { width: squareSize * 1.15, height: squareSize * 1.15 }]}
                  onPress={() => completePromotion(choice)}
                  accessibilityRole="button"
                  accessibilityLabel={`Promote to ${PROMOTION_LABELS[choice]}`}
                >
                  <Piece piece={{ type: choice, color: pendingPromotion?.color ?? 'w' }} images={pieceTheme.images} />
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/** The Spell Chess Freeze/Jump row has a FIXED height and never wraps (the cast hint ellipsizes), so the layout around
 * the board is deterministic: GameScreenBody's compact spacing is sized against exactly this much extra chrome. */
const SPELL_BAR_MARGIN_TOP = 8;
const SPELL_BAR_HEIGHT = 32;

const styles = StyleSheet.create({
  promotionBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promotionPanel: {
    backgroundColor: '#f4ecd8',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 8,
  },
  promotionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3a2618',
  },
  promotionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  promotionButton: {
    backgroundColor: '#d9c8a3',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  border: {
    borderWidth: 2,
    borderColor: '#3a2618',
  },
  board: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    position: 'relative',
  },
  slidingPiece: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explosionCell: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  explosionFlash: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 140, 0, 0.85)',
  },
  explosionGhost: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Fixed height and no wrapping, so it can never grow to a second line and push the bottom player row out of the
  // non-scrolling GameScreenBody. The hint text shrinks/ellipsizes instead (spellHint).
  spellBar: {
    marginTop: SPELL_BAR_MARGIN_TOP,
    height: SPELL_BAR_HEIGHT,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 8,
  },
  spellButton: {
    backgroundColor: '#5c4a32',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  spellButtonActive: {
    backgroundColor: '#8a6d3b',
  },
  spellButtonDisabled: {
    opacity: 0.4,
  },
  spellCancelButton: {
    backgroundColor: '#7a2f2f',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  spellButtonText: {
    color: '#f4ecd8',
    fontSize: 13,
    fontWeight: '600',
  },
  spellHint: {
    flexShrink: 1,
    color: '#3a2618',
    fontSize: 12,
    fontStyle: 'italic',
  },
});

// Default (shallow) prop comparison is enough as long as every caller keeps fen/visibleSquares/
// lastMove/onMove/onPremove referentially stable across renders that don't actually change the
// position (see LocalGameScreen/BotGameScreen/OnlineGameScreen's memoized handleMove/
// handleQueuePremove) — without this, the once-a-second chess clock tick in those screens was
// forcing this whole board (64 Square children + piece images) to re-render from scratch on
// every tick regardless of whether the position had changed at all.
export default memo(ChessBoard);
