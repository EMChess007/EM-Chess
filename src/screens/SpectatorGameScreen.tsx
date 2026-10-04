import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import ChessBoard from '../components/ChessBoard';
import GameScreenBody from '../components/GameScreenBody';
import MoveListStrip from '../components/MoveListStrip';
import ScreenHeader from '../components/ScreenHeader';
import { connectSocket, disconnectSocket } from '../api/socket';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { duckMoveNotation } from '../logic/duckChess';
import { THREE_CHECK_TARGET, getThreeCheckCounts } from '../logic/threeCheck';
import { playerClockText } from '../logic/time';
import type { Ack, GameOverPayload, SpectateStatePayload, SpectatorMovePayload } from '../types/multiplayer';
import type { PieceColor } from '../types/chess';

// A stable, module-level reference — see EngineVsEngineGameScreen's identical noopMove for why
// this matters even for a disabled, read-only board.
const noopMove = () => {};

interface SpectatorGameScreenProps {
  authToken: string | null;
  roomId: string;
  whiteUsername: string;
  blackUsername: string;
  onExit: () => void;
}

interface MoveRow {
  san: string;
}

export default function SpectatorGameScreen({ authToken, roomId, whiteUsername, blackUsername, onExit }: SpectatorGameScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);

  const [state, setState] = useState<SpectateStatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gameOver, setGameOver] = useState<GameOverPayload | null>(null);
  const [moves, setMoves] = useState<MoveRow[]>([]);

  useEffect(() => {
    const socket = connectSocket(authToken);

    socket.emit('spectate_game', { roomId }, (ack: Ack<{ state: SpectateStatePayload }>) => {
      if (!ack.ok) {
        setError(ack.error);
        return;
      }
      setState(ack.state);
      // Spectators always get the full true game (see SpectateStatePayload's own doc comment),
      // so `san` is only ever optional in the TYPE (it's shared with the redacted player-facing
      // shape) — never actually missing here; the fallback is just defensive.
      setMoves(ack.state.moves.map((m) => ({ san: ack.state.isDuckChess ? duckMoveNotation({ san: m.san ?? '?', duck: m.duck }) : (m.san ?? '?') })));
    });

    const handleSpectatorMove = (payload: SpectatorMovePayload) => {
      setState((prev) =>
        prev
          ? { ...prev, fen: payload.fen, turn: payload.turn, whiteMs: payload.whiteMs, blackMs: payload.blackMs, ...(payload.duckSquare !== undefined ? { duckSquare: payload.duckSquare } : {}) }
          : prev
      );
      // Duck Chess: where the duck went rides along with the move, "e4 @g6".
      setMoves((prev) => [...prev, { san: payload.duck ? duckMoveNotation({ san: payload.san ?? '?', duck: payload.duck }) : (payload.san ?? '?') }]);
    };
    const handleGameOver = (payload: GameOverPayload) => setGameOver(payload);

    socket.on('spectator_move', handleSpectatorMove);
    socket.on('game_over', handleGameOver);

    return () => {
      socket.off('spectator_move', handleSpectatorMove);
      socket.off('game_over', handleGameOver);
      socket.emit('stop_spectating', {});
      disconnectSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const handleExit = () => {
    onExit();
  };

  if (error) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Spectate" onBack={handleExit} backLabel="‹ Back" />
        <View style={styles.centerRow}>
          <Text style={styles.error}>{error}</Text>
        </View>
      </View>
    );
  }

  if (!state) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Spectate" onBack={handleExit} backLabel="‹ Back" />
      </View>
    );
  }

  const turn: PieceColor = state.turn;
  let statusText = `${turn === 'w' ? whiteUsername : blackUsername} to move`;
  if (gameOver) {
    statusText = gameOver.winner === null ? 'Draw' : `${gameOver.winner === 'w' ? whiteUsername : blackUsername} won`;
  }
  const checkCounts = state.isThreeCheck ? getThreeCheckCounts(moves) : null;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Spectating" onBack={handleExit} backLabel="‹ Back" />
      <MoveListStrip moves={moves} selectedIndex={moves.length - 1} autoScroll onSelectMove={() => {}} />
      <GameScreenBody bottomBar={<View />}>
        <Text style={styles.subtitle}>
          {whiteUsername} vs {blackUsername}
          {state.isChess960
            ? ' · Chess960'
            : state.isKingOfTheHill
              ? ' · King of the Hill'
              : state.isThreeCheck
                ? ' · Three-Check'
                : state.isSetupChess
                  ? ' · Setup Chess'
                  : state.isFogOfWar
                    ? ' · Fog of War'
                    : state.isGiveaway
                      ? ' · Giveaway'
                      : state.isAtomic
                        ? ' · Atomic'
                        : state.isDuckChess
                          ? ' · Duck Chess'
                          : ''}
        </Text>
        <Text style={styles.status}>{statusText}</Text>

        <View style={styles.playerRow}>
          <Text style={[styles.clock, turn === 'b' && !gameOver && styles.clockActive]}>
            {playerClockText(blackUsername, state.blackMs, state.timeControl.initialSeconds)}
            {checkCounts ? ` · Checks: ${checkCounts.b}/${THREE_CHECK_TARGET}` : ''}
          </Text>
        </View>

        <ChessBoard
          fen={state.fen}
          onMove={noopMove}
          disabled
          chess960={state.isChess960}
          kingOfTheHill={state.isKingOfTheHill}
          fogOfWar={state.isFogOfWar}
          giveaway={state.isGiveaway}
          atomic={state.isAtomic}
          duckChess={state.isDuckChess}
          duckSquare={state.duckSquare ?? null}
        />

        <View style={styles.playerRow}>
          <Text style={[styles.clock, turn === 'w' && !gameOver && styles.clockActive]}>
            {playerClockText(whiteUsername, state.whiteMs, state.timeControl.initialSeconds)}
            {checkCounts ? ` · Checks: ${checkCounts.w}/${THREE_CHECK_TARGET}` : ''}
          </Text>
        </View>
      </GameScreenBody>
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
      textAlign: 'center',
    },
    status: {
      fontSize: 16,
      color: colors.text,
    },
    playerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    clock: {
      fontSize: 18,
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
    centerRow: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    error: {
      color: colors.danger,
      fontSize: 14,
      textAlign: 'center',
    },
  });
}
