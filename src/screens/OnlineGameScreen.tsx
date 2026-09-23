import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { connectSocket, disconnectSocket } from '../api/socket';
import ChessBoard from '../components/ChessBoard';
import ScreenHeader from '../components/ScreenHeader';
import { lookupOpening } from '../logic/openings';
import { formatTime } from '../logic/time';
import type { Move, PieceColor } from '../types/chess';
import type {
  Ack,
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
}

const GAME_OVER_REASON_LABELS: Record<GameOverPayload['reason'], string> = {
  checkmate: 'checkmate',
  stalemate: 'stalemate',
  draw: 'draw',
  timeout: 'time out',
  abandonment: 'opponent abandoned',
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
      setFen(payload.fen);
      setTurn(payload.turn);
      setWhiteMs(payload.whiteMs);
      setBlackMs(payload.blackMs);
      setLastMoveSan(payload.san);
      setMoveList((list) => [...list, { san: payload.san, mover: opponentColor }]);
    };

    const handleGameOver = (payload: GameOverPayload) => {
      setGameOver(payload);
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

    return () => {
      socket.off('opponent_move', handleOpponentMove);
      socket.off('game_over', handleGameOver);
      socket.off('opponent_disconnected', handleOpponentDisconnected);
      socket.off('opponent_reconnected', handleOpponentReconnected);
      socket.off('disconnect', handleDisconnect);
      socket.io.off('reconnect', handleReconnect);
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
    if (gameOver || turn !== myColor || connectionState !== 'connected') return;

    const fenBeforeMove = fen; // closure snapshot, for reverting if the server disagrees
    setMoveError(null);
    setFen(newFen);
    setTurn(opponentColor); // optimistic — the ack below confirms/corrects this
    setLastMoveSan(move.san);
    setMoveList((list) => [...list, { san: move.san, mover: myColor }]);

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
      <View style={styles.body}>

      {connectionState === 'reconnecting' && (
        <Text style={styles.warningBanner}>Connection lost — trying to reconnect...</Text>
      )}
      {opponentGraceSeconds !== null && (
        <Text style={styles.warningBanner}>
          Your opponent disconnected — if they don't reconnect in {opponentGraceSeconds}s you'll win automatically.
        </Text>
      )}
      {moveError && <Text style={styles.errorBanner}>{moveError}</Text>}

      <Text style={[styles.status, gameOver && styles.statusOver]}>{statusText}</Text>

      <Text style={[styles.clock, turn === opponentColor && !gameOver && styles.clockActive]}>
        {opponentName}: {formatTime(opponentMs / 1000)}
      </Text>

      {!match.isChess960 && openingName && <Text style={styles.openingName}>{openingName}</Text>}

      <ChessBoard
        key={boardKey}
        fen={fen}
        onMove={handleMove}
        disabled={!isMyTurn || connectionState !== 'connected'}
        chess960={match.isChess960}
        initialFen={match.fen}
        orientation={myColor}
      />

      <Text style={[styles.clock, turn === myColor && !gameOver && styles.clockActive]}>
        {myName}: {formatTime(myMs / 1000)}
      </Text>

      <View style={styles.footer}>
        {lastMoveSan && <Text style={styles.lastMove}>Last move: {lastMoveSan}</Text>}
        {gameOver && (
          <Pressable style={styles.exitButton} onPress={handleExit}>
            <Text style={styles.exitButtonText}>Back to menu</Text>
          </Pressable>
        )}
      </View>

      <ScrollView style={styles.moveList} contentContainerStyle={styles.moveListContent} horizontal>
        <Text style={styles.moveListText}>
          {moveList.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m.san} ` : `${m.san} `)).join('')}
        </Text>
      </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
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
  moveList: {
    marginTop: 4,
    maxWidth: '90%',
  },
  moveListContent: {
    paddingHorizontal: 12,
  },
  moveListText: {
    fontSize: 13,
    color: '#777',
  },
});
