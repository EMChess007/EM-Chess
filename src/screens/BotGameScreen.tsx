import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSaveGameOnEnd } from '../api/useSaveGameOnEnd';
import { appAlert } from '../components/AppAlert';
import CapturedPieces from '../components/CapturedPieces';
import ChessBoard, { type PremoveIntent } from '../components/ChessBoard';
import GameControlBar from '../components/GameControlBar';
import GameOptionsMenu from '../components/GameOptionsMenu';
import GameScreenBody from '../components/GameScreenBody';
import MoveListStrip from '../components/MoveListStrip';
import PostGameSummaryModal from '../components/PostGameSummaryModal';
import ScreenHeader from '../components/ScreenHeader';
import { getEngineRuntime } from '../engine/engineRegistry';
import StockfishBridge, { type StockfishBridgeHandle } from '../engine/StockfishBridge';
import { unlockAchievement } from '../logic/achievementStorage';
import { chooseAtomicBotMove, chooseGiveawayBotMove, getBotThinkTimeMs } from '../logic/bots';
import { logDiagnostic } from '../logic/diagnosticLog';
import { generateChess960Position } from '../logic/chess960';
import { ChessEngine } from '../logic/ChessEngine';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { getBotStrengthOptions, getEngineIdForElo, getEngineName } from '../logic/engines';
import { buildGamePayload } from '../logic/gamePayload';
import { getGameOutcome } from '../logic/gameResult';
import { describeEndReason } from '../logic/gameOutcomeText';
import {
  getFogOfWarWinner,
  getVisibleSquares,
  logFogOfWarGameStart,
  logFogOfWarPly,
  useIncrementalFogRedaction,
} from '../logic/fogOfWar';
import { triggerGameEndHaptics, triggerMoveHaptics } from '../logic/haptics';
import { getAtomicWinner, isAtomicThreefoldRepetition } from '../logic/atomic';
import { getGiveawayMoves, getGiveawayWinner } from '../logic/giveaway';
import { getKingOfTheHillWinner } from '../logic/kingOfTheHill';
import { computeCapturedMaterial, materialValue } from '../logic/material';
import { playMoveSound } from '../logic/moveSounds';
import { lookupOpening } from '../logic/openings';
import { toRatingCategory } from '../logic/rating';
import { recordRatedGame } from '../logic/ratingStorage';
import { THREE_CHECK_TARGET, getThreeCheckCounts, getThreeCheckWinner } from '../logic/threeCheck';
import { formatTime } from '../logic/time';
import { parseUciMove, uciMoveToSan } from '../logic/uciMove';
import { useChessClock } from '../logic/useChessClock';
import { START_FEN } from '../types/chess';
import type { ColorChoice, Move, PieceColor } from '../types/chess';
import type { BotPersonality } from '../types/bot';
import type { AnalyzeParams, GameHistoryEntry } from '../types/history';
import type { TimeControl } from '../types/timeControl';

interface BotGameScreenProps {
  bot: BotPersonality;
  timeControl: TimeControl;
  chess960?: boolean;
  kingOfTheHill?: boolean;
  threeCheck?: boolean;
  setupChess?: boolean;
  fogOfWar?: boolean;
  /** Giveaway (Antichess) — see giveaway.ts. Bots play it with chooseGiveawayBotMove, NOT Stockfish
   * (which knows nothing of mandatory captures). Mutually exclusive with every other variant. */
  giveaway?: boolean;
  /** Atomic chess — see atomic.ts. Bots play it with chooseAtomicBotMove (a shallow search over Atomic's
   * own legal moves), NOT Stockfish (which knows nothing of explosions). Mutually exclusive with every
   * other variant. */
  atomic?: boolean;
  /** The merged starting position from the Setup Chess builder flow — used instead of
   * self-generating one when present. `colorChoice` must already be the concrete color the human
   * built their army as (not 'random') when this is set, see BotSetupChessFlowScreen. */
  initialFen?: string;
  colorChoice?: ColorChoice;
  authToken: string | null;
  onExit: () => void;
  onAnalyze: (params: AnalyzeParams) => void;
}

