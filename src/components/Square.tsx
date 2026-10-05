import { StyleSheet, Text, View } from 'react-native';
import type { BoardSquare } from '../types/chess';
import type { PieceImageMap } from '../types/theme';
import Piece from './Piece';

interface SquareProps {
  data: BoardSquare;
  isLight: boolean;
  isSelected: boolean;
  isLegalTarget: boolean;
  /** True only for the square holding the king currently in check (or checkmated) — see
   * ChessBoard's checkedKingSquare. Takes priority over `isSelected` when both apply (e.g. you
   * click your own checked king to see its escape squares), since check is the more urgent fact. */
  isChecked: boolean;
  /** True for the two squares (origin + destination) of the last move played — see
   * ChessBoard.tsx. Lower priority than isSelected/isChecked when a square happens to be both. */
  isLastMove: boolean;
  /** True for one of the 4 center squares (d4/d5/e4/e5) when the game is being played in King of
   * the Hill mode — a light, purely informational tint showing the win-condition target, distinct
   * from and lower-priority than isSelected/isChecked/isLastMove. */
  isKingOfTheHillTarget?: boolean;
  /** Hides this square's piece glyph — used only for the destination square while ChessBoard's
   * slide animation is carrying the moving piece in, so it doesn't already show up here the
   * instant the move lands, underneath the incoming sprite. */
  hidePiece?: boolean;
  /** Fog of War only — true when this square is outside the local viewer's current visibility.
   * Covers the square with a FULLY OPAQUE overlay instead of showing whatever's there (or isn't):
   * for Local/Bot, ChessBoard still holds the true fen, so `data.piece` may well be populated
   * here — this is what actually hides it from rendering, not the fen itself. Opaque rather than
   * a translucent tint deliberately — this square's own background color is still set above from
   * isLastMove/isChecked/isSelected regardless of fog (simpler than threading fog awareness into
   * every one of those), and anything less than fully opaque would let that color bleed through
   * and leak exactly the kind of information (e.g. "a move just landed here") Fog of War exists
   * to hide. */
  isFogged?: boolean;
  /** Duck Chess only — true for the square the neutral duck stands on (see duckChess.ts); drawn over
   * whatever the (always empty) square shows. */
  isDuck?: boolean;
  /** Spell Chess only — true for a square immobilized this ply by the opponent's Freeze cast last
   * turn (see spellChess.frozenSquaresFor). A light icy overlay; lower priority than isSelected/
   * isChecked/isLastMove, same tier as isKingOfTheHillTarget. */
  isFrozen?: boolean;
  /** Spell Chess only — true for the one square currently "jumpable" via an active Jump cast (see
   * spellChess.activeJumpSquare) — the square a slider may now treat as transparent, not the piece
   * it lets through. Same tier as isFrozen. */
  isJumpSquare?: boolean;
  /** Spell Chess only — true for a square inside the Freeze zone the player has just picked but not yet played
   * (ChessBoard's pendingCast): "about to freeze", as opposed to isFrozen's "frozen right now". An icy OUTLINE
   * plus a faint tint rather than a fill, so it reads differently from isFrozen's solid overlay and from the
   * legal-move dot, and still shows if an isFrozen square happens to sit under it. Cleared with the cast. */
  isPendingFreeze?: boolean;
  size: number;
  /** The active board theme's colors and the active piece theme's images — see ChessBoard.tsx. */
  lightColor: string;
  darkColor: string;
  pieceImages?: PieceImageMap;
}

// Purely presentational — ChessBoard's own PanResponder (on the board container) handles every
// tap/long-press/drag across the whole grid, so this never needs its own touch handling.
export default function Square({
  data,
  isLight,
  isSelected,
  isLegalTarget,
  isChecked,
  isLastMove,
  isKingOfTheHillTarget,
  hidePiece,
  isFogged,
  isDuck,
  isFrozen,
  isJumpSquare,
  isPendingFreeze,
  size,
  lightColor,
  darkColor,
  pieceImages,
}: SquareProps) {
  return (
    <View
      style={[
        styles.square,
        { width: size, height: size, backgroundColor: isLight ? lightColor : darkColor },
        isKingOfTheHillTarget && styles.kingOfTheHillTarget,
        isPendingFreeze && styles.pendingFreeze,
        isFrozen && styles.frozen,
        isJumpSquare && styles.jumpSquare,
        isLastMove && styles.lastMove,
        isSelected && styles.selected,
        isChecked && styles.checked,
      ]}
    >
      {isFogged ? (
        <View style={[StyleSheet.absoluteFill, styles.fog]} />
      ) : (
        <>
          {isLegalTarget && <View style={styles.legalDot} />}
          {data.piece && !hidePiece && <Piece piece={data.piece} images={pieceImages} />}
          {isDuck && (
            <View style={[styles.duck, { width: size * 0.78, height: size * 0.78, borderRadius: size * 0.39 }]}>
              <Text style={[styles.duckGlyph, { fontSize: size * 0.56 }]}>🦆</Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  square: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  kingOfTheHillTarget: {
    backgroundColor: 'rgba(255, 193, 7, 0.35)',
  },
  frozen: {
    backgroundColor: 'rgba(100, 181, 246, 0.45)',
  },
  pendingFreeze: {
    backgroundColor: 'rgba(129, 212, 250, 0.28)',
    borderWidth: 2,
    borderColor: '#0288d1',
  },
  jumpSquare: {
    backgroundColor: 'rgba(171, 71, 188, 0.4)',
  },
  lastMove: {
    backgroundColor: '#f7ec74',
  },
  selected: {
    backgroundColor: '#a2d149',
  },
  checked: {
    backgroundColor: '#ef5350',
  },
  legalDot: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  fog: {
    backgroundColor: '#23201c',
  },
  duck: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 214, 10, 0.55)',
    borderWidth: 2,
    borderColor: 'rgba(120, 85, 0, 0.8)',
  },
  duckGlyph: {
    textAlign: 'center',
  },
});
