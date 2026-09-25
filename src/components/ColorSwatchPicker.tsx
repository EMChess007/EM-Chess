import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

// A general-purpose palette, not split into "light"/"dark" sets, since either picker (light
// square, dark square) should be able to reach any of these — the same swatch row is reused for
// both, exactly like the light/dark pickers on chess.com's own board-theme UI.
const PRESET_COLORS = [
  '#f0d9b5', '#b58863', '#eeeed2', '#769656', '#ffffff', '#000000',
  '#e8ebef', '#7d8796', '#f0e6d2', '#8ca2ad', '#f2e2c4', '#5b6b77',
  '#e5d0ac', '#7a542e', '#dee3e6', '#8fa1b3', '#f5deb3', '#4b3621',
];

interface ColorSwatchPickerProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}

export default function ColorSwatchPicker({ label, value, onChange }: ColorSwatchPickerProps) {
  const [hexInput, setHexInput] = useState(value);
  const isValid = HEX_PATTERN.test(hexInput);

  const commitHex = () => {
    if (isValid) onChange(hexInput);
  };

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.preview, { backgroundColor: HEX_PATTERN.test(value) ? value : '#ccc' }]} />
      </View>
      <View style={styles.swatchRow}>
        {PRESET_COLORS.map((color) => (
          <Pressable
            key={color}
            style={[
              styles.swatch,
              { backgroundColor: color },
              value.toLowerCase() === color.toLowerCase() && styles.swatchSelected,
            ]}
            onPress={() => {
              setHexInput(color);
              onChange(color);
            }}
          />
        ))}
      </View>
      <View style={styles.hexRow}>
        <TextInput
          style={[styles.hexInput, !isValid && styles.hexInputInvalid]}
          value={hexInput}
          onChangeText={setHexInput}
          onBlur={commitHex}
          onSubmitEditing={commitHex}
          placeholder="#rrggbb"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable style={[styles.applyButton, !isValid && styles.applyButtonDisabled]} onPress={commitHex} disabled={!isValid}>
          <Text style={styles.applyButtonText}>Apply</Text>
        </Pressable>
      </View>
      {!isValid && <Text style={styles.errorText}>Enter a hex color like #f0d9b5.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3a2618',
  },
  preview: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#999',
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#bbb',
  },
  swatchSelected: {
    borderWidth: 3,
    borderColor: '#3a2618',
  },
  hexRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  hexInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  hexInputInvalid: {
    borderColor: '#b00020',
  },
  applyButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#3a2618',
    borderRadius: 8,
  },
  applyButtonDisabled: {
    opacity: 0.4,
  },
  applyButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 11,
    color: '#b00020',
  },
});
