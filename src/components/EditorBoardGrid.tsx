import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { EDITOR_BOARD_BORDER } from './boardSize';
import type { BoardSquare } from '../types/chess';

/**
 * The board of an EDITOR screen (Board Editor / From Position, Setup Chess army builder): exactly 8 row Views of 8 squares, never a `flexWrap` row.
 *
 * WHY (command #55): the editor used to be a `flexDirection: 'row', flexWrap: 'wrap'` of 64 `Pressable`s. AppPressable gives every control a 44 dp floor, a 360 dp phone's
 * squares are 41 dp, so each cell grew to 44, 8 x 44 no longer fitted and the row wrapped after 7 squares (pieces shifted, board over the buttons). Two rules now keep it from
 * coming back: the rows are explicit (a cell that is a little too wide overflows, it can never move a square to the next row), and a Pressable per square passes `compact`
 * (the square IS the touch target; editorBoardGrid.test.ts scans for it).
 */
interface EditorBoardGridProps {
  /** Rows in DISPLAY order, top row first (8 rows of 8). */
  rows: BoardSquare[][];
  /** Side of one square in dp (`getEditorSquareSize`). */
  squareSize: number;
  /** One cell. A touchable one is a `Pressable compact` of `squareSize` x `squareSize` (see `editorSquareStyle`). */
  renderSquare: (square: BoardSquare, rowIndex: number, colIndex: number) => ReactNode;
}

export default function EditorBoardGrid({ rows, squareSize, renderSquare }: EditorBoardGridProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.border} testID="editor-board">
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={[styles.row, { width: squareSize * row.length, height: squareSize }]} testID={`editor-board-row-${rowIndex}`}>
            {row.map((square, colIndex) => renderSquare(square, rowIndex, colIndex))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  border: { borderWidth: EDITOR_BOARD_BORDER, borderColor: '#3a2618' },
  row: { flexDirection: 'row', flexWrap: 'nowrap' },
});
