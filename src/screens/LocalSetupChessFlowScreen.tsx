import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '../components/AppAlert';
import ScreenHeader from '../components/ScreenHeader';
import { validateEditorFen } from '../logic/boardEditor';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { mergeSetupArmies, type SetupChessPiece } from '../logic/setupChess';
import SetupChessBuilderScreen from './SetupChessBuilderScreen';

interface LocalSetupChessFlowScreenProps {
  /** Called once both armies are built and merge into a valid starting position. */
  onDone: (initialFen: string) => void;
  onBack: () => void;
}

type Phase = 'white' | 'pass' | 'black';

/**
 * Hotseat orchestration for Local-mode Setup Chess: White builds their army, then an interstitial
 * screen asks for the device to be handed over before Black's board even mounts (so Black's
 * SetupChessBuilderScreen — which only ever renders its own color's two ranks — never receives
 * White's already-finalized pieces at all, guaranteeing neither side sees the other's army before
 * finalizing their own).
 */
export default function LocalSetupChessFlowScreen({ onDone, onBack }: LocalSetupChessFlowScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [phase, setPhase] = useState<Phase>('white');
  const [whitePieces, setWhitePieces] = useState<SetupChessPiece[] | null>(null);

  if (phase === 'white') {
    return (
      <SetupChessBuilderScreen
        color="w"
        title="Setup Chess"
        subtitle="White — build your army"
        onBack={onBack}
        backLabel="‹ Menu"
        onFinalize={(pieces) => {
          setWhitePieces(pieces);
          setPhase('pass');
        }}
      />
    );
  }

  if (phase === 'pass') {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Setup Chess" subtitle="Pass the device" onBack={() => setPhase('white')} backLabel="‹ Back" />
        <View style={styles.centerColumn}>
          <Text style={styles.message}>White's army is locked in.</Text>
          <Text style={styles.message}>Pass the device to Black, then continue.</Text>
          <Pressable style={styles.continueButton} onPress={() => setPhase('black')}>
            <Text style={styles.continueButtonText}>Black is ready — Continue</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // phase === 'black'
  return (
    <SetupChessBuilderScreen
      color="b"
      title="Setup Chess"
      subtitle="Black — build your army"
      onBack={() => setPhase('pass')}
      backLabel="‹ Back"
      onFinalize={(blackPieces) => {
        const fen = mergeSetupArmies(whitePieces!, blackPieces);
        const validation = validateEditorFen(fen);
        if (!validation.ok) {
          appAlert('Invalid starting position', `${validation.error} Please adjust your army.`);
          return;
        }
        onDone(fen);
      }}
    />
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centerColumn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      gap: 14,
    },
    message: {
      fontSize: 16,
      color: colors.text,
      textAlign: 'center',
    },
    continueButton: {
      marginTop: 10,
      paddingVertical: 14,
      paddingHorizontal: 24,
      backgroundColor: colors.buttonBackground,
      borderRadius: 10,
    },
    continueButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
  });
}
