import { useEffect, useRef, useState } from 'react';
import { Dimensions, PixelRatio, Platform, StyleSheet, Text as SystemText, View, type LayoutChangeEvent, type TextLayoutEvent } from 'react-native';
import { areBundledFontsUsable } from '../logic/typography';
import { PROBE_TEXTS, summarizeProbe, type ProbeSample } from '../logic/textFitProbe';
import { Text } from './AppText';

interface TextFitProbeProps {
  /** Called once, with the lines to log, when every probe string has reported its layout. */
  onDone: (lines: string[]) => void;
}

/**
 * Renders each probe string (logic/textFitProbe.ts) twice - the app font and the phone's own - with nothing limiting its width, and reports what the layout gave each box against
 * what the text needed. It deliberately uses react-native's own `Text` for the system-font half: that is the thing being compared (the textFit scan test allows this one file).
 * It is visible (a hidden view may skip layout on Android): a small block of grey text on the diagnostics screen.
 */
export default function TextFitProbe({ onDone }: TextFitProbeProps) {
  const total = PROBE_TEXTS.length * 2;
  const boxes = useRef(new Map<string, { w: number; h: number }>());
  const texts = useRef(new Map<string, { lines: number; w: number; h: number }>());
  const [reported, setReported] = useState(0);
  const done = useRef(false);

  const key = (font: 'app' | 'system', text: string) => `${font}|${text}`;
  const onLayout = (font: 'app' | 'system', text: string) => (e: LayoutChangeEvent) => {
    boxes.current.set(key(font, text), { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
    setReported((n) => n + 1);
  };
  const onTextLayout = (font: 'app' | 'system', text: string) => (e: TextLayoutEvent) => {
    const lines = e.nativeEvent.lines;
    texts.current.set(key(font, text), {
      lines: lines.length,
      w: lines.reduce((max, l) => Math.max(max, l.width), 0),
      h: lines.reduce((sum, l) => sum + l.height, 0),
    });
    setReported((n) => n + 1);
  };

  useEffect(() => {
    if (done.current || boxes.current.size < total || texts.current.size < total) return;
    done.current = true;
    const samples: ProbeSample[] = [];
    for (const font of ['app', 'system'] as const) {
      for (const text of PROBE_TEXTS) {
        const box = boxes.current.get(key(font, text));
        const laid = texts.current.get(key(font, text));
        if (box && laid) samples.push({ font, text, boxWidth: box.w, boxHeight: box.h, lineCount: laid.lines, textWidth: laid.w, textHeight: laid.h });
      }
    }
    const window = Dimensions.get('window');
    const screen = Dimensions.get('screen');
    onDone(
      summarizeProbe(
        {
          os: Platform.OS,
          osVersion: Platform.Version,
          pixelRatio: PixelRatio.get(),
          fontScale: PixelRatio.getFontScale(),
          windowWidth: window.width,
          windowHeight: window.height,
          screenWidth: screen.width,
          screenHeight: screen.height,
          bundledFonts: areBundledFontsUsable(),
        },
        samples,
      ),
    );
  }, [reported, total, onDone]);

  return (
    <View style={styles.block}>
      {PROBE_TEXTS.map((text) => (
        <View key={text} style={styles.row}>
          <Text style={styles.probe} onLayout={onLayout('app', text)} onTextLayout={onTextLayout('app', text)}>
            {text}
          </Text>
          <SystemText style={styles.probe} onLayout={onLayout('system', text)} onTextLayout={onTextLayout('system', text)}>
            {text}
          </SystemText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { alignItems: 'flex-start', gap: 2 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  probe: { fontSize: 15, color: '#888' },
});
