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
import ScreenHeader from '../components/ScreenHeader';
import { ChessEngine } from '../logic/ChessEngine';
import { computeCapturedMaterial, materialValue } from '../logic/material';
import { lookupOpening } from '../logic/openings';
import { formatTime } from '../logic/time';
import type { Move, PieceColor, PieceType } from '../types/chess';
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
}

interface MoveRecord {
  san: string;
  mover: PieceColor;
  captured?: PieceType;
  fenAfter: string;
}

interface ChatEntry {
  from: 'me' | 'opponent';
  text: string;
}

const GAME_OVER_REASON_LABELS: Record<GameOverPayload['reason'], string> = {
  checkmate: 'checkmate',
  stalemate: 'stalemate',
  draw: 'draw',
  timeout: 'time out',
  abandonment: 'opponent abandoned',
  resignation: 'resignation',
};

function describeGameOver(payload: GameOverPayload, myColor: PieceColor): string {
  const reasonLabel = GAME_OVER_REASON_LABELS[payload.reason];
  if (payload.winner === null) return `Draw (${reasonLabel}).`;
  return payload.winner === myColor ? `You won! (${reasonLabel})` : `You lost. (${reasonLabel})`;
}

export default function OnlineGameScreen({ authToken, match, onExit }: OnlineGameScreenProps) {
  const myColor = match.color;
  const opponentColor: PieceColor = myColor === 'w' ? 'b' : 'w';

  const [fen, setFen] = useState(match.fen);
  const [turn, setTurn] = useState<PieceColor>('w');
  const [whiteMs, setWhiteMs] = useState(match.whiteMs);
  const [blackMs, setBlackMs] = useState(match.blackMs);
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

  useEffect(() => {
    if (chatOpen) setChatUnread(0);
  }, [chatOpen]);

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
      setMoveList((list) => [
        ...list,
        { san: payload.san, mover: opponentColor, captured: replayed?.captured, fenAfter: payload.fen },
      ]);
    };

    const handleGameOver = (payload: GameOverPayload) => {
      setGameOver(payload);
      setDrawOfferPending(false);
      setIncomingDrawOffer(false);
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
              const result = replayEngine.move(m.from, m.to, m.promotion as Move['promotion']);
              if (result) {
                rebuilt.push({
                  san: result.san,
                  mover: i % 2 === 0 ? 'w' : 'b',
                  captured: result.captured,
                  fenAfter: replayEngine.getFen(),
                });
              }
            });
            setMoveList(rebuilt);
            if (rebuilt.length > 0) setLastMoveSan(rebuilt[rebuilt.length - 1].san);
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
    setMoveList((list) => [...list, { san: move.san, mover: myColor, captured: move.captured, fenAfter: newFen }]);

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

  // Tapping a move in the strip drives the exact same viewIndex the Back/Forward buttons do —
  // no separate navigation mechanism.
  const handleSelectMove = (index: number) => {
    const next = index + 1;
    setViewIndex(next >= positions.length - 1 ? null : next);
  };

  const { whiteCaptured, blackCaptured } = useMemo(
    () => computeCapturedMaterial(moveList.map((m) => ({ captured: m.captured, moverColor: m.mover }))),
    [moveList]
  );
  const materialDiff = materialValue(whiteCaptured) - materialValue(blackCaptured);
  const myCaptured = myColor === 'w' ? whiteCaptured : blackCaptured;
  const opponentCaptured = myColor === 'w' ? blackCaptured : whiteCaptured;
  const myAdvantage = myColor === 'w' ? (materialDiff > 0 ? materialDiff : 0) : (materialDiff < 0 ? -materialDiff : 0);
  const opponentAdvantage = myColor === 'w' ? (materialDiff < 0 ? -materialDiff : 0) : (materialDiff > 0 ? materialDiff : 0);

  const myName = 'You';
  const opponentName = 'Opponent';
  const myMs = myColor === 'w' ? whiteMs : blackMs;
  const opponentMs = myColor === 'w' ? blackMs : whiteMs;

  let statusText = isMyTurn ? 'Your turn' : `${opponentName}'s turn`;
  if (connectionState === 'reconnecting') statusText = 'Reconnecting...';
  if (gameOver) statusText = describeGameOver(gameOver, myColor);

  return (
    <View style={styles.container}>
      <ScreenHeader title={`Online Game${match.isChess960 ? ' (Chess960)' : ''}`} onBack={handleExit} backLabel="‹ Menu" />
      <MoveListStrip
        moves={moveList.map((m) => ({ san: m.san }))}
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
              {gameOver && (
                <Pressable style={styles.exitButton} onPress={handleExit}>
                  <Text style={styles.exitButtonText}>Back to menu</Text>
                </Pressable>
              )}
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

        <Text style={[styles.status, gameOver && styles.statusOver]}>{statusText}</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  warningBanner: {
    fontSize: 13,
    color: '#8d6e00',
    backgroundColor: '#fff3cd',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    textAlign: 'center',
    maxWidth: 320,
  },
  errorBanner: {
    fontSize: 13,
    color: '#b00020',
    textAlign: 'center',
    maxWidth: 320,
  },
  status: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
  },
  statusOver: {
    color: '#1a7a1a',
  },
  openingName: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#8a7a63',
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
    color: '#333',
    paddingVertical: 4,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  clockActive: {
    fontWeight: '700',
    color: '#fff',
    backgroundColor: '#3a2618',
  },
  footer: {
    marginTop: 8,
    alignItems: 'center',
    gap: 8,
  },
  lastMove: {
    fontSize: 14,
    color: '#555',
  },
  exitButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: '#3a2618',
    borderRadius: 8,
  },
  exitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  reviewingText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#8d6e00',
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
    backgroundColor: '#2e6f4f',
    borderRadius: 6,
  },
  drawDeclineButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    backgroundColor: '#b00020',
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
    borderColor: '#ddd',
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
    color: '#999',
    fontStyle: 'italic',
  },
  chatMessage: {
    fontSize: 13,
    color: '#333',
  },
  chatMessageMine: {
    color: '#3a2618',
    fontWeight: '600',
  },
  chatInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 13,
  },
  chatSendButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: '#3a2618',
    borderRadius: 6,
    justifyContent: 'center',
  },
  chatButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
