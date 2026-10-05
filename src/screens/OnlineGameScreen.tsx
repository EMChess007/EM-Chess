import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { connectSocket, disconnectSocket } from '../api/socket';
import { appAlert } from '../components/AppAlert';
import CapturedPieces from '../components/CapturedPieces';
import ChessBoard, { type PremoveIntent } from '../components/ChessBoard';
import GameControlBar from '../components/GameControlBar';
import GameOptionsMenu from '../components/GameOptionsMenu';
import GameScreenBody from '../components/GameScreenBody';
import MoveListStrip from '../components/MoveListStrip';
import PostGameSummaryModal from '../components/PostGameSummaryModal';
import ScreenHeader from '../components/ScreenHeader';
import { ChessEngine } from '../logic/ChessEngine';
import { unlockAchievement } from '../logic/achievementStorage';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { describeEndReason } from '../logic/gameOutcomeText';
import { logDiagnostic } from '../logic/diagnosticLog';
import { getVisibleSquares, logFogOfWarGameStart, logFogOfWarPly } from '../logic/fogOfWar';
import { duckMoveNotation } from '../logic/duckChess';
import { getGiveawayMoves } from '../logic/giveaway';
import {
  afterSpellChessMove,
  castFreeze,
  castJump,
  checkIsWaivedByFreeze,
  initialSpellChessState,
  spellMoveNotation,
  spellTurnContext,
  type SpellChessState,
} from '../logic/spellChess';
import { triggerGameEndHaptics, triggerMoveHaptics } from '../logic/haptics';
import { computeCapturedMaterial, materialValue } from '../logic/material';
import { playMoveSound } from '../logic/moveSounds';
import { lookupOpening } from '../logic/openings';
import { toRatingCategory } from '../logic/rating';
import { getRatings, recordRatedGame } from '../logic/ratingStorage';
import { categoryForInitialSeconds } from '../logic/timeControls';
import { THREE_CHECK_TARGET, getThreeCheckCounts } from '../logic/threeCheck';
import { isUnlimitedClock, playerClockText } from '../logic/time';
import type { Move, PieceColor } from '../types/chess';
import type { AnalyzeParams, GameHistoryEntry } from '../types/history';
import type {
  Ack,
  ChatMessagePayload,
  DrawOfferedPayload,
  GameOverPayload,
  MatchFoundPayload,
  OpponentMovePayload,
  RejoinStatePayload,
} from '../types/multiplayer';

interface OnlineGameScreenProps {
  authToken: string;
  match: MatchFoundPayload;
  onExit: () => void;
  onAnalyze: (params: AnalyzeParams) => void;
  /** Set when this game was entered from a tournament (see TournamentStandingsScreen) — exiting
   * goes back to that tournament's live standings, which needs the same socket connection to
   * keep receiving its own push updates (participant tracking is keyed by socket.id), so this
   * skips the disconnect a normal exit-to-menu does. */
  keepSocketAlive?: boolean;
}

// Extends the shared GameHistoryEntry shape (move/fenBefore/fenAfter — what analysis/summary
// code needs) with `mover`, which the move-list rendering and captured-material computation
// already relied on.
interface MoveRecord extends GameHistoryEntry {
  mover: PieceColor;
}

interface ChatEntry {
  from: 'me' | 'opponent';
  text: string;
}

