import { StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import type { Cell } from '../logic/boardGestures';
import type { BoardId, BughouseColor } from '../logic/bughouse/types';
import { boardCellToSquare } from '../logic/bughouseView';
import type { DebugFinger } from './useBoardTouches';

/**
 * DEV ONLY (a development build, switched on from the in-game controls): draws, over a Bughouse board, the square the app computes under EACH finger - a red frame on the cell, its name,
 * and a dot where the finger is in the grid's own frame - so a phone can be checked in seconds: if the frame is not under the fingertip, the mapping is wrong. It exists to find a bug like
 * "every tap lands one rank too low" without a debugger; it never receives a touch (pointerEvents none) and does not exist in a release build: the board loads this file only under
 * `__DEV__` (BughouseBoard), and `bughouseTouchDebug.test.ts` scans for that.
 */
export interface TouchDebugOverlayProps {
  board: BoardId;
  orientation: BughouseColor;
  cell: number;
  fingers: readonly DebugFinger[];
}

/** The text drawn on a finger's cell: the square it is on, or "outside" when the finger is not on the grid. */
export function debugLabel(board: BoardId, orientation: BughouseColor, cellOfFinger: Cell | null): string {
  return cellOfFinger ? boardCellToSquare(board, orientation, cellOfFinger.row, cellOfFinger.col).square : 'outside';
}

export default function TouchDebugOverlay({ board, orientation, cell, fingers }: TouchDebugOverlayProps) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID={`touch-debug-${board}`}>
      {fingers.map((finger) => (
        <View key={finger.id} pointerEvents="none" style={StyleSheet.absoluteFill}>
          {finger.cell && <View testID={`touch-debug-${board}-frame`} style={[styles.frame, { left: finger.cell.col * cell, top: finger.cell.row * cell, width: cell, height: cell }]} />}
          {finger.local && <View style={[styles.dot, { left: finger.local.x - 4, top: finger.local.y - 4 }]} />}
          {finger.local && (
            <Text style={[styles.label, { left: Math.max(0, finger.local.x - 24), top: Math.max(0, finger.local.y - 30) }]} testID={`touch-debug-${board}-square`}>
              {debugLabel(board, orientation, finger.cell)}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', borderWidth: 3, borderColor: '#e53935', backgroundColor: 'rgba(229,57,53,0.25)' },
  dot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#1e88e5', borderWidth: 1, borderColor: '#fff' },
  label: { position: 'absolute', paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden', fontSize: 14, fontWeight: '800', color: '#fff', backgroundColor: 'rgba(0,0,0,0.75)' },
});
