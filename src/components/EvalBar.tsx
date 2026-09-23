import { StyleSheet, Text, View } from 'react-native';
import type { EngineEvaluation } from '../engine/ChessEngine';
import { evalToWhiteFillPercent, formatEvaluationCompact } from '../logic/analysis';

interface EvalBarProps {
  /** Evaluation from White's perspective, or null while not yet analyzed. */
  evaluation: EngineEvaluation | null;
  height: number;
}

const WIDTH = 26;

export default function EvalBar({ evaluation, height }: EvalBarProps) {
  const whitePercent = evaluation ? evalToWhiteFillPercent(evaluation) : 50;
  const label = evaluation ? formatEvaluationCompact(evaluation) : '';
  // Put the label inside whichever segment is bigger, in that segment's contrasting text color,
  // so it stays readable regardless of how lopsided the bar is.
  const labelInWhiteSegment = whitePercent >= 50;

  return (
    <View style={[styles.container, { height, width: WIDTH }]}>
      <View style={[styles.blackFill, { height: `${100 - whitePercent}%` }]}>
        {!labelInWhiteSegment && label ? <Text style={styles.labelOnBlack}>{label}</Text> : null}
      </View>
      <View style={[styles.whiteFill, { height: `${whitePercent}%` }]}>
        {labelInWhiteSegment && label ? <Text style={styles.labelOnWhite}>{label}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#3a2618',
    flexDirection: 'column',
  },
  blackFill: {
    width: '100%',
    backgroundColor: '#3a2618',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 3,
  },
  whiteFill: {
    width: '100%',
    backgroundColor: '#f0d9b5',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 3,
  },
  labelOnBlack: {
    color: '#f0d9b5',
    fontSize: 9,
    fontWeight: '700',
  },
  labelOnWhite: {
    color: '#3a2618',
    fontSize: 9,
    fontWeight: '700',
  },
});