export default function OnlineGameScreen({ authToken, match, onExit, onAnalyze, keepSocketAlive }: OnlineGameScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const myColor = match.color;
  const opponentColor: PieceColor = myColor === 'w' ? 'b' : 'w';
  // Giveaway (Antichess) — the server owns the rules (mandatory capture, stuck-wins); this screen only needs
  // its engines built the Giveaway way so they understand kingless positions, king promotion and no castling.
  const giveaway = match.isGiveaway === true;
  // Atomic chess — likewise server-owned; the engines here are built with the atomic option so they understand
  // explosions (and the board can animate them), but the server decides what is legal and who has won.
  const atomic = match.isAtomic === true;
  // Duck Chess — server-owned too. A turn is a move AND the duck's new square: ChessBoard collects both before
  // handing the move over (move.duck), and make_move carries them together as duckTo. The duck's square is not in
  // the FEN, so it is tracked next to it (and per move in the history, for review).
  const duckChess = match.isDuckChess === true;
  // Spell Chess — server-owned too. A turn is an OPTIONAL cast (at most one, before the move) then the move;
  // ChessBoard collects both before handing the move over (move.spell), and make_move carries the cast
  // alongside it. Unlike Duck Chess's duckSquare, the server echoes the WHOLE SpellChessState back out (charges/
  // cooldowns/pending effects), since there's materially more of it than one square.
  const spellChess = match.isSpellChess === true;

  const [fen, setFen] = useState(match.fen);
  const [duckSquare, setDuckSquare] = useState<string | null>(null);
  const [placingDuck, setPlacingDuck] = useState(false);
  // Read by the (stable-deps) socket handlers below, like fenRef.
  const duckRef = useRef<string | null>(null);
  useEffect(() => {
    duckRef.current = duckSquare;
  }, [duckSquare]);
  const [spellState, setSpellState] = useState<SpellChessState>(initialSpellChessState());
  const spellRef = useRef<SpellChessState>(spellState);
  useEffect(() => {
    spellRef.current = spellState;
  }, [spellState]);
  const [turn, setTurn] = useState<PieceColor>('w');
  const [whiteMs, setWhiteMs] = useState(match.whiteMs);
  const [blackMs, setBlackMs] = useState(match.blackMs);
  // Purely cosmetic local countdown for whichever side's turn it is — whiteMs/blackMs above are
  // the authoritative values and only ever change on a server message (opponent moved, our own
  // move got acked, a reconnect resynced state), so without this the displayed clock would sit
  // frozen between those events instead of visibly ticking down like a real clock.
  const [displayWhiteMs, setDisplayWhiteMs] = useState(match.whiteMs);
  const [displayBlackMs, setDisplayBlackMs] = useState(match.blackMs);
  const [moveList, setMoveList] = useState<MoveRecord[]>([]);
  const [lastMoveSan, setLastMoveSan] = useState<string | null>(null);
  const [boardKey, setBoardKey] = useState(0);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [gameOver, setGameOver] = useState<GameOverPayload | null>(null);
  const [connectionState, setConnectionState] = useState<'connected' | 'reconnecting'>('connected');
  const [opponentGraceSeconds, setOpponentGraceSeconds] = useState<number | null>(null);
  const [openingName, setOpeningName] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [viewIndex, setViewIndex] = useState<number | null>(null); // null = live position
  const [drawOfferPending, setDrawOfferPending] = useState(false);
  const [incomingDrawOffer, setIncomingDrawOffer] = useState(false);
  const [drawNotice, setDrawNotice] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatEntry[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatUnread, setChatUnread] = useState(0);
  const wasMaterialDownRef = useRef(false);
  // Fog of War only — the server always redacts `fen` for this recipient already (see
  // MatchFoundPayload.visibleSquares), but ChessBoard still needs this explicit set to tell a
  // genuinely-empty-and-visible square apart from a fogged one (see ChessBoard's own doc comment
  // on visibleSquares).
  const [visibleSquares, setVisibleSquares] = useState<Set<string> | undefined>(
    match.isFogOfWar ? new Set(match.visibleSquares ?? []) : undefined
  );

  // Fog of War only — see logFogOfWarGameStart's own doc comment (diagnosticLog.ts, reachable via
  // More > Diagnostics): never shown in gameplay UI.
  useEffect(() => {
    if (!match.isFogOfWar) return;
    logFogOfWarGameStart('OnlineGame', match.fen, match.isChess960);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.isFogOfWar, match.roomId]);

  useEffect(() => {
    if (chatOpen) setChatUnread(0);
  }, [chatOpen]);

  // Resync the cosmetic display clocks the instant a fresh authoritative value arrives.
  useEffect(() => {
    setDisplayWhiteMs(whiteMs);
  }, [whiteMs]);
  useEffect(() => {
    setDisplayBlackMs(blackMs);
  }, [blackMs]);

  // Ticks the display clock down once a second for whichever side's turn it currently is — the
  // authoritative whiteMs/blackMs only update on a server message, so without this the shown
  // clock would otherwise sit frozen between moves instead of counting down live.
  useEffect(() => {
    if (gameOver || connectionState !== 'connected' || isUnlimitedClock(match.timeControl.initialSeconds)) return;
    const interval = setInterval(() => {
      if (turn === 'w') setDisplayWhiteMs((ms) => Math.max(0, ms - 1000));
      else setDisplayBlackMs((ms) => Math.max(0, ms - 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [turn, gameOver, connectionState]);

  // Lets the socket-event effect below (stable deps, set up once) read the *current* fen when an
  // opponent_move arrives, without needing `fen` in its dependency array (which would tear down
  // and re-subscribe every socket listener on every move).
  const fenRef = useRef(fen);
  useEffect(() => {
    fenRef.current = fen;
  }, [fen]);

  // Fog of War only — a running count purely for logFogOfWarPly's own `ply` label; the moves
  // themselves are already in order in the diagnostic log regardless (see its own doc comment).
  const plyCounterRef = useRef(0);

  // Reacts to `fen` changing for any reason (our own move, the opponent's move, or a rejoin
  // state sync after reconnecting) rather than being threaded through each individual handler
  // below. See LocalGameScreen's identical effect for why a miss here doesn't clear the name.
  useEffect(() => {
    if (match.isChess960 || match.isSetupChess || match.isFogOfWar || giveaway || atomic || duckChess || spellChess) return;
    const openingMatch = lookupOpening(fen);
    if (openingMatch) setOpeningName(openingMatch.name);
  }, [fen, match.isChess960, match.isSetupChess, match.isFogOfWar, giveaway, atomic, duckChess, spellChess]);

  // Wire up every server -> client event for this game once, for the lifetime of the screen.
  useEffect(() => {
    const socket = connectSocket(authToken);

    const handleOpponentMove = (payload: OpponentMovePayload) => {
      setFen(payload.fen);
      setTurn(payload.turn);
      setWhiteMs(payload.whiteMs);
      setBlackMs(payload.blackMs);
      if (match.isFogOfWar) setVisibleSquares(new Set(payload.visibleSquares ?? []));
      const duckBeforeOpponentMove = duckRef.current;
      if (duckChess && payload.duckSquare !== undefined) setDuckSquare(payload.duckSquare);
      const spellBeforeOpponentMove = spellRef.current;
      if (spellChess && payload.spellState !== undefined) setSpellState(payload.spellState);

      // Fog of War: the opponent's move might genuinely be outside this player's own visibility
      // (payload.from/to/san all omitted together in that case — see OpponentMovePayload's own
      // doc comment) — there's nothing to replay or show then, just the new (already redacted)
      // fen/turn/clocks/visibility above. A hidden move can never be a capture of one of MY OWN
      // pieces (any square holding my own piece is always part of my own visibility by rule, so
      // losing it is always revealed) — so `captured: undefined` here is always correct, not a
      // guess.
      if (match.isFogOfWar && payload.san === undefined) {
        setMoveList((list) => [...list, { move: { from: '', to: '', san: '?' }, mover: opponentColor, fenBefore: fenRef.current, fenAfter: payload.fen }]);
        logFogOfWarPly({
          ply: ++plyCounterRef.current,
          mover: opponentColor,
          san: '(hidden — server omitted it)',
          to: '(hidden)',
          perspectives: [{ label: `visibleTo(${myColor}, you)`, revealed: false, visible: new Set(payload.visibleSquares ?? []) }],
        });
        return;
      }

      // Replayed locally purely to learn what piece type (if any) this move captured — the
      // resulting position itself always comes from `payload.fen` below, never from this replay,
      // keeping the server as the sole authority on the actual game state. skipValidation is only
      // ever actually needed for Fog of War (a redacted fen can legitimately be missing a king).
      // Spell Chess: frozenSquares/jumpSquare/freezeEscapeActive for the replay below, derived exactly like the
      // server's own RoomManager.applyMove — through spellTurnContext, which reads the frozen squares from the state
      // BEFORE the opponent's cast (see its doc comment for the trap) and the check-waiver from the zone cast now.
      const spellTurnForOpponent = spellChess ? spellTurnContext(spellBeforeOpponentMove, opponentColor, payload.spell) : null;
      const spellFrozenForOpponent = spellTurnForOpponent?.frozenSquares ?? [];
      const spellJumpForOpponent = spellTurnForOpponent?.jumpSquare ?? null;
      const spellFreezeEscapeForOpponent = spellTurnForOpponent?.freezeZone
        ? checkIsWaivedByFreeze(new ChessEngine(fenRef.current, { skipValidation: true }), opponentColor, spellTurnForOpponent.freezeZone)
        : false;
      const replayEngine = new ChessEngine(fenRef.current, {
        chess960: match.isChess960,
        initialFen: match.fen,
        skipValidation: match.isFogOfWar || giveaway || duckChess || spellChess,
        giveaway,
        atomic,
        duckChess,
        duckSquare: duckBeforeOpponentMove,
        spellChess,
        frozenSquares: spellFrozenForOpponent,
        jumpSquare: spellJumpForOpponent,
        freezeEscapeActive: spellFreezeEscapeForOpponent,
      });
      const replayedMove =
        match.isFogOfWar || giveaway || duckChess
          ? replayEngine.movePseudoLegal(payload.from!, payload.to!, payload.promotion)
          : replayEngine.move(payload.from!, payload.to!, payload.promotion);
      // Duck Chess: the replay only knows the move; the duck's destination comes from the server. Spell Chess:
      // likewise, the cast (if any) rides along purely for display/notation (spellMoveNotation).
      const replayed =
        replayedMove && payload.duck
          ? { ...replayedMove, duck: payload.duck }
          : replayedMove && payload.spell
            ? { ...replayedMove, spell: payload.spell }
            : replayedMove;

      setLastMoveSan(
        duckChess && payload.duck
          ? duckMoveNotation({ san: payload.san!, duck: payload.duck })
          : spellChess
            ? spellMoveNotation({ san: payload.san! }, payload.spell ?? null)
            : payload.san!
      );
      playMoveSound(replayed);
      triggerMoveHaptics(replayed);
      if (match.isFogOfWar) {
        logFogOfWarPly({
          ply: ++plyCounterRef.current,
          mover: opponentColor,
          san: payload.san!,
          to: payload.to!,
          perspectives: [{ label: `visibleTo(${myColor}, you)`, revealed: true, visible: new Set(payload.visibleSquares ?? []) }],
        });
      }
      setMoveList((list) => [
        ...list,
        {
          // Falls back to a minimal synthetic Move if the local replay itself failed (an
          // extremely rare desync) — still enough to show the SAN in the move list; classifyMove
          // just won't be able to match it against the engine's best line for that one ply.
          move: replayed ?? {
            from: '',
            to: '',
            san: payload.san!,
            ...(payload.duck ? { duck: payload.duck } : {}),
            ...(payload.spell ? { spell: payload.spell } : {}),
          },
          mover: opponentColor,
          fenBefore: fenRef.current,
          fenAfter: payload.fen,
          ...(duckChess ? { duckSquare: payload.duckSquare ?? duckBeforeOpponentMove } : {}),
          ...(spellChess ? { spellState: payload.spellState ?? spellBeforeOpponentMove } : {}),
        },
      ]);
    };

    const handleGameOver = (payload: GameOverPayload) => {
      setGameOver(payload);
      setDrawOfferPending(false);
      setIncomingDrawOffer(false);
      setPremove(null);
      triggerGameEndHaptics();

      // Online opponents have no calibrated rating of their own to compare against, so this
      // uses the player's own current rating as the "opponent strength" (see updateRating's
      // doc comment) — a common simplifying assumption for a casual, non-competitive rating.
      const result = payload.winner === null ? 0.5 : payload.winner === myColor ? 1 : 0;
      const ratingCategory = toRatingCategory(categoryForInitialSeconds(match.timeControl.initialSeconds) ?? '');
      // Giveaway and Atomic are different games — they must not move the player's chess rating.
      if (ratingCategory && !giveaway && !atomic && !duckChess && !spellChess) recordRatedGame(ratingCategory, getRatings()[ratingCategory], result, authToken);

      if (result === 1 && wasMaterialDownRef.current && !giveaway && !atomic && !duckChess && !spellChess) unlockAchievement('comeback_win');
    };

    const handleDrawOffered = (_payload: DrawOfferedPayload) => {
      setIncomingDrawOffer(true);
    };

    const handleDrawDeclined = () => {
      setDrawOfferPending(false);
      setDrawNotice('Your draw offer was declined.');
    };

    const handleChatMessage = (payload: ChatMessagePayload) => {
      setChatMessages((msgs) => [...msgs, { from: 'opponent', text: payload.text }]);
      setChatUnread((n) => n + 1);
    };

    const handleOpponentDisconnected = (payload: { graceSeconds: number }) => {
      logDiagnostic(`[Multiplayer] opponent disconnected (room ${match.roomId}), grace period ${Math.round(payload.graceSeconds)}s`);
      setOpponentGraceSeconds(Math.round(payload.graceSeconds));
    };

    const handleOpponentReconnected = () => {
      logDiagnostic(`[Multiplayer] opponent reconnected (room ${match.roomId})`);
      setOpponentGraceSeconds(null);
    };

    const handleDisconnect = () => {
      logDiagnostic(`[Multiplayer] own connection dropped (room ${match.roomId})`);
      setConnectionState('reconnecting');
    };

    const handleReconnect = () => {
      logDiagnostic(`[Multiplayer] own connection restored, rejoining (room ${match.roomId})`);
      socket.emit(
        'rejoin_game',
        { roomId: match.roomId, playerToken: match.playerToken },
        (ack: Ack<{ state: RejoinStatePayload }>) => {
          logDiagnostic(`[Multiplayer] rejoin_game ${ack.ok ? 'succeeded' : `failed: ${ack.error}`} (room ${match.roomId})`);
          if (ack.ok) {
            setFen(ack.state.fen);
            setTurn(ack.state.turn);
            setWhiteMs(ack.state.whiteMs);
            setBlackMs(ack.state.blackMs);
            setConnectionState('connected');
            setViewIndex(null);
            if (match.isFogOfWar) setVisibleSquares(new Set(ack.state.visibleSquares ?? []));
            if (duckChess) setDuckSquare(ack.state.duckSquare ?? null);
            if (spellChess) setSpellState(ack.state.spellState ?? initialSpellChessState());

            // Rebuild the full move list (and with it, captured pieces) from scratch — we may
            // have missed one or more opponent_move events entirely while disconnected, so
            // patching the existing list wouldn't be reliable.
            const replayEngine = new ChessEngine(match.fen, {
              chess960: match.isChess960,
              initialFen: match.fen,
              skipValidation: match.isFogOfWar || giveaway || duckChess,
              giveaway,
              atomic,
            });
            const rebuilt: MoveRecord[] = [];
            // Duck Chess: the duck's square is not part of the engine's state, so each ply is replayed on a fresh
            // engine built from the running { fen, duck } pair (the duck moves with every turn).
            let replayFen = match.fen;
            let replayDuck: string | null = null;
            // Spell Chess: likewise not part of the engine's state (charges/cooldowns/pending effects), so each
            // ply is replayed on a fresh engine built from the running SpellChessState (which also carries the
            // frozenSquares/jumpSquare/freezeEscapeActive that ply's own move needed to be legal — see
            // handleOpponentMove's identical derivation above).
            let replaySpellState: SpellChessState = initialSpellChessState();
            // Fog of War only — a move this player never witnessed (see RejoinStatePayload's own
            // doc comment) can't be replayed at all (no from/to to replay with), which permanently
            // desyncs `replayEngine` from the true position from that point on. Rather than guess,
            // this stops attempting real replay the moment that happens and just stamps every
            // remaining entry with the last position actually known to be correct — a stale (but
            // still genuinely real, previously-redacted) fen, never a fabricated or leaked one.
            let replayBroken = false;
            ack.state.moves.forEach((m, i) => {
              const mover: PieceColor = i % 2 === 0 ? 'w' : 'b';
              const fenBefore = duckChess ? replayFen : replayEngine.getFen();

              if (!m.san || replayBroken) {
                replayBroken = true;
                rebuilt.push({ move: { from: m.from ?? '', to: m.to ?? '', san: m.san ?? '?' }, mover, fenBefore, fenAfter: fenBefore });
                return;
              }

              if (duckChess) {
                const stepEngine = new ChessEngine(replayFen, { chess960: match.isChess960, initialFen: match.fen, skipValidation: true, duckChess: true, duckSquare: replayDuck });
                const stepped = stepEngine.movePseudoLegal(m.from!, m.to!, m.promotion as Move['promotion']);
                if (stepped) {
                  replayFen = stepEngine.getFen();
                  if (m.duck) replayDuck = m.duck;
                  rebuilt.push({ move: m.duck ? { ...stepped, duck: m.duck } : stepped, mover, fenBefore, fenAfter: replayFen, duckSquare: replayDuck });
                }
                return;
              }

              if (spellChess) {
                const { stateAfterCast, frozenSquares, jumpSquare, freezeZone } = spellTurnContext(replaySpellState, mover, m.spell);
                const freezeEscapeActive = freezeZone ? checkIsWaivedByFreeze(new ChessEngine(replayFen, { skipValidation: true }), mover, freezeZone) : false;
                const stepEngine = new ChessEngine(replayFen, {
                  chess960: match.isChess960,
                  initialFen: match.fen,
                  skipValidation: true,
                  spellChess: true,
                  frozenSquares,
                  jumpSquare,
                  freezeEscapeActive,
                });
                const stepped = stepEngine.move(m.from!, m.to!, m.promotion as Move['promotion']);
                if (stepped) {
                  replayFen = stepEngine.getFen();
                  replaySpellState = afterSpellChessMove(stateAfterCast, mover);
                  rebuilt.push({ move: m.spell ? { ...stepped, spell: m.spell } : stepped, mover, fenBefore, fenAfter: replayFen, spellState: replaySpellState });
                }
                return;
              }

              const result =
                match.isFogOfWar || giveaway
                  ? replayEngine.movePseudoLegal(m.from!, m.to!, m.promotion as Move['promotion'])
                  : replayEngine.move(m.from!, m.to!, m.promotion as Move['promotion']);
              if (result) {
                rebuilt.push({ move: result, mover, fenBefore, fenAfter: replayEngine.getFen() });
              } else if (match.isFogOfWar) {
                replayBroken = true;
                rebuilt.push({ move: { from: m.from!, to: m.to!, san: m.san! }, mover, fenBefore, fenAfter: fenBefore });
              }
            });
            setMoveList(rebuilt);
            if (rebuilt.length > 0) {
              const lastRebuilt = rebuilt[rebuilt.length - 1].move;
              setLastMoveSan(
                duckChess ? duckMoveNotation(lastRebuilt) : spellChess ? spellMoveNotation(lastRebuilt, lastRebuilt.spell ?? null) : lastRebuilt.san
              );
            }
          }
          // If it failed (e.g. the game already ended while we were offline), leave
          // connectionState as "reconnecting" — a game_over we missed would already be
          // undeliverable at this point since the room is gone; nothing more to reconcile.
        }
      );
    };

    socket.on('opponent_move', handleOpponentMove);
    socket.on('game_over', handleGameOver);
    socket.on('opponent_disconnected', handleOpponentDisconnected);
    socket.on('opponent_reconnected', handleOpponentReconnected);
    socket.on('disconnect', handleDisconnect);
    socket.io.on('reconnect', handleReconnect);
    socket.on('draw_offered', handleDrawOffered);
    socket.on('draw_declined', handleDrawDeclined);
    socket.on('chat_message', handleChatMessage);

    return () => {
      socket.off('opponent_move', handleOpponentMove);
      socket.off('game_over', handleGameOver);
      socket.off('opponent_disconnected', handleOpponentDisconnected);
      socket.off('opponent_reconnected', handleOpponentReconnected);
      socket.off('disconnect', handleDisconnect);
      socket.io.off('reconnect', handleReconnect);
      socket.off('draw_offered', handleDrawOffered);
      socket.off('draw_declined', handleDrawDeclined);
      socket.off('chat_message', handleChatMessage);
    };
  }, [authToken, match.roomId, match.playerToken, opponentColor]);

  // Cosmetic-only countdown of the grace period we were told about — purely a display aid;
  // the server alone decides if/when an actual abandonment game_over fires.
  useEffect(() => {
    if (opponentGraceSeconds === null || opponentGraceSeconds <= 0) return;
    const timer = setTimeout(() => setOpponentGraceSeconds((s) => (s !== null ? Math.max(0, s - 1) : null)), 1000);
    return () => clearTimeout(timer);
  }, [opponentGraceSeconds]);

  const isMyTurn = turn === myColor && !gameOver;

  // Memoized — passed straight through to ChessBoard (now React.memo'd), so a reference that
  // changes every render (as a plain inline function would) would force the whole board to
  // re-render every time the cosmetic per-second display clock ticks, regardless of whether the
  // position actually changed.
  const handleMove = useCallback(
    (move: Move, newFen: string) => {
      if (gameOver || turn !== myColor || connectionState !== 'connected' || viewIndex !== null) return;

      const fenBeforeMove = fen; // closure snapshot, for reverting if the server disagrees
      const visibleSquaresBeforeMove = visibleSquares;
      const duckBeforeMove = duckSquare;
      const spellStateBeforeMove = spellState;
      setMoveError(null);
      setFen(newFen);
      setTurn(opponentColor); // optimistic — the ack below confirms/corrects this
      // Duck Chess: ChessBoard hands over the whole turn — the move already carries where the duck went (nothing
      // when the move captured a king, which ends the game with no placement).
      if (duckChess) setDuckSquare(move.duck ?? duckSquare);
      // Spell Chess: likewise, ChessBoard hands over the whole turn — the move already carries the cast (if any)
      // via move.spell. Mirrors LocalGameScreen's identical cast-then-afterSpellChessMove sequence.
      const spellStateAfterMove = spellChess
        ? afterSpellChessMove(
            move.spell
              ? move.spell.type === 'freeze'
                ? castFreeze(spellState, myColor, move.spell.center)
                : castJump(spellState, myColor, move.spell.square)
              : spellState,
            myColor
          )
        : spellState;
      if (spellChess) setSpellState(spellStateAfterMove);
      setLastMoveSan(duckChess ? duckMoveNotation(move) : spellChess ? spellMoveNotation(move, move.spell ?? null) : move.san);
      playMoveSound(move);
      triggerMoveHaptics(move);
      setMoveList((list) => [
        ...list,
        {
          move,
          mover: myColor,
          fenBefore: fenBeforeMove,
          fenAfter: newFen,
          ...(duckChess ? { duckSquare: move.duck ?? duckSquare } : {}),
          ...(spellChess ? { spellState: spellStateAfterMove } : {}),
        },
      ]);
      // Fog of War: computed straight from `newFen` — ChessBoard already built it via this same
      // player's own movePseudoLegal, and a player's own pseudo-legal move generation never depends
      // on currently-invisible information (see fogOfWar.ts), so this is just as correct as waiting
      // for the server's ack — done here purely so the board's fog doesn't visibly lag a beat.
      if (match.isFogOfWar) {
        const visibleNow = getVisibleSquares(new ChessEngine(newFen, { skipValidation: true }), myColor);
        setVisibleSquares(visibleNow);
        logFogOfWarPly({
          ply: ++plyCounterRef.current,
          mover: myColor,
          san: move.san,
          to: move.to,
          perspectives: [{ label: `visibleTo(${myColor}, you)`, revealed: true, visible: visibleNow }],
        });
      }

      const socket = connectSocket(authToken);
      socket
        .timeout(8000)
        .emit(
          'make_move',
          {
            roomId: match.roomId,
            from: move.from,
            to: move.to,
            promotion: move.promotion,
            ...(duckChess && move.duck ? { duckTo: move.duck } : {}),
            ...(spellChess && move.spell ? { spell: move.spell } : {}),
          },
          (
            err: unknown,
            ack?: Ack<{
              fen: string;
              san: string;
              turn: PieceColor;
              whiteMs: number;
              blackMs: number;
              visibleSquares?: string[];
              duckSquare?: string | null;
              spellState?: SpellChessState;
            }>
          ) => {
            if (err || !ack || !ack.ok) {
              // The server disagreed with a move our own board thought was legal — extremely
              // rare (a desync, e.g. after a missed event during a reconnect), but never just
              // trust the optimistic update in that case: revert to the position before it.
              logDiagnostic(
                `[Multiplayer] make_move rejected (room ${match.roomId}): ${move.from}-${move.to} | ${
                  ack && !ack.ok ? ack.error : err ? String(err) : 'no ack'
                } | fenBefore=${fenBeforeMove}`
              );
              setMoveError(ack && !ack.ok ? ack.error : 'The move was not confirmed by the server.');
              setFen(fenBeforeMove);
              setTurn(myColor);
              if (duckChess) setDuckSquare(duckBeforeMove);
              if (spellChess) setSpellState(spellStateBeforeMove);
              setMoveList((list) => list.slice(0, -1));
              setBoardKey((k) => k + 1);
              if (match.isFogOfWar) setVisibleSquares(visibleSquaresBeforeMove);
              return;
            }
            setFen(ack.fen);
            setTurn(ack.turn);
            setWhiteMs(ack.whiteMs);
            setBlackMs(ack.blackMs);
            if (match.isFogOfWar) setVisibleSquares(new Set(ack.visibleSquares ?? []));
            if (duckChess && ack.duckSquare !== undefined) setDuckSquare(ack.duckSquare);
            if (spellChess && ack.spellState !== undefined) setSpellState(ack.spellState);
          }
        );
    },
    [gameOver, turn, myColor, connectionState, viewIndex, fen, visibleSquares, opponentColor, match, authToken, duckChess, duckSquare, spellChess, spellState]
  );

  // Premove: queued while it's the opponent's turn (see ChessBoard's premoveColor/onPremove),
  // executed the instant it actually becomes this player's turn — reusing handleMove exactly as
  // if the player had just made that move themselves, so the ack/optimistic-update/desync-revert
  // logic above doesn't need a second copy for this path.
  const [premove, setPremove] = useState<PremoveIntent | null>(null);

  // Memoized for the same reason as handleMove above — also passed straight to ChessBoard.
  const handleQueuePremove = useCallback((intent: PremoveIntent) => {
    setPremove(intent);
    setPremoveInvalidNotice(false);
  }, []);

  const handleCancelPremove = () => {
    setPremove(null);
    setPremoveInvalidNotice(false);
  };

  const [premoveInvalidNotice, setPremoveInvalidNotice] = useState(false);

  useEffect(() => {
    if (!premove || turn !== myColor || gameOver) return;
    setPremove(null);
    const premoveEngine = new ChessEngine(fen, { chess960: match.isChess960, initialFen: match.fen, skipValidation: match.isFogOfWar });
    const move = match.isFogOfWar
      ? premoveEngine.movePseudoLegal(premove.from, premove.to, premove.promotion)
      : premoveEngine.move(premove.from, premove.to, premove.promotion);
    if (move) {
      handleMove(move, premoveEngine.getFen());
    } else {
      setPremoveInvalidNotice(true);
    }
    // fen/myColor/match/handleMove are all stable-enough-in-practice for this screen's lifetime
    // (handleMove is redefined each render but always does the same thing); turn is what actually
    // gates this, and premove is what it's acting on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, premove]);

  const handleExit = () => {
    if (!keepSocketAlive) disconnectSocket();
    onExit();
  };

  const handleResign = () => {
    if (gameOver) return;
    setShowOptions(false);
    appAlert('Resign?', 'This ends the game as a loss.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Resign',
        style: 'destructive',
        onPress: () => {
          const socket = connectSocket(authToken);
          socket.emit('resign', { roomId: match.roomId }, (ack: Ack) => {
            if (!ack.ok) setMoveError(ack.error);
          });
        },
      },
    ]);
  };

  const handleRequestDraw = () => {
    if (gameOver || drawOfferPending) return;
    setShowOptions(false);
    setDrawNotice(null);
    const socket = connectSocket(authToken);
    socket.emit('offer_draw', { roomId: match.roomId }, (ack: Ack) => {
      if (!ack.ok) {
        setDrawNotice(ack.error);
        return;
      }
      setDrawOfferPending(true);
    });
  };

  const handleRespondDraw = (accept: boolean) => {
    setIncomingDrawOffer(false);
    const socket = connectSocket(authToken);
    socket.emit('respond_draw', { roomId: match.roomId, accept }, (ack: Ack) => {
      if (!ack.ok) setDrawNotice(ack.error);
    });
  };

  const handleSendChat = () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput('');
    setChatMessages((msgs) => [...msgs, { from: 'me', text }]);
    const socket = connectSocket(authToken);
    socket.emit('send_chat', { roomId: match.roomId, text }, (ack: Ack) => {
      if (!ack.ok) console.log('[OnlineGame] chat send failed:', ack.error);
    });
  };

  // Back/Forward step through past positions purely for local review — they never touch `fen`
  // (the live/authoritative position) or emit anything to the server. `positions[0]` is the
  // starting position, `positions[i]` is the position right after the i-th played move.
  const positions = useMemo(() => [match.fen, ...moveList.map((m) => m.fenAfter)], [match.fen, moveList]);
  const isReviewing = viewIndex !== null;
  const displayFen = isReviewing ? positions[viewIndex as number] : fen;
  const canGoBack = (isReviewing ? (viewIndex as number) : positions.length - 1) > 0;
  const canGoForward = isReviewing;

  const handleBack = () => {
    const current = isReviewing ? (viewIndex as number) : positions.length - 1;
    if (current <= 0) return;
    setViewIndex(current - 1);
  };

  const handleForward = () => {
    if (!isReviewing) return;
    const next = (viewIndex as number) + 1;
    setViewIndex(next >= positions.length - 1 ? null : next);
  };

  const selectedMoveIndex = isReviewing ? (viewIndex as number) - 1 : moveList.length - 1;
  // Duck Chess: where the duck stood in the position being DISPLAYED (position 0 = the start, with no duck yet).
  const displayDuck = duckChess ? (isReviewing ? (viewIndex === 0 ? null : moveList[(viewIndex as number) - 1]?.duckSquare ?? null) : duckSquare) : null;
  // Spell Chess: the state feeding ChessBoard's frozenSquares/jumpSquare for the position currently displayed
  // — mirrors displayDuck above (and LocalGameScreen's identical displaySpellState).
  const displaySpellState = spellChess
    ? isReviewing
      ? viewIndex === 0
        ? initialSpellChessState()
        : moveList[(viewIndex as number) - 1]?.spellState ?? initialSpellChessState()
      : spellState
    : initialSpellChessState();
  const displayLastMove = selectedMoveIndex >= 0 ? moveList[selectedMoveIndex].move : null;

  // Tapping a move in the strip drives the exact same viewIndex the Back/Forward buttons do —
  // no separate navigation mechanism.
  const handleSelectMove = (index: number) => {
    const next = index + 1;
    setViewIndex(next >= positions.length - 1 ? null : next);
  };

  const { whiteCaptured, blackCaptured } = useMemo(
    () => computeCapturedMaterial(moveList.map((m) => ({ captured: m.move.captured, exploded: m.move.exploded, moverColor: m.mover }))),
    [moveList]
  );
  const materialDiff = materialValue(whiteCaptured) - materialValue(blackCaptured);
  const myCaptured = myColor === 'w' ? whiteCaptured : blackCaptured;
  const opponentCaptured = myColor === 'w' ? blackCaptured : whiteCaptured;
  const myAdvantage = myColor === 'w' ? (materialDiff > 0 ? materialDiff : 0) : (materialDiff < 0 ? -materialDiff : 0);
  const opponentAdvantage = myColor === 'w' ? (materialDiff < 0 ? -materialDiff : 0) : (materialDiff > 0 ? materialDiff : 0);

  // For the 'comeback_win' achievement — checked in handleGameOver.
  useEffect(() => {
    if (opponentAdvantage >= 3) wasMaterialDownRef.current = true;
  }, [opponentAdvantage]);

  const myName = 'You';
  const opponentName = 'Opponent';
  const myMs = myColor === 'w' ? displayWhiteMs : displayBlackMs;
  const opponentMs = myColor === 'w' ? displayBlackMs : displayWhiteMs;
  // Purely a display aid, derived from the same synced move list used everywhere else on this
  // screen — who actually WINS by reaching three checks is decided authoritatively by the server
  // (see handleGameOver's `gameOver.reason === 'threeCheck'`), never by this count.
  const checkCounts = match.isThreeCheck ? getThreeCheckCounts(moveList.map((m) => m.move)) : null;

  // Giveaway: tell a player who finds only some pieces movable why (a capture is mandatory this turn).
  const mustCapture = useMemo(
    () => giveaway && isMyTurn && getGiveawayMoves(new ChessEngine(fen, { skipValidation: true, giveaway: true })).some((m) => m.captured),
    [giveaway, isMyTurn, fen]
  );
  let statusText = isMyTurn ? (mustCapture ? 'Your turn — must capture' : placingDuck ? 'Your turn — place the duck 🦆' : 'Your turn') : `${opponentName}'s turn`;
  if (connectionState === 'reconnecting') statusText = 'Reconnecting...';

  const summaryTitle = !gameOver ? '' : gameOver.winner === null ? 'Draw' : gameOver.winner === myColor ? 'You Won' : 'You Lost';
  const summarySubtitle = gameOver ? describeEndReason(gameOver.reason) : '';

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Online Game"
        subtitle={
          match.isChess960
            ? 'Chess960'
            : match.isKingOfTheHill
              ? 'King of the Hill'
              : match.isThreeCheck
                ? 'Three-Check'
                : match.isSetupChess
                  ? 'Setup Chess'
                  : match.isFogOfWar
                    ? 'Fog of War'
                    : giveaway
                      ? 'Giveaway'
                      : atomic
                        ? 'Atomic'
                        : duckChess
                          ? 'Duck Chess'
                          : spellChess
                            ? 'Spell Chess'
                            : undefined
        }
        onBack={handleExit}
        backLabel="‹ Menu"
      />
      <MoveListStrip
        moves={moveList.map((m) => ({ san: duckChess ? duckMoveNotation(m.move) : spellChess ? spellMoveNotation(m.move, m.move.spell ?? null) : m.move.san }))}
        selectedIndex={selectedMoveIndex}
        autoScroll={!isReviewing}
        onSelectMove={handleSelectMove}
      />
      <GameScreenBody
        compact={spellChess}
        bottomBar={
          <>
            <View style={styles.controlsWrap}>
              <GameControlBar
                items={[
                  { key: 'options', label: 'More', onPress: () => setShowOptions((v) => !v), active: showOptions },
                  {
                    key: 'chat',
                    label: chatUnread > 0 ? `Chat (${chatUnread})` : 'Chat',
                    onPress: () => setChatOpen((v) => !v),
                    active: chatOpen,
                  },
                  { key: 'back', label: '‹ Back', onPress: handleBack, disabled: !canGoBack },
                  { key: 'forward', label: 'Forward ›', onPress: handleForward, disabled: !canGoForward },
                ]}
              />
              <GameOptionsMenu
                visible={showOptions}
                items={[
                  { label: 'Request Draw', onPress: handleRequestDraw, disabled: !!gameOver || drawOfferPending },
                  { label: 'Resign', onPress: handleResign, destructive: true, disabled: !!gameOver },
                ]}
              />
            </View>

            <View style={styles.footer}>
              {lastMoveSan && <Text style={styles.lastMove}>Last move: {lastMoveSan}</Text>}
            </View>
          </>
        }
      >
        {connectionState === 'reconnecting' && (
          <Text style={styles.warningBanner}>Connection lost — trying to reconnect...</Text>
        )}
        {opponentGraceSeconds !== null && (
          <Text style={styles.warningBanner}>
            Your opponent disconnected — if they don't reconnect in {opponentGraceSeconds}s you'll win automatically.
          </Text>
        )}
        {moveError && <Text style={styles.errorBanner}>{moveError}</Text>}
        {drawNotice && <Text style={styles.errorBanner}>{drawNotice}</Text>}
        {premoveInvalidNotice && <Text style={styles.errorBanner}>Premove was no longer legal — cancelled.</Text>}
        {premove && !isMyTurn && (
          <View style={styles.drawOfferRow}>
            <Text style={styles.warningBanner}>
              Premove queued: {premove.from}-{premove.to}
            </Text>
            <Pressable style={styles.drawDeclineButton} onPress={handleCancelPremove}>
              <Text style={styles.drawButtonText}>Cancel</Text>
            </Pressable>
          </View>
        )}
        {drawOfferPending && !gameOver && (
          <Text style={styles.warningBanner}>Draw offer sent — waiting for opponent...</Text>
        )}
        {incomingDrawOffer && !gameOver && (
          <View style={styles.drawOfferRow}>
            <Text style={styles.warningBanner}>Your opponent offers a draw.</Text>
            <View style={styles.drawOfferButtons}>
              <Pressable style={styles.drawAcceptButton} onPress={() => handleRespondDraw(true)}>
                <Text style={styles.drawButtonText}>Accept</Text>
              </Pressable>
              <Pressable style={styles.drawDeclineButton} onPress={() => handleRespondDraw(false)}>
                <Text style={styles.drawButtonText}>Decline</Text>
              </Pressable>
            </View>
          </View>
        )}

        {!gameOver && <Text style={styles.status}>{statusText}</Text>}
        {isReviewing && <Text style={styles.reviewingText}>Reviewing move history (not live)</Text>}

        <View style={styles.playerRow}>
          <Text style={[styles.clock, turn === opponentColor && !gameOver && styles.clockActive]}>
            {playerClockText(opponentName, opponentMs, match.timeControl.initialSeconds)}
            {checkCounts ? ` · Checks: ${checkCounts[opponentColor]}/${THREE_CHECK_TARGET}` : ''}
          </Text>
          <CapturedPieces pieces={opponentCaptured} color={myColor} advantage={opponentAdvantage} />
        </View>

        {!match.isChess960 && !match.isSetupChess && !match.isFogOfWar && !giveaway && !atomic && !duckChess && !spellChess && openingName && <Text style={styles.openingName}>{openingName}</Text>}

        <ChessBoard
          key={boardKey}
          fen={displayFen}
          onMove={handleMove}
          disabled={!!gameOver || connectionState !== 'connected' || isReviewing}
          chess960={match.isChess960}
          initialFen={match.fen}
          orientation={myColor}
          lastMove={displayLastMove}
          kingOfTheHill={match.isKingOfTheHill}
          fogOfWar={match.isFogOfWar}
          giveaway={giveaway}
          atomic={atomic}
          duckChess={duckChess}
          duckSquare={displayDuck}
          onDuckPlacementChange={setPlacingDuck}
          spellChess={spellChess}
          spellState={displaySpellState}
          visibleSquares={visibleSquares}
          // No premoves in Giveaway, Atomic or Spell Chess: mandatory capture / explosions / a possible cast
          // change which moves are legal after the opponent's reply, so a queued move is almost never still
          // valid when its turn comes.
          premoveColor={giveaway || atomic || duckChess || spellChess ? undefined : myColor}
          onPremove={giveaway || atomic || duckChess || spellChess ? undefined : handleQueuePremove}
        />

        <View style={styles.playerRow}>
          <Text style={[styles.clock, turn === myColor && !gameOver && styles.clockActive]}>
            {playerClockText(myName, myMs, match.timeControl.initialSeconds)}
            {checkCounts ? ` · Checks: ${checkCounts[myColor]}/${THREE_CHECK_TARGET}` : ''}
          </Text>
          <CapturedPieces pieces={myCaptured} color={opponentColor} advantage={myAdvantage} />
        </View>

        {chatOpen && (
          <View style={styles.chatPanel}>
            <ScrollView style={styles.chatMessages} contentContainerStyle={styles.chatMessagesContent}>
              {chatMessages.length === 0 && <Text style={styles.chatEmptyText}>No messages yet.</Text>}
              {chatMessages.map((m, i) => (
                <Text key={i} style={[styles.chatMessage, m.from === 'me' && styles.chatMessageMine]}>
                  {m.from === 'me' ? 'You' : opponentName}: {m.text}
                </Text>
              ))}
            </ScrollView>
            <View style={styles.chatInputRow}>
              <TextInput
                style={styles.chatInput}
                value={chatInput}
                onChangeText={setChatInput}
                placeholder="Message opponent..."
                placeholderTextColor={colors.textMuted}
                onSubmitEditing={handleSendChat}
                returnKeyType="send"
              />
              <Pressable style={styles.chatSendButton} onPress={handleSendChat}>
                <Text style={styles.chatButtonText}>Send</Text>
              </Pressable>
            </View>
          </View>
        )}
      </GameScreenBody>

      <PostGameSummaryModal
        visible={!!gameOver}
        title={summaryTitle}
        subtitle={summarySubtitle}
        initialFen={match.fen}
        chess960={match.isChess960}
        fogOfWar={match.isFogOfWar}
        giveaway={giveaway}
        atomic={atomic}
        duckChess={duckChess}
        spellChess={spellChess}
        history={moveList}
        players={[{ label: 'You', color: myColor }]}
        onGameReview={() => onAnalyze({ initialFen: match.fen, chess960: match.isChess960, fogOfWar: match.isFogOfWar, history: moveList })}
        onNewGame={handleExit}
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
  warningBanner: {
    fontSize: 13,
    color: colors.mode === 'dark' ? '#e0c34a' : '#8d6e00',
    backgroundColor: colors.mode === 'dark' ? '#3a3120' : '#fff3cd',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    textAlign: 'center',
    maxWidth: 320,
  },
  errorBanner: {
    fontSize: 13,
    color: colors.danger,
    textAlign: 'center',
    maxWidth: 320,
  },
  status: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '600',
  },
  openingName: {
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 320,
  },
  playerRow: {
    flexDirection: 'row',
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
    marginTop: 8,
    alignItems: 'center',
    gap: 8,
  },
  lastMove: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  reviewingText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.gold,
  },
  controlsWrap: {
    alignItems: 'center',
    gap: 8,
  },
  drawOfferRow: {
    alignItems: 'center',
    gap: 6,
  },
  drawOfferButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  drawAcceptButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    backgroundColor: colors.accent,
    borderRadius: 6,
  },
  drawDeclineButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    backgroundColor: colors.danger,
    borderRadius: 6,
  },
  drawButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  chatPanel: {
    width: '90%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 8,
    gap: 8,
  },
  chatMessages: {
    maxHeight: 90,
  },
  chatMessagesContent: {
    gap: 4,
  },
  chatEmptyText: {
    fontSize: 13,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  chatMessage: {
    fontSize: 13,
    color: colors.text,
  },
  chatMessageMine: {
    color: colors.text,
    fontWeight: '600',
  },
  chatInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 13,
    color: colors.text,
  },
  chatSendButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: colors.buttonBackground,
    borderRadius: 6,
    justifyContent: 'center',
  },
  chatButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  });
}