export default function BotGameScreen({
  bot,
  timeControl,
  chess960 = false,
  kingOfTheHill = false,
  threeCheck = false,
  setupChess = false,
  fogOfWar = false,
  giveaway = false,
  atomic = false,
  initialFen: initialFenProp,
  colorChoice = 'random',
  authToken,
  onExit,
  onAnalyze,
}: BotGameScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  // Resolved once per screen mount (a fixed value for this game's whole lifetime, including any
  // "New Game" resets) — 'random' is a one-time coin flip made when the player enters the game,
  // not re-rolled on every render.
  const [userColor] = useState<PieceColor>(() =>
    colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice
  );
  const botColor: PieceColor = userColor === 'w' ? 'b' : 'w';
  // Which engine plays this bot is decided automatically from its ELO (see getEngineIdForElo)
  // — not something the player picks — so weaker bots feel authentically weak (a genuinely
  // simpler classical engine) rather than a strong engine artificially dialed down. The one
  // exception is a synthetic "custom engine" bot card (see BotSelectScreen), which sets
  // `engineId` explicitly to override this.
  const engineId = useMemo(() => bot.engineId ?? getEngineIdForElo(bot.elo), [bot.engineId, bot.elo]);
  const [initialFen, setInitialFen] = useState(() => initialFenProp ?? (chess960 ? generateChess960Position() : START_FEN));
  const [fen, setFen] = useState(initialFen);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const [history, setHistory] = useState<GameHistoryEntry[]>([]);
  const [botThinking, setBotThinking] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [resetCount, setResetCount] = useState(0);
  const [openingName, setOpeningName] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [resignedBy, setResignedBy] = useState<PieceColor | null>(null);
  const [hintText, setHintText] = useState<string | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [hintRequestKey, setHintRequestKey] = useState(0);
  const [viewIndex, setViewIndex] = useState<number | null>(null); // null = live position
  const [fogOfWarWinner, setFogOfWarWinner] = useState<PieceColor | null>(null);

  // See LocalGameScreen's identical effect for why a miss here doesn't clear the name — it only
  // ever upgrades to a deeper/more specific match as the game continues.
  useEffect(() => {
    if (chess960 || setupChess || fogOfWar || giveaway || atomic) return;
    const match = lookupOpening(fen);
    if (match) setOpeningName(match.name);
  }, [fen, chess960, setupChess, fogOfWar, giveaway, atomic]);

  // skipValidation: once a Fog of War game ends via king capture, `fen` genuinely has no king
  // for the losing side — see ChessEngine's own doc comment on the option (this is the exact
  // crash category already found/fixed in cloneWithTurn, caught again here by a systematic grep).
  const engine = useMemo(
    () => new ChessEngine(fen, { chess960, initialFen, skipValidation: fogOfWar || giveaway, giveaway, atomic }),
    [fen, chess960, initialFen, fogOfWar, giveaway, atomic]
  );
  const turn = engine.getTurn();
  // Atomic: see LocalGameScreen's identical block — the engine answers status from atomic.ts, a blown-up
  // king is atomicWinner, and threefold repetition comes from the history's FENs.
  const atomicWinner = useMemo(() => (atomic ? getAtomicWinner(engine) : null), [atomic, engine]);
  const atomicRepetition = useMemo(
    () => atomic && isAtomicThreefoldRepetition([initialFen, ...history.map((h) => h.fenAfter)]),
    [atomic, initialFen, history]
  );
  const chessStatus = atomicRepetition ? 'draw' : engine.getStatus();
  // Chess.js has no idea this rule exists — checked independently, only when actually playing
  // this variant (see kingOfTheHill.ts).
  const kingOfTheHillWinner = kingOfTheHill ? getKingOfTheHillWinner(engine) : null;
  // Derived from `history` (see threeCheck.ts) rather than separately tracked state, so it's
  // automatically correct after Undo too.
  const historyMoves = useMemo(() => history.map((h) => h.move), [history]);
  const threeCheckWinner = threeCheck ? getThreeCheckWinner(historyMoves) : null;
  const checkCounts = threeCheck ? getThreeCheckCounts(historyMoves) : null;

  // Fog of War has no checkmate/stalemate/draw concept — see LocalGameScreen's identical
  // engineGameOver for the full rationale (king capture, via fogOfWarWinner below, is the only
  // way such a game ends).
  // Giveaway: no checkmate/stalemate/draw either — whoever is to move with no legal move WINS (see
  // giveaway.ts). Derived from the position rather than stored, so it is right after Undo too.
  const giveawayWinner = useMemo(() => (giveaway ? getGiveawayWinner(engine) : null), [giveaway, engine]);
  const engineGameOver = giveaway ? giveawayWinner !== null : fogOfWar ? false : engine.isGameOver() || atomicRepetition;
  // Auto-tick runs for whichever side's turn it is — including the bot's — so its clock counts
  // down live, second by second, in real wall-clock time while it "thinks" (the engine really
  // does take approximately thinkTimeMs to respond), exactly like the human side already did.
  const clock = useChessClock(timeControl, turn, engineGameOver);
  const gameOver =
    engineGameOver ||
    clock.timeoutWinner !== null ||
    resignedBy !== null ||
    kingOfTheHillWinner !== null ||
    threeCheckWinner !== null ||
    fogOfWarWinner !== null;

  // Fog of War only — the human always sees their own fog continuously (unlike Local's
  // alternating hotseat device-holder, there's exactly one person at this device, and the bot
  // has no "view" of its own — it always plays from the true `fen`, the deliberately accepted
  // asymmetry this mode is built around). Move-history/last-move redaction is from the human's
  // point of view too, for the same reason.
  const visibleSquares = useMemo(() => (fogOfWar ? getVisibleSquares(engine, userColor) : undefined), [fogOfWar, engine, userColor]);
  // Incremental, not a full replay-from-scratch per render/move — see useIncrementalFogRedaction's
  // own doc comment (and this session's profiling: a full replay cost ~230ms by move 40, run
  // synchronously inside the very render handleMove triggers).
  const fogRedactedByColor = useIncrementalFogRedaction(fogOfWar, initialFen, history, engine);
  const fogRedactedHistory = fogOfWar ? fogRedactedByColor[userColor] : null;
  const lastMoveRevealed = !fogOfWar || (fogRedactedHistory?.[fogRedactedHistory.length - 1]?.revealed ?? true);

  // Fog of War only — see logFogOfWarGameStart/logFogOfWarPly's own doc comments (diagnosticLog.ts,
  // reachable via More > Diagnostics): never shown in gameplay UI, purely so a player who spots a
  // move that looks wrong can copy out the exact sequence afterward instead of relying on memory.
  useEffect(() => {
    if (!fogOfWar) return;
    logFogOfWarGameStart('BotGame', initialFen, chess960);
    // Deliberately keyed on resetCount (a fresh game), not initialFen alone — a rematch can reuse
    // the identical initialFen (classical start) while still being a genuinely new game to log.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fogOfWar, resetCount]);

  useEffect(() => {
    if (!fogOfWar || history.length === 0) return;
    const entry = history[history.length - 1];
    const mover: PieceColor = (history.length - 1) % 2 === 0 ? 'w' : 'b';
    logFogOfWarPly({
      ply: history.length,
      mover,
      san: entry.move.san,
      to: entry.move.to,
      perspectives: [
        {
          label: `visibleTo(${userColor}, you)`,
          revealed: fogRedactedByColor[userColor][fogRedactedByColor[userColor].length - 1]?.revealed ?? false,
          visible: getVisibleSquares(engine, userColor),
        },
        {
          label: `visibleTo(${botColor}, bot)`,
          revealed: fogRedactedByColor[botColor][fogRedactedByColor[botColor].length - 1]?.revealed ?? false,
          visible: getVisibleSquares(engine, botColor),
        },
      ],
    });
    // Keyed on history.length (fires exactly once per new ply) — engine/userColor/botColor are
    // read fresh from the closure at that moment, which is exactly when they're relevant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fogOfWar, history.length]);

  // Fires once per game (not once per re-render while gameOver stays true) — resets itself the
  // moment `gameOver` next goes back to false, i.e. on the next "New Game"/rematch.
  const gameEndHapticFired = useRef(false);
  useEffect(() => {
    if (gameOver && !gameEndHapticFired.current) {
      gameEndHapticFired.current = true;
      triggerGameEndHaptics();
    } else if (!gameOver) {
      gameEndHapticFired.current = false;
    }
  }, [gameOver]);

  const savePayload = useMemo(
    () =>
      buildGamePayload({
        chessStatus,
        turn,
        timeoutWinner: clock.timeoutWinner,
        resignedBy,
        kingOfTheHillWinner,
        threeCheckWinner,
        fogOfWarWinner,
        giveawayWinner,
        giveaway,
        atomicWinner,
        atomic,
        history,
        initialFen,
        chess960,
        timeControl,
        opponentType: 'bot',
        opponentElo: bot.elo,
      }),
    [
      chessStatus,
      turn,
      clock.timeoutWinner,
      resignedBy,
      kingOfTheHillWinner,
      threeCheckWinner,
      fogOfWarWinner,
      giveawayWinner,
      giveaway,
      atomicWinner,
      atomic,
      history,
      initialFen,
      chess960,
      timeControl,
      bot.elo,
    ]
  );
  useSaveGameOnEnd(authToken, resetCount, savePayload);

  // Resolves to the engine instance + bridge HTML for whichever UciChessEngine was picked in
  // BotSelectScreen — stable across this screen's lifetime since `engineId` is a prop set once
  // at game start, not something the player can change mid-game.
  const engineRuntime = useMemo(() => getEngineRuntime(engineId), [engineId]);

  const bridgeRef = useRef<StockfishBridgeHandle>(null);
  // Memoized so React doesn't treat this as a "new" ref callback on every re-render — a
  // changing ref identity forces a detach+reattach cycle each render, which was resetting the
  // engine's internal ready-state mid-flight (it re-renders often: clock ticks, bot-thinking
  // state, etc).
  const handleBridgeRef = useCallback(
    (handle: StockfishBridgeHandle | null) => {
      bridgeRef.current = handle;
      engineRuntime.engine.attachBridge(handle);
    },
    [engineRuntime]
  );
  const handleEngineLine = useCallback((line: string) => engineRuntime.engine.handleLine(line), [engineRuntime]);

  // Hint reuses the SAME engine instance/bridge already mounted for the bot's own moves — no
  // second scratch engine needed here (unlike LocalGameScreen, which has none wired in at all).
  // This is safe because Hint only ever runs on the user's turn while the bot-move effect below
  // only ever runs on the bot's turn, so the two never talk to the engine at the same time.
  useEffect(() => {
    if (hintRequestKey === 0) return;
    let cancelled = false;
    (async () => {
      try {
        await engineRuntime.engine.initEngine();
        engineRuntime.engine.setPosition(fen);
        const uci = await engineRuntime.engine.getBestMove({ ...getBotStrengthOptions(bot.elo), movetimeMs: 800 });
        if (cancelled) return;
        setHintText(uciMoveToSan(uci, fen, { chess960, initialFen }));
      } catch {
        if (!cancelled) setHintText(null);
      } finally {
        if (!cancelled) setHintLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintRequestKey]);

  // Whenever it becomes the bot's turn, ask the engine for a move and play it automatically.
  useEffect(() => {
    if (turn !== botColor || gameOver) return;

    let cancelled = false;
    setBotThinking(true);
    setEngineError(null);
    setHintText(null);

    (async () => {
      try {
        // Giveaway positions can legitimately lack a king (kings are capturable pieces there), so
        // this engine needs skipValidation too — the other variants never reach a kingless fen here.
        const moveEngine = new ChessEngine(fen, { chess960, initialFen, skipValidation: giveaway, giveaway, atomic });
        let move: Move | null = null;

        // Giveaway: Stockfish is bypassed entirely (see chooseGiveawayBotMove) — a normal engine move
        // routinely breaks the mandatory-capture rule. A short, capped pause stands in for thinking
        // so replies don't land instantly, with the bot's clock ticking meanwhile like any other bot.
        if (giveaway) {
          const thinkTimeMs = getBotThinkTimeMs({
            timeControl,
            remainingSeconds: botColor === 'w' ? clock.whiteSeconds : clock.blackSeconds,
            legalMoveCount: getGiveawayMoves(engine).length,
          });
          await new Promise((resolve) => setTimeout(resolve, Math.min(thinkTimeMs, 2500)));
          if (cancelled) return;
          const choice = chooseGiveawayBotMove(moveEngine, bot.elo);
          if (!choice) throw new Error('Giveaway bot has no legal move');
          move = moveEngine.movePseudoLegal(choice.from, choice.to, choice.promotion);
          if (!move) throw new Error(`Invalid Giveaway move: ${choice.from}${choice.to}`);
        }

        // Atomic: Stockfish is bypassed entirely too (see chooseAtomicBotMove) — it has no concept of
        // explosions, so its moves are routinely illegal or suicidal here. The short capped pause stands in
        // for thinking, with the bot's clock ticking meanwhile like any other bot's.
        if (atomic) {
          const thinkTimeMs = getBotThinkTimeMs({
            timeControl,
            remainingSeconds: botColor === 'w' ? clock.whiteSeconds : clock.blackSeconds,
            legalMoveCount: engine.getLegalMoveCount(),
          });
          await new Promise((resolve) => setTimeout(resolve, Math.min(thinkTimeMs, 2500)));
          if (cancelled) return;
          const choice = chooseAtomicBotMove(moveEngine, bot.elo);
          if (!choice) throw new Error('Atomic bot has no legal move');
          move = moveEngine.move(choice.from, choice.to, choice.promotion);
          if (!move) throw new Error(`Invalid Atomic move: ${choice.from}${choice.to}`);
        }

        // Fog of War only — Stockfish (like every standard UCI engine) can never suggest
        // capturing the enemy king itself: its own move generator assumes ordinary legal-chess
        // invariants, under which the enemy king is never actually sitting there capturable, so
        // that move type doesn't exist in its search at all. If the human just left their own
        // king exposed within the bot's reach, this is checked and taken directly — skipping the
        // engine entirely for this ply — since otherwise the bot would simply never notice.
        if (fogOfWar && !move) {
          const captureKing = engine.getPseudoLegalMoves(botColor).find((m) => m.captured === 'k');
          if (captureKing) {
            move = moveEngine.movePseudoLegal(captureKing.from, captureKing.to, captureKing.promotion);
          }
        }

        if (!move) {
          await engineRuntime.engine.initEngine();
          engineRuntime.engine.setPosition(fen);

          // Same think-time logic for every bot personality/ELO and for both classical and
          // Chess960 — this is the only place BotGameScreen asks the engine for a move.
          const thinkTimeMs = getBotThinkTimeMs({
            timeControl,
            remainingSeconds: botColor === 'w' ? clock.whiteSeconds : clock.blackSeconds,
            legalMoveCount: engine.getLegalMoveCount(),
          });

          const thinkStartedAt = Date.now();
          const uciMove = await engineRuntime.engine.getBestMove({
            ...getBotStrengthOptions(bot.elo),
            movetimeMs: thinkTimeMs,
          });
          const actualThinkMs = Date.now() - thinkStartedAt;
          // Lightweight engine-timing diagnostic — requested movetime vs. actual wall-clock time
          // taken (a large gap would point at the WebView bridge, not the engine itself).
          logDiagnostic(`[Engine] ${getEngineName(engineId)} think: requested=${thinkTimeMs}ms actual=${actualThinkMs}ms -> ${uciMove}`);
          if (cancelled) return;

          const parsed = parseUciMove(uciMove);
          if (!parsed) throw new Error(`Unrecognized move from engine: "${uciMove}"`);

          // Fog of War: movePseudoLegal uniformly (not just for the king-capture branch above) —
          // see ChessBoard's own fogOfWar doc comment; a move Stockfish suggests is always also
          // pseudo-legal, so this is a strict superset of what move() would have accepted anyway.
          move = fogOfWar
            ? moveEngine.movePseudoLegal(parsed.from, parsed.to, parsed.promotion)
            : moveEngine.move(parsed.from, parsed.to, parsed.promotion);
          if (!move) throw new Error(`Invalid move from engine: "${uciMove}"`);
        }
        if (cancelled) return;

        // The bot's clock was already ticking down live via auto-tick while it "thought" (see
        // the useChessClock call above) — only the post-move increment still needs applying here.
        clock.applyIncrement(botColor);
        playMoveSound(move);
        triggerMoveHaptics(move);
        setHistory((h) => [...h, { move, fenBefore: fen, fenAfter: moveEngine.getFen() }]);
        setLastMove(move);
        setFen(moveEngine.getFen());
        if (fogOfWar) {
          const winner = getFogOfWarWinner(move, botColor);
          if (winner) setFogOfWarWinner(winner);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          console.log('[BotGame] engine error:', message);
          setEngineError(message);
        }
      } finally {
        if (!cancelled) setBotThinking(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();

    return () => {
      cancelled = true;
    };
    // bot/timeControl/engineRuntime are stable for the lifetime of this screen; fen+gameOver are the real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, gameOver]);

  const { whiteCaptured, blackCaptured } = useMemo(
    () => computeCapturedMaterial(history.map((h, i) => ({ captured: h.move.captured, exploded: h.move.exploded, moverColor: i % 2 === 0 ? 'w' : 'b' }))),
    [history]
  );
  const materialDiff = materialValue(whiteCaptured) - materialValue(blackCaptured);

  // Tracks (without re-rendering) whether the user was ever down 3+ points of material at any
  // point this game, for the 'comeback_win' achievement — checked once the game actually ends,
  // in the rating-update effect below.
  const wasMaterialDownRef = useRef(false);
  useEffect(() => {
    const myAdvantage = userColor === 'w' ? materialDiff : -materialDiff;
    if (myAdvantage <= -3) wasMaterialDownRef.current = true;
  }, [materialDiff, userColor]);

  // Whether the side to move must capture this turn (Giveaway only) — surfaced in the status line so
  // a player who finds only some pieces movable understands why.
  const mustCapture = useMemo(
    () => giveaway && !giveawayWinner && getGiveawayMoves(engine).some((m) => m.captured),
    [giveaway, giveawayWinner, engine]
  );
  const turnLabel = turn === userColor ? 'You' : bot.name;
  const winnerLabel = turn === userColor ? bot.name : 'You';

  let statusText = `Turn: ${turnLabel}`;
  // Fog of War never announces check/checkmate/stalemate/draw — see LocalGameScreen's identical
  // statusText for the full rationale.
  if (!fogOfWar && !giveaway && chessStatus === 'check') statusText = `Turn: ${turnLabel} — Check!`;
  if (!fogOfWar && !giveaway && chessStatus === 'checkmate') statusText = `Checkmate! Winner: ${winnerLabel}`;
  if (!fogOfWar && !giveaway && chessStatus === 'stalemate') statusText = 'Draw (Stalemate)';
  if (!fogOfWar && !giveaway && chessStatus === 'draw') statusText = 'Draw';
  if (mustCapture && turn === userColor) statusText = `Turn: ${turnLabel} — must capture`;
  if (clock.timeoutWinner) {
    statusText = `Win on time: ${clock.timeoutWinner === userColor ? 'You' : bot.name}`;
  }
  if (resignedBy) statusText = `You resigned — ${bot.name} wins`;
  if (kingOfTheHillWinner) {
    statusText = `${kingOfTheHillWinner === userColor ? 'You win' : `${bot.name} wins`} by King of the Hill!`;
  }
  if (threeCheckWinner) {
    statusText = `${threeCheckWinner === userColor ? 'You win' : `${bot.name} wins`} by Three-Check!`;
  }
  if (giveawayWinner) {
    statusText = `${giveawayWinner === userColor ? 'You win' : `${bot.name} wins`} — no legal moves left!`;
  }
  if (atomicWinner) {
    statusText = `${atomicWinner === userColor ? 'You win' : `${bot.name} wins`} by exploding the king!`;
  }
  if (fogOfWarWinner) {
    statusText = `${fogOfWarWinner === userColor ? 'You win' : `${bot.name} wins`} by capturing the king!`;
  }

  const outcome = getGameOutcome(
    chessStatus,
    turn,
    clock.timeoutWinner,
    resignedBy,
    false,
    kingOfTheHillWinner,
    threeCheckWinner,
    fogOfWarWinner,
    giveawayWinner,
    atomicWinner
  );
  const winnerColor: PieceColor | null =
    outcome.over && outcome.result !== '1/2-1/2' ? (outcome.result === '1-0' ? 'w' : 'b') : null;
  const summaryTitle = !outcome.over ? '' : outcome.result === '1/2-1/2' ? 'Draw' : winnerColor === userColor ? 'You Won' : 'Bot Won';
  const summarySubtitle = outcome.over ? describeEndReason(outcome.reason) : '';

  // Updates this device's internal per-category rating exactly once per finished game — bullet/
  // blitz/rapid only (daily/unlimited aren't rated, see RATING_CATEGORIES) — using the bot's real,
  // fixed ELO as a genuinely calibrated opponent strength.
  const ratingRecordedRef = useRef(false);
  useEffect(() => {
    if (!outcome.over) {
      ratingRecordedRef.current = false;
      return;
    }
    if (ratingRecordedRef.current) return;
    ratingRecordedRef.current = true;
    const result = outcome.result === '1/2-1/2' ? 0.5 : winnerColor === userColor ? 1 : 0;
    const ratingCategory = toRatingCategory(timeControl.category);
    // Giveaway and Atomic are different games with a heuristic (not ELO-calibrated) opponent — they must
    // not move the player's chess rating or unlock rating-based achievements.
    if (ratingCategory && !giveaway && !atomic) recordRatedGame(ratingCategory, bot.elo, result, authToken);

    if (result === 1 && !giveaway && !atomic) {
      if (bot.elo >= 2000) unlockAchievement('giant_slayer');
      if (wasMaterialDownRef.current) unlockAchievement('comeback_win');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome.over]);

  // Memoized — passed straight through to ChessBoard (now React.memo'd), so a reference that
  // changes every render (as a plain inline function would) would force the whole board to
  // re-render on every clock tick regardless of whether the position actually changed.
  const handleMove = useCallback(
    (move: Move, newFen: string) => {
      if (viewIndex !== null) return;
      clock.applyIncrement(userColor);
      playMoveSound(move);
      triggerMoveHaptics(move);
      setHistory((h) => [...h, { move, fenBefore: fen, fenAfter: newFen }]);
      setLastMove(move);
      setFen(newFen);
      setHintText(null);
      if (fogOfWar) {
        const winner = getFogOfWarWinner(move, userColor);
        if (winner) setFogOfWarWinner(winner);
      }
    },
    [viewIndex, clock.applyIncrement, userColor, fen, fogOfWar]
  );

  // Premove: queued while the bot is "thinking" (see ChessBoard's premoveColor/onPremove), played
  // automatically via handleMove the instant it's actually the user's turn again — same pattern
  // as OnlineGameScreen's premove, just resolved against the bot's move landing instead of a
  // socket event.
  const [premove, setPremove] = useState<PremoveIntent | null>(null);
  const [premoveInvalid, setPremoveInvalid] = useState(false);

  // Memoized for the same reason as handleMove above — also passed straight to ChessBoard.
  const handleQueuePremove = useCallback((intent: PremoveIntent) => {
    setPremove(intent);
    setPremoveInvalid(false);
  }, []);

  const handleCancelPremove = () => {
    setPremove(null);
    setPremoveInvalid(false);
  };

  useEffect(() => {
    if (!premove || turn !== userColor || gameOver) return;
    setPremove(null);
    const premoveEngine = new ChessEngine(fen, { chess960, initialFen });
    const move = fogOfWar
      ? premoveEngine.movePseudoLegal(premove.from, premove.to, premove.promotion)
      : premoveEngine.move(premove.from, premove.to, premove.promotion);
    if (move) {
      handleMove(move, premoveEngine.getFen());
    } else {
      setPremoveInvalid(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, premove]);

  const handleReset = () => {
    const nextInitialFen = initialFenProp ?? (chess960 ? generateChess960Position() : START_FEN);
    setInitialFen(nextInitialFen);
    setFen(nextInitialFen);
    setLastMove(null);
    setHistory([]);
    setEngineError(null);
    setResetCount((c) => c + 1);
    setOpeningName(null);
    setResignedBy(null);
    setHintText(null);
    setShowOptions(false);
    setViewIndex(null);
    setPremove(null);
    setPremoveInvalid(false);
    setFogOfWarWinner(null);
    wasMaterialDownRef.current = false;
    clock.reset();
  };

  const handleResign = () => {
    if (gameOver) return;
    setShowOptions(false);
    appAlert('Resign?', 'This ends the game as a loss.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Resign', style: 'destructive', onPress: () => setResignedBy(userColor) },
    ]);
  };

  // Pops both the user's last move AND the bot's reply to it, so it's the user's turn again —
  // only enabled on the user's turn (i.e. once the bot has already replied), which means
  // `history` always has an even length here and this slice is always safe.
  const handleUndo = () => {
    if (gameOver || botThinking || turn !== userColor || history.length < 2 || isReviewing) return;
    const target = history[history.length - 2];
    setHistory((h) => h.slice(0, -2));
    setFen(target.fenBefore);
    setLastMove(history.length >= 3 ? history[history.length - 3].move : null);
    setOpeningName(null);
    setHintText(null);
  };

  // Disabled for Fog of War — see LocalGameScreen's identical handleHintPress for why (reads the
  // true, full position, which would just hand the player a way around the whole variant).
  const handleHintPress = () => {
    if (gameOver || hintLoading || botThinking || turn !== userColor || isReviewing || fogOfWar || giveaway || atomic) return;
    setHintText(null);
    setHintLoading(true);
    setHintRequestKey((k) => k + 1);
  };

  // Same local-only review mechanism as LocalGameScreen/OnlineGameScreen — tapping a move in the
  // strip never touches `fen`/`history` (the live game the bot keeps playing against), it only
  // changes which position is displayed.
  const positions = useMemo(() => [initialFen, ...history.map((h) => h.fenAfter)], [initialFen, history]);
  const isReviewing = viewIndex !== null;
  const displayFen = isReviewing ? positions[viewIndex as number] : fen;
  const selectedMoveIndex = isReviewing ? (viewIndex as number) - 1 : history.length - 1;
  const displayLastMove = selectedMoveIndex >= 0 ? history[selectedMoveIndex].move : null;

  // Disabled for Fog of War — see LocalGameScreen's identical handleSelectMove for why (would
  // expose `positions`' real, unredacted fenAfter snapshots).
  const handleSelectMove = (index: number) => {
    if (fogOfWar) return;
    const next = index + 1;
    setViewIndex(next >= positions.length - 1 ? null : next);
  };

  const fogMoveListMoves = fogRedactedHistory?.map((entry) => ({ san: entry.revealed ? entry.san : '?' })) ?? [];
  const lastMoveSanDisplay = lastMoveRevealed ? lastMove?.san : '???';

  // Flipping the board also swaps which row (You / the bot) sits on top vs bottom, so each row
  // always stays next to "its own" side of the board.
  const topColor: PieceColor = flipped ? userColor : botColor;
  const bottomColor: PieceColor = flipped ? botColor : userColor;
  const playerInfo = (color: PieceColor) => ({
    label: color === userColor ? 'You' : bot.name,
    seconds: color === 'w' ? clock.whiteSeconds : clock.blackSeconds,
    captured: color === 'w' ? whiteCaptured : blackCaptured,
    iconColor: (color === 'w' ? 'b' : 'w') as PieceColor,
    advantage: color === 'w' ? (materialDiff > 0 ? materialDiff : 0) : materialDiff < 0 ? -materialDiff : 0,
    checks: checkCounts ? checkCounts[color] : null,
  });
  const top = playerInfo(topColor);
  const bottom = playerInfo(bottomColor);

  return (
    <View style={styles.container}>
      <StockfishBridge ref={handleBridgeRef} onLine={handleEngineLine} html={engineRuntime.buildHtml()} />
      <ScreenHeader
        title="Chess — vs Bot"
        subtitle={
          chess960
            ? 'Chess960'
            : kingOfTheHill
              ? 'King of the Hill'
              : threeCheck
                ? 'Three-Check'
                : setupChess
                  ? 'Setup Chess'
                  : fogOfWar
                    ? 'Fog of War'
                    : giveaway
                      ? 'Giveaway'
                      : atomic
                        ? 'Atomic'
                        : undefined
        }
        onBack={onExit}
        backLabel="‹ Menu"
      />
      <MoveListStrip
        moves={fogOfWar ? fogMoveListMoves : history.map((h) => ({ san: h.move.san }))}
        selectedIndex={selectedMoveIndex}
        autoScroll={!isReviewing}
        onSelectMove={handleSelectMove}
      />
      <GameScreenBody
        bottomBar={
          <>
            <View style={styles.controlsWrap}>
              <GameControlBar
                items={[
                  { key: 'options', label: 'Options', onPress: () => setShowOptions((v) => !v), active: showOptions },
                  { key: 'resign', label: 'Resign', onPress: handleResign, disabled: gameOver },
                  {
                    key: 'hint',
                    label: 'Hint',
                    onPress: handleHintPress,
                    disabled: gameOver || hintLoading || botThinking || turn !== userColor || isReviewing || fogOfWar || giveaway || atomic,
                  },
                  {
                    key: 'undo',
                    label: 'Undo',
                    onPress: handleUndo,
                    disabled: gameOver || botThinking || turn !== userColor || history.length < 2 || isReviewing,
                  },
                ]}
              />
              <GameOptionsMenu
                visible={showOptions}
                items={[{ label: 'Flip Board', onPress: () => setFlipped((v) => !v) }]}
              />
            </View>

            <View style={styles.footer}>
              {lastMove && <Text style={styles.lastMove}>Last move: {lastMoveSanDisplay}</Text>}
              <View style={styles.footerButtons}>
                <Pressable style={styles.resetButton} onPress={handleReset}>
                  <Text style={styles.resetButtonText}>New Game</Text>
                </Pressable>
              </View>
            </View>
          </>
        }
      >
        <Text style={styles.subtitle}>
          {giveaway ? 'Giveaway bot' : atomic ? 'Atomic bot' : getEngineName(engineId)} · {bot.name} (ELO {bot.elo}) · {timeControl.label}
        </Text>
        {!gameOver && <Text style={styles.status}>{statusText}</Text>}
        {isReviewing && <Text style={styles.reviewingText}>Reviewing move history (not live)</Text>}
        {botThinking && (
          <View style={styles.thinkingRow}>
            <ActivityIndicator size="small" color={colors.text} />
            <Text style={styles.thinkingText}>The bot is thinking...</Text>
          </View>
        )}
        {engineError && <Text style={styles.errorText}>Engine error: {engineError}</Text>}
        {premoveInvalid && <Text style={styles.errorText}>Premove was no longer legal — cancelled.</Text>}
        {premove && turn === botColor && (
          <View style={styles.premoveRow}>
            <Text style={styles.premoveText}>
              Premove queued: {premove.from}-{premove.to}
            </Text>
            <Pressable style={styles.premoveCancelButton} onPress={handleCancelPremove}>
              <Text style={styles.premoveCancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.playerRow}>
          <Text style={[styles.clock, turn === topColor && !gameOver && styles.clockActive]}>
            {top.label}{clock.hasClock ? `: ${formatTime(top.seconds)}` : ''}
            {top.checks !== null ? ` · Checks: ${top.checks}/${THREE_CHECK_TARGET}` : ''}
          </Text>
          <CapturedPieces pieces={top.captured} color={top.iconColor} advantage={top.advantage} />
        </View>

        {!chess960 && !setupChess && !fogOfWar && !giveaway && !atomic && openingName && <Text style={styles.openingName}>{openingName}</Text>}

        <ChessBoard
          key={resetCount}
          fen={displayFen}
          onMove={handleMove}
          disabled={gameOver || isReviewing}
          chess960={chess960}
          initialFen={initialFen}
          orientation={flipped ? botColor : userColor}
          lastMove={displayLastMove}
          enableAnnotations
          kingOfTheHill={kingOfTheHill}
          fogOfWar={fogOfWar}
          giveaway={giveaway}
          atomic={atomic}
          visibleSquares={visibleSquares}
          // No premoves in Giveaway: mandatory capture changes which moves are legal after the
          // opponent's reply, so a queued move is almost never still valid when its turn comes. Atomic
          // has none either: explosions change the legal moves just as drastically, and the premove
          // executor (see the premove effect) builds a plain engine that knows nothing of its rules.
          premoveColor={giveaway || atomic ? undefined : userColor}
          onPremove={giveaway || atomic ? undefined : handleQueuePremove}
        />

        <View style={styles.playerRow}>
          <Text style={[styles.clock, turn === bottomColor && !gameOver && styles.clockActive]}>
            {bottom.label}{clock.hasClock ? `: ${formatTime(bottom.seconds)}` : ''}
            {bottom.checks !== null ? ` · Checks: ${bottom.checks}/${THREE_CHECK_TARGET}` : ''}
          </Text>
          <CapturedPieces pieces={bottom.captured} color={bottom.iconColor} advantage={bottom.advantage} />
        </View>

        {hintLoading && <Text style={styles.hintText}>Thinking of a hint...</Text>}
        {!hintLoading && hintText && <Text style={styles.hintText}>Hint: {hintText}</Text>}
      </GameScreenBody>

      <PostGameSummaryModal
        visible={gameOver}
        title={summaryTitle}
        subtitle={summarySubtitle}
        initialFen={initialFen}
        chess960={chess960}
        fogOfWar={fogOfWar}
        giveaway={giveaway}
        atomic={atomic}
        history={history}
        players={[{ label: 'You', color: userColor }]}
        onGameReview={() => onAnalyze({ initialFen, chess960, fogOfWar, history })}
        onRematch={handleReset}
        onNewGame={onExit}
      />
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    status: {
      fontSize: 16,
      color: colors.text,
    },
    openingName: {
      fontSize: 12,
      fontStyle: 'italic',
      color: colors.textSecondary,
      textAlign: 'center',
      maxWidth: 320,
    },
    reviewingText: {
      fontSize: 12,
      fontStyle: 'italic',
      color: colors.gold,
    },
    playerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    thinkingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    thinkingText: {
      fontSize: 14,
      color: colors.text,
      fontStyle: 'italic',
    },
    errorText: {
      fontSize: 13,
      color: colors.danger,
    },
    premoveRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    premoveText: {
      fontSize: 13,
      fontStyle: 'italic',
      color: colors.gold,
    },
    premoveCancelButton: {
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 6,
      backgroundColor: colors.buttonBackground,
    },
    premoveCancelButtonText: {
      fontSize: 12,
      fontWeight: '600',
      color: '#fff',
    },
    hintText: {
      fontSize: 13,
      fontStyle: 'italic',
      color: colors.accent,
    },
    controlsWrap: {
      alignItems: 'center',
      gap: 8,
    },
    clock: {
      fontSize: 20,
      fontVariant: ['tabular-nums'],
      color: colors.text,
      paddingVertical: 4,
      paddingHorizontal: 14,
      borderRadius: 6,
    },
    clockActive: {
      fontWeight: '700',
      color: '#fff',
      backgroundColor: colors.buttonBackground,
    },
    footer: {
      marginTop: 16,
      alignItems: 'center',
      gap: 8,
    },
    lastMove: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    footerButtons: {
      flexDirection: 'row',
      gap: 10,
    },
    resetButton: {
      paddingVertical: 10,
      paddingHorizontal: 24,
      backgroundColor: colors.buttonBackground,
      borderRadius: 8,
    },
    resetButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
  });
}
