import { useState } from 'react';
import { appAlert } from '../components/AppAlert';
import { validateEditorFen } from '../logic/boardEditor';
import { classicalSetupArmy, mergeSetupArmies } from '../logic/setupChess';
import type { ColorChoice, PieceColor } from '../types/chess';
import SetupChessBuilderScreen from './SetupChessBuilderScreen';

interface BotSetupChessFlowScreenProps {
  botName: string;
  colorChoice: ColorChoice;
  /** `color` is the RESOLVED color the human ended up building (colorChoice may have been
   * 'random') — the caller must pass this same concrete color on to BotGameScreen rather than
   * re-resolving 'random' a second time, or the army built here could end up assigned to the
   * wrong side. */
  onDone: (initialFen: string, color: PieceColor) => void;
  onBack: () => void;
}

/**
 * Bot-mode Setup Chess: the human builds their own army; the bot's side is always the fixed
 * classical army (see setupChess.ts's own doc comment on why — deterministic, not randomly
 * generated, for this first version).
 */
export default function BotSetupChessFlowScreen({ botName, colorChoice, onDone, onBack }: BotSetupChessFlowScreenProps) {
  // Resolved once per mount, same "coin flip happens exactly once" convention BotGameScreen
  // itself uses for colorChoice — resolving it here (rather than letting BotGameScreen resolve
  // it again later) is what lets the army built below reliably end up on the human's actual side.
  const [humanColor] = useState<PieceColor>(() => (colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice));
  const botColor: PieceColor = humanColor === 'w' ? 'b' : 'w';

  return (
    <SetupChessBuilderScreen
      color={humanColor}
      title="Setup Chess"
      subtitle={`You (${humanColor === 'w' ? 'White' : 'Black'}) vs ${botName}`}
      onBack={onBack}
      backLabel="‹ Menu"
      onFinalize={(humanPieces) => {
        const whitePieces = humanColor === 'w' ? humanPieces : classicalSetupArmy('w');
        const blackPieces = humanColor === 'b' ? humanPieces : classicalSetupArmy('b');
        const fen = mergeSetupArmies(whitePieces, blackPieces);
        const validation = validateEditorFen(fen);
        if (!validation.ok) {
          appAlert('Invalid starting position', `${validation.error} Please adjust your army.`);
          return;
        }
        onDone(fen, humanColor);
      }}
    />
  );
}
