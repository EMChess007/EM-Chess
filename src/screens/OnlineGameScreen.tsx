import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { connectSocket, disconnectSocket } from '../api/socket';
import { appAlert } from '../components/AppAlert';
import CapturedPieces from '../components/CapturedPieces';
import ChessBoard from '../components/ChessBoard';
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
import { triggerGameEndHaptics, triggerMoveHaptics } from '../logic/haptics';
import { computeCapturedMaterial, materialValue } from '../logic/material';
import { playMoveSound } from '../logic/moveSounds';
import { lookupOpening } from '../logic/openings';
import { toRatingCategory } from '../logic/rating';
import { getRatings, recordRatedGame } from '../logic/ratingStorage';
import { categoryForInitialSeconds } from '../logic/timeControls';
import { formatTime } from '../logic/time';
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

export default function OnlineGameScreen({ authToken, match, onExit, onAnalyze }: OnlineGameScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const myColor = match.color;
  const opponentColor: PieceColor = myColor === 'w' ? 'b' : 'w';

  const [fen, setFen] = useState(match.fen);
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
    if (gameOver || connectionState !== 'connected') return;
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

  // Reacts to `fen` changing for any reason (our own move, the opponent's move, or a rejoin
  // state sync after reconnecting) rather than being threaded through each individual handler
  // below. See LocalGameScreen's identical effect for why a miss here doesn't clear the name.
  useEffect(() => {
    if (match.isChess960) return;
    const openingMatch = lookupOpening(fen);
    if (openingMatch) setOpeningName(openingMatch.name);
  }, [fen, match.isChess960]);

  // Wire up every server -> client event for this game once, for the lifetime of the screen.
  useEffect(() => {
    const socket = connectSocket(authToken);

    const handleOpponentMove = (payload: OpponentMovePayload) => {
      // Replayed locally purely to learn what piece type (if any) this move captured — the
      // resulting position itself always comes from `payload.fen` below, never from this replay,
      // keeping the server as the sole authority on the actual game state.
      const replayEngine = new ChessEngine(fenRef.current, { chess960: match.isChess960, initialFen: match.fen });
      const replayed = replayEngine.move(payload.from, payload.to, payload.promotion);

      setFen(payload.fen);
      setTurn(payload.turn);
      setWhiteMs(payload.whiteMs);
      setBlackMs(payload.blackMs);
      setLastMoveSan(payload.san);
      playMoveSound(replayed);
      triggerMoveHaptics(replayed);
      setMoveList((list) => [
        ...list,
        {
          // Falls back to a minimal synthetic Move if the local replay itself failed (an
          // extremely rare desync) — still enough to show the SAN in the move list; classifyMove
          // just won't be able to match it against the engine's best line for that one ply.
          move: replayed ?? { from: '', to: '', san: payload.san },
          mover: opponentColor,
          fenBefore: fenRef.current,
          fenAfter: payload.fen,
        },
      ]);
    };

    const handleGameOver = (payload: GameOverPayload) => {
      setGameOver(payload);
      setDrawOfferPending(false);
      setIncomingDrawOffer(false);
      triggerGameEndHaptics();

      // Online opponents have no calibrated rating of their own to compare against, so this
      // uses the player's own current rating as the "opponent strength" (see updateRating's
      // doc comment) — a common simplifying assumption for a casual, non-competitive rating.
      const result = payload.winner === null ? 0.5 : payload.winner === myColor ? 1 : 0;
      const ratingCategory = toRatingCategory(categoryForInitialSeconds(match.timeControl.initialSeconds) ?? '');
      if (ratingCategory) recordRatedGame(ratingCategory, getRatings()[ratingCategory], result);

      if (result === 1 && wasMaterialDownRef.current) unlockAchievement('comeback_win');
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
      setOpponentGraceSeconds(Math.round(payload.graceSeconds));
    };

    const handleOpponentReconnected = () => {
      setOpponentGraceSeconds(null);
    };

    const handleDisconnect = () => {
      setConnectionState('reconnecting');
    };

    const handleReconnect = () => {
      socket.emit(
        'rejoin_game',
        { roomId: match.roomId, playerToken: match.playerToken },
        (ack: Ack<{ state: RejoinStatePayload }>) => {
          if (ack.ok) {
            setFen(ack.state.fen);
            setTurn(ack.state.turn);
            setWhiteMs(ack.state.whiteMs);
            setBlackMs(ack.state.blackMs);
            setConnectionState('connected');
            setViewIndex(null);

            // Rebuild the full move list (and with it, captured pieces) from scratch — we may
            // have missed one or more opponent_move events entirely while disconnected, so
            // patching the existing list wouldn't be reliable.
            const replayEngine = new ChessEngine(match.fen, { chess960: match.isChess960, initialFen: match.fen });
            const rebuilt: MoveRecord[] = [];
            ack.state.moves.forEach((m, i) => {
              const fenBefore = replayEngine.getFen();
              const result = replayEngine.move(m.from, m.to, m.promotion as Move['promotion']);
              if (result) {
                rebuilt.push({
                  move: result,
                  mover: i % 2 === 0 ? 'w' : 'b',
                  fenBefore,
                  fenAfter: replayEngine.getFen(),
                });
              }
            });
            setMoveList(rebuilt);
            if (rebuilt.length > 0) setLastMoveSan(rebuilt[rebuilt.length - 1].move.san);
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

  const handleMove = (move: Move, newFen: string) => {
    if (gameOver || turn !== myColor || connectionState !== 'connected' || viewIndex !== null) return;

    const fenBeforeMove = fen; // closure snapshot, for reverting if the server disagrees
    setMoveError(null);
    setFen(newFen);
    setTurn(opponentColor); // optimistic — the ack below confirms/corrects this
    setLastMoveSan(move.san);
    playMoveSound(move);
    triggerMoveHaptics(move);
    setMoveList((list) => [...list, { move, mover: myColor, fenBefore: fenBeforeMove, fenAfter: newFen }]);

    const socket = connectSocket(authToken);
    socket
      .timeout(8000)
      .emit(
        'make_move',
        { roomId: match.roomId, from: move.from, to: move.to, promotion: move.promotion },
        (err: unknown, ack?: Ack<{ fen: string; san: string; turn: PieceColor; whiteMs: number; blackMs: number }>) => {
          if (err || !ack || !ack.ok) {
            // The server disagreed with a move our own board thought was legal — extremely
            // rare (a desync, e.g. after a missed event during a reconnect), but never just
            // trust the optimistic update in that case: revert to the position before it.
            setMoveError(ack && !ack.ok ? ack.error : 'The move was not confirmed by the server.');
            setFen(fenBeforeMove);
            setTurn(myColor);
            setMoveList((list) => list.slice(0, -1));
            setBoardKey((k) => k + 1);
            return;
          }
          setFen(ack.fen);
          setTurn(ack.turn);
          setWhiteMs(ack.whiteMs);
          setBlackMs(ack.blackMs);
        }
      );
  };

  const handleExit = () => {
    disconnectSocket();
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
  const displayLastMove = selectedMoveIndex >= 0 ? moveList[selectedMoveIndex].move : null;

  // Tapping a move in the strip drives the exact same viewIndex the Back/Forward buttons do —
  // no separate navigation mechanism.
  const handleSelectMove = (index: number) => {
    const next = index + 1;
    setViewIndex(next >= positions.length - 1 ? null : next);
  };

  const { whiteCaptured, blackCaptured } = useMemo(
    () => computeCapturedMaterial(moveList.map((m) => ({ captured: m.move.captured, moverColor: m.mover }))),
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

  let statusText = isMyTurn ? 'Your turn' : `${opponentName}'s turn`;
  if (connectionState === 'reconnecting') statusText = 'Reconnecting...';

  const summaryTitle = !gameOver ? '' : gameOver.winner === null ? 'Draw' : gameOver.winner === myColor ? 'You Won' : 'You Lost';
  const summarySubtitle = gameOver ? describeEndReason(gameOver.reason) : '';

  return (
    <View style={styles.container}>
      <ScreenHeader title={`Online Game${match.isChess960 ? ' (Chess960)' : ''}`} onBack={handleExit} backLabel="‹ Menu" />
      <MoveListStrip
        moves={moveList.map((m) => ({ san: m.move.san }))}
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
            {opponentName}: {formatTime(opponentMs / 1000)}
          </Text>
          <CapturedPieces pieces={opponentCaptured} color={myColor} advantage={opponentAdvantage} />
        </View>

        {!match.isChess960 && openingName && <Text style={styles.openingName}>{openingName}</Text>}

        <ChessBoard
          key={boardKey}
          fen={displayFen}
          onMove={handleMove}
          disabled={!isMyTurn || connectionState !== 'connected' || isReviewing}
          chess960={match.isChess960}
          initialFen={match.fen}
          orientation={myColor}
          lastMove={displayLastMove}
        />

        <View style={styles.playerRow}>
          <Text style={[styles.clock, turn === myColor && !gameOver && styles.clockActive]}>
            {myName}: {formatTime(myMs / 1000)}
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
        history={moveList}
        players={[{ label: 'You', color: myColor }]}
        onGameReview={() => onAnalyze({ initialFen: match.fen, chess960: match.isChess960, history: moveList })}
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
    maxHeight: 140,
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
