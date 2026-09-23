import { StyleSheet, Text, View } from 'react-native';
import type { PieceColor, PieceType } from '../types/chess';

const PIECE_SYMBOLS: Record<string, string> = {
  wp: '♙',
  wn: '♘',
  wb: '♗',
  wr: '♖',
  wq: '♕',
  bp: '♟',
  bn: '♞',
  bb: '♝',
  br: '♜',
  bq: '♛',
};

// Lowest value first, matching how chess.com orders a captured-pieces row.
const DISPLAY_ORDER: PieceType[] = ['p', 'n', 'b', 'r', 'q'];

interface CapturedPiecesProps {
  /** Types of the opponent's pieces this player has captured. */
  pieces: PieceType[];
  /** The color of the captured pieces themselves — a captured piece is always shown in its own
   * original color (e.g. White's row of captures shows small black icons), matching chess.com. */
  color: PieceColor;
  /** This player's material lead in points. Only the side actually ahead shows a badge — 0 (or
   * a trailing side, which this screen never passes a positive number for) renders nothing. */
  advantage: number;
}

export default function CapturedPieces({ pieces, color, advantage }: CapturedPiecesProps) {
  if (pieces.length === 0 && advantage <= 0) return null;

  const sorted = [...pieces].sort((a, b) => DISPLAY_ORDER.indexOf(a) - DISPLAY_ORDER.indexOf(b));

  return (
    <View style={styles.row}>
      {sorted.map((type, i) => (
        <Text key={i} style={styles.icon}>
          {PIECE_SYMBOLS[`${color}${type}`]}
        </Text>
      ))}
      {advantage > 0 && <Text style={styles.advantage}>+{advantage}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    maxWidth: 160,
  },
  icon: {
    fontSize: 16,
    marginRight: -3,
  },
  advantage: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8a7a63',
    marginLeft: 6,
  },
});
