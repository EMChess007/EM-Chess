import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ChessEngine } from '../logic/ChessEngine';
import { getLegalDuckPlacementSquares } from '../logic/duckChess';
import { getGiveawayMoves } from '../logic/giveaway';
import { isTouchInside, subscribeToScreenTouches } from '../logic/screenTouches';
import { PROMOTION_LABELS, type PromotionPiece, getPromotionChoices, isPromotionMove } from '../logic/promotion';
import { useActiveBoardTheme, useActivePieceTheme } from '../logic/themeHooks';
import type { ExplodedPiece, Move, PieceColor, Piece as PieceModel } from '../types/chess';
import BoardAnnotations, { type BoardArrow, type GridPoint } from './BoardAnnotations';
import { getBoardSize } from './boardSize';
import PromotionPicker from './PromotionPicker';
import { useBoardGestures } from './useBoardGestures';
import { useClearAnnotationsOnMove } from './useClearAnnotationsOnMove';
import Piece from './Piece';
import Square from './Square';

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

const ANIMATION_DURATION_MS = 200;
// Atomic explosion flash/fade: starts when the sliding piece lands, then fades out over this long.
const EXPLOSION_DURATION_MS = 450;

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
  visibleSquares,
}: ChessBoardProps) {
  const { width, height } = useWindowDimensions();
  const boardSize = getBoardSize(width, height);
  const squareSize = boardSize / 8;
  const boardTheme = useActiveBoardTheme();
  const pieceTheme = useActivePieceTheme();

  // skipValidation: Online Fog of War's `fen` is server-redacted and can legitimately be missing
  // a king the viewer can't currently see — see ChessEngine's own doc comment on the option.
  // Giveaway also skips validation: a captured king leaves later fens without one, like Fog of War.
  const usesPseudoLegalMoves = fogOfWar || giveaway || duckChess;
  // Duck Chess: while the duck is being placed the board shows the position AFTER the just-made move (which
  // the caller has not been told about yet — see pendingDuck below); otherwise it is simply `fen`.
  const [pendingDuck, setPendingDuck] = useState<{ move: Move; fen: string } | null>(null);
  const shownFen = pendingDuck ? pendingDuck.fen : fen;
  const engine = useMemo(
    () => new ChessEngine(shownFen, { chess960, initialFen, skipValidation: usesPseudoLegalMoves, giveaway, atomic, duckChess, duckSquare }),
    [shownFen, chess960, initialFen, usesPseudoLegalMoves, giveaway, atomic, duckChess, duckSquare]
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
  }, [fen]);

  // Lets the screen show "place the duck" while a turn is half-made.
  const placingDuck = pendingDuck !== null;
  useEffect(() => {
    onDuckPlacementChange?.(placingDuck);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placingDuck]);
  // The previewed move is already on the board when the turn is committed, so its slide animation is skipped.
  const skipAnimationRef = useRef(false);

  // Arrows/highlights (see BoardAnnotations) — cleared when the position changes (a move played, a
  // rewind/forward through history, a "New Game"), and ONLY then: the shared invariant in
  // logic/annotationLifecycle.ts. Classic chess has no pass/skip, so the FEN is exactly that epoch.
  const [arrows, setArrows] = useState<BoardArrow[]>([]);
  const [highlights, setHighlights] = useState<GridPoint[]>([]);

  useClearAnnotationsOnMove(fen, () => {
    setArrows([]);
    setHighlights([]);
    clearLiveArrow();
  });

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
      movingPiece = new ChessEngine(prevFen, { chess960, initialFen, skipValidation: usesPseudoLegalMoves, giveaway, atomic, duckChess }).getPieceAt(lastMove.from);
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
    const moveEngine = new ChessEngine(fen, { chess960, initialFen, skipValidation: usesPseudoLegalMoves, giveaway, atomic, duckChess, duckSquare });
    if (giveaway && !getGiveawayMoves(moveEngine, from).some((m) => m.to === to && m.promotion === promotion)) return null;
    const move = usesPseudoLegalMoves ? moveEngine.movePseudoLegal(from, to, promotion) : moveEngine.move(from, to, promotion);
    return move ? { move, fen: moveEngine.getFen() } : null;
  };

  /** Duck Chess: a regular move was just made — a king capture ends the game (no placement), anything else
   * freezes the turn until the duck is put somewhere (see handleDuckPlacementPress). */
  const finishRegularMove = (result: { move: Move; fen: string }) => {
    setSelectedSquare(null);
    if (duckChess && result.move.captured !== 'k') {
      setPendingDuck(result);
      return;
    }
    onMove(result.move, result.fen);
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

  // --- Touch handling for the whole grid: a quick tap behaves exactly like a per-square press (see handleSquarePress above); a
  // long-press-and-drag draws an arrow (or, released back on the same square, toggles a highlight there) when `enableAnnotations` is
  // on. The mechanics (one PanResponder on the container, fresh offset measurement, tap-vs-drag by distance) are shared with the
  // 4 Player board and live in useBoardGestures; this board only says what a display cell MEANS (its own orientation mapping).
  const {
    containerRef: boardContainerRef,
    onLayout: onBoardLayout,
    panHandlers,
    liveArrow,
    clearLiveArrow,
  } = useBoardGestures({
    squareSize,
    rows: 8,
    cols: 8,
    enableAnnotations,
    onTap: ({ row, col }) => handleSquarePress(rowColToSquare(row, col, orientation)),
    onArrow: (from, to) => setArrows((prev) => [...prev, { from, to }]),
    onHighlight: (cell) =>
      setHighlights((prev) =>
        prev.some((p) => p.row === cell.row && p.col === cell.col) ? prev.filter((p) => !(p.row === cell.row && p.col === cell.col)) : [...prev, cell]
      ),
  });

  // Atomic explosion overlay values (see the animation effect): one cell per square the blast cleared.
  const explosionCells = explosion ? [...new Map(explosion.map((e) => [e.square, e])).values()] : [];
  const flashOpacity = explosionProgress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.9, 0] });
  const flashScale = explosionProgress.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.6] });
  const ghostOpacity = explosionProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <View style={styles.border}>
      <View
        ref={boardContainerRef}
        onLayout={onBoardLayout}
        style={[styles.board, { width: boardSize, height: boardSize }]}
        {...panHandlers}
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

      {/* The shared full-screen picker: a tap anywhere outside the four buttons cancels (see PromotionPicker). */}
      <PromotionPicker
        visible={pendingPromotion !== null}
        choices={getPromotionChoices(giveaway)}
        buttonSize={squareSize * 1.15}
        labelFor={(choice) => PROMOTION_LABELS[choice]}
        renderChoice={(choice) => <Piece piece={{ type: choice, color: pendingPromotion?.color ?? 'w' }} images={pieceTheme.images} />}
        onChoose={completePromotion}
        onCancel={cancelPromotion}
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
});

// Default (shallow) prop comparison is enough as long as every caller keeps fen/visibleSquares/
// lastMove/onMove/onPremove referentially stable across renders that don't actually change the
// position (see LocalGameScreen/BotGameScreen/OnlineGameScreen's memoized handleMove/
// handleQueuePremove) — without this, the once-a-second chess clock tick in those screens was
// forcing this whole board (64 Square children + piece images) to re-render from scratch on
// every tick regardless of whether the position had changed at all.
export default memo(ChessBoard);
