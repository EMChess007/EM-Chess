import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { appAlert } from '../components/AppAlert';
import ColorSwatchPicker from '../components/ColorSwatchPicker';
import ScreenHeader from '../components/ScreenHeader';
import { AVAILABLE_BOARD_THEMES } from '../logic/boardThemes';
import { deleteCustomBoardTheme, deleteCustomPieceTheme, saveCustomBoardTheme, saveCustomPieceTheme } from '../logic/customThemes';
import { readFileAsDataUri } from '../logic/fileReading';
import { AVAILABLE_PIECE_THEMES } from '../logic/pieceThemes';
import {
  getActiveBoardThemeId,
  getActivePieceThemeId,
  setActiveBoardTheme,
  setActivePieceTheme,
  subscribeActiveBoardTheme,
  subscribeActivePieceTheme,
} from '../logic/themeSettings';
import type { BoardTheme, PieceTheme } from '../types/theme';

interface ThemeSelectScreenProps {
  onBack: () => void;
}

const DEFAULT_LIGHT = '#f0d9b5';
const DEFAULT_DARK = '#b58863';

// Every piece key a custom set must cover — same `${color}${type}` keying as Piece.tsx's own
// glyph map, so a saved theme is a drop-in `images` record for it.
const PIECE_SLOTS: { key: string; label: string }[] = [
  { key: 'wp', label: 'White Pawn' },
  { key: 'wn', label: 'White Knight' },
  { key: 'wb', label: 'White Bishop' },
  { key: 'wr', label: 'White Rook' },
  { key: 'wq', label: 'White Queen' },
  { key: 'wk', label: 'White King' },
  { key: 'bp', label: 'Black Pawn' },
  { key: 'bn', label: 'Black Knight' },
  { key: 'bb', label: 'Black Bishop' },
  { key: 'br', label: 'Black Rook' },
  { key: 'bq', label: 'Black Queen' },
  { key: 'bk', label: 'Black King' },
];

// Generous for a small board-piece icon (typical PNGs are a few KB to a few dozen KB) while
// keeping a full 12-image custom set — and any AsyncStorage backing store, which has its own
// total-size ceiling — comfortably bounded even with several custom sets added over time.
const MAX_IMAGE_BYTES = 200 * 1024;

export default function ThemeSelectScreen({ onBack }: ThemeSelectScreenProps) {
  const [boardThemes, setBoardThemes] = useState<BoardTheme[]>(() => [...AVAILABLE_BOARD_THEMES]);
  const [pieceThemes, setPieceThemes] = useState<PieceTheme[]>(() => [...AVAILABLE_PIECE_THEMES]);
  const [activeBoardId, setActiveBoardId] = useState(getActiveBoardThemeId);
  const [activePieceId, setActivePieceId] = useState(getActivePieceThemeId);

  useEffect(() => subscribeActiveBoardTheme(setActiveBoardId), []);
  useEffect(() => subscribeActivePieceTheme(setActivePieceId), []);

  const refreshBoardThemes = () => setBoardThemes([...AVAILABLE_BOARD_THEMES]);
  const refreshPieceThemes = () => setPieceThemes([...AVAILABLE_PIECE_THEMES]);

  // --- Board theme add form ---
  const [boardAdding, setBoardAdding] = useState(false);
  const [boardNameInput, setBoardNameInput] = useState('');
  const [lightColor, setLightColor] = useState(DEFAULT_LIGHT);
  const [darkColor, setDarkColor] = useState(DEFAULT_DARK);

  const resetBoardForm = () => {
    setBoardAdding(false);
    setBoardNameInput('');
    setLightColor(DEFAULT_LIGHT);
    setDarkColor(DEFAULT_DARK);
  };

  const handleSaveBoardTheme = async () => {
    const name = boardNameInput.trim();
    if (!name) return;
    try {
      await saveCustomBoardTheme(name, lightColor, darkColor);
      refreshBoardThemes();
      resetBoardForm();
      appAlert('Board theme added', `"${name}" was added — select it above to use it.`);
    } catch {
      appAlert('Save failed', 'Could not save the board theme on this device.');
    }
  };

  const handleSelectBoardTheme = (theme: BoardTheme) => {
    if (theme.id === activeBoardId) return;
    setActiveBoardTheme(theme.id);
  };

  const handleRemoveBoardTheme = (theme: BoardTheme) => {
    appAlert('Remove board theme', `Are you sure you want to remove "${theme.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await deleteCustomBoardTheme(theme.id);
          refreshBoardThemes();
        },
      },
    ]);
  };

  // --- Piece theme add form ---
  const [pieceAdding, setPieceAdding] = useState(false);
  const [pieceNameInput, setPieceNameInput] = useState('');
  const [pieceImages, setPieceImages] = useState<Record<string, string>>({});

  const resetPieceForm = () => {
    setPieceAdding(false);
    setPieceNameInput('');
    setPieceImages({});
  };

  const handlePickPieceImage = async (key: string) => {
    let result: DocumentPicker.DocumentPickerResult;
    try {
      result = await DocumentPicker.getDocumentAsync({ type: ['image/png', 'image/webp'], copyToCacheDirectory: true });
    } catch {
      appAlert('Error', 'Could not pick a file.');
      return;
    }
    if (result.canceled || result.assets.length === 0) return;

    const asset = result.assets[0];
    // PNG and WebP only — both support transparency (and React Native's Image component reads
    // both natively, no extra dependency needed); JPEG doesn't support transparency, which a
    // piece icon needs to look right over any board square color.
    if (!/\.(png|webp)$/i.test(asset.name)) {
      appAlert('Invalid file', 'Please pick a PNG or WebP image with a transparent background.');
      return;
    }
    if (asset.size != null && asset.size > MAX_IMAGE_BYTES) {
      appAlert('Image too large', `"${asset.name}" is larger than ${Math.round(MAX_IMAGE_BYTES / 1024)}KB — pick a smaller image.`);
      return;
    }

    try {
      const dataUri = await readFileAsDataUri(asset.uri);
      setPieceImages((prev) => ({ ...prev, [key]: dataUri }));
    } catch {
      appAlert('Failed to load', 'Could not read the image.');
    }
  };

  const handleSavePieceTheme = async () => {
    const name = pieceNameInput.trim();
    if (!name) return;
    const missing = PIECE_SLOTS.filter((slot) => !pieceImages[slot.key]);
    if (missing.length > 0) {
      appAlert(
        'Incomplete piece set',
        `All 12 piece images are required. Missing: ${missing.map((slot) => slot.label).join(', ')}.`
      );
      return;
    }
    try {
      await saveCustomPieceTheme(name, pieceImages);
      refreshPieceThemes();
      resetPieceForm();
      appAlert('Piece theme added', `"${name}" was added — select it above to use it.`);
    } catch {
      appAlert('Save failed', 'Could not save the piece theme on this device.');
    }
  };

  const handleSelectPieceTheme = (theme: PieceTheme) => {
    if (theme.id === activePieceId) return;
    setActivePieceTheme(theme.id);
  };

  const handleRemovePieceTheme = (theme: PieceTheme) => {
    appAlert('Remove piece theme', `Are you sure you want to remove "${theme.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await deleteCustomPieceTheme(theme.id);
          refreshPieceThemes();
        },
      },
    ]);
  };

  const pickedCount = PIECE_SLOTS.filter((slot) => pieceImages[slot.key]).length;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Board & Piece Themes" onBack={onBack} backLabel="‹ Menu" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionTitle}>Board</Text>
        {boardThemes.map((theme) => {
          const isActive = theme.id === activeBoardId;
          return (
            <Pressable
              key={theme.id}
              style={[styles.row, isActive && styles.rowActive]}
              onPress={() => handleSelectBoardTheme(theme)}
            >
              <View style={styles.boardSwatchPair}>
                <View style={[styles.boardSwatch, { backgroundColor: theme.lightColor }]} />
                <View style={[styles.boardSwatch, { backgroundColor: theme.darkColor }]} />
              </View>
              <View style={styles.rowInfo}>
                <Text style={styles.rowName}>{theme.name}</Text>
                {isActive && <Text style={styles.activeLabel}>Active</Text>}
              </View>
              {theme.isCustom && (
                <Pressable style={styles.removeButton} onPress={() => handleRemoveBoardTheme(theme)}>
                  <Text style={styles.removeButtonText}>Remove</Text>
                </Pressable>
              )}
            </Pressable>
          );
        })}

        {boardAdding ? (
          <View style={styles.addForm}>
            <TextInput
              style={styles.nameInput}
              value={boardNameInput}
              onChangeText={setBoardNameInput}
              placeholder="Theme name, e.g. Ocean"
              autoFocus
            />
            <ColorSwatchPicker label="Light squares" value={lightColor} onChange={setLightColor} />
            <ColorSwatchPicker label="Dark squares" value={darkColor} onChange={setDarkColor} />
            <View style={styles.formButtons}>
              <Pressable style={styles.cancelButton} onPress={resetBoardForm}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.saveButton, !boardNameInput.trim() && styles.saveButtonDisabled]}
                onPress={handleSaveBoardTheme}
                disabled={!boardNameInput.trim()}
              >
                <Text style={styles.saveButtonText}>Save</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={styles.addButton} onPress={() => setBoardAdding(true)}>
            <Text style={styles.addButtonText}>+ Add custom board theme</Text>
          </Pressable>
        )}

        <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>Pieces</Text>
        {pieceThemes.map((theme) => {
          const isActive = theme.id === activePieceId;
          return (
            <Pressable
              key={theme.id}
              style={[styles.row, isActive && styles.rowActive]}
              onPress={() => handleSelectPieceTheme(theme)}
            >
              {theme.images ? (
                <Image source={{ uri: theme.images.wn }} style={styles.pieceThumb} resizeMode="contain" />
              ) : (
                <Text style={styles.pieceThumbGlyph}>♘</Text>
              )}
              <View style={styles.rowInfo}>
                <Text style={styles.rowName}>{theme.name}</Text>
                {isActive && <Text style={styles.activeLabel}>Active</Text>}
              </View>
              {theme.isCustom && (
                <Pressable style={styles.removeButton} onPress={() => handleRemovePieceTheme(theme)}>
                  <Text style={styles.removeButtonText}>Remove</Text>
                </Pressable>
              )}
            </Pressable>
          );
        })}

        {pieceAdding ? (
          <View style={styles.addForm}>
            <TextInput
              style={styles.nameInput}
              value={pieceNameInput}
              onChangeText={setPieceNameInput}
              placeholder="Set name, e.g. Marble"
              autoFocus
            />
            <Text style={styles.pieceCountLabel}>{pickedCount} / 12 images picked</Text>
            <View style={styles.pieceGrid}>
              {PIECE_SLOTS.map((slot) => (
                <Pressable key={slot.key} style={styles.pieceSlot} onPress={() => handlePickPieceImage(slot.key)}>
                  {pieceImages[slot.key] ? (
                    <Image source={{ uri: pieceImages[slot.key] }} style={styles.pieceSlotImage} resizeMode="contain" />
                  ) : (
                    <Text style={styles.pieceSlotPlus}>+</Text>
                  )}
                  <Text style={styles.pieceSlotLabel}>{slot.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.formButtons}>
              <Pressable style={styles.cancelButton} onPress={resetPieceForm}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.saveButton, !pieceNameInput.trim() && styles.saveButtonDisabled]}
                onPress={handleSavePieceTheme}
                disabled={!pieceNameInput.trim()}
              >
                <Text style={styles.saveButtonText}>Save</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={styles.addButton} onPress={() => setPieceAdding(true)}>
            <Text style={styles.addButtonText}>+ Add custom piece theme</Text>
          </Pressable>
        )}

        <Text style={styles.hint}>
          A custom piece set needs all 12 images (white and black — pawn, knight, bishop, rook, queen, king), each a
          PNG or WebP with a transparent background, under {Math.round(MAX_IMAGE_BYTES / 1024)}KB.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#8a7a63',
    textTransform: 'uppercase',
  },
  sectionTitleSpaced: {
    marginTop: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#f0d9b5',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#b58863',
    gap: 12,
  },
  rowActive: {
    borderWidth: 2,
    borderColor: '#2e6f4f',
  },
  boardSwatchPair: {
    flexDirection: 'row',
  },
  boardSwatch: {
    width: 20,
    height: 32,
    borderWidth: 1,
    borderColor: '#3a2618',
  },
  pieceThumb: {
    width: 32,
    height: 32,
  },
  pieceThumbGlyph: {
    width: 32,
    height: 32,
    fontSize: 28,
    textAlign: 'center',
    lineHeight: 32,
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#3a2618',
  },
  activeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2e6f4f',
  },
  removeButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#b00020',
    borderRadius: 6,
  },
  removeButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  addButton: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: '#3a2618',
    borderRadius: 10,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  addForm: {
    gap: 14,
    padding: 14,
    backgroundColor: '#f7f2ea',
    borderRadius: 10,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    backgroundColor: '#fff',
  },
  pieceCountLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3a2618',
  },
  pieceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  pieceSlot: {
    width: 78,
    alignItems: 'center',
    gap: 4,
    padding: 6,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  pieceSlotImage: {
    width: 36,
    height: 36,
  },
  pieceSlotPlus: {
    width: 36,
    height: 36,
    fontSize: 22,
    textAlign: 'center',
    lineHeight: 36,
    color: '#999',
  },
  pieceSlotLabel: {
    fontSize: 10,
    color: '#555',
    textAlign: 'center',
  },
  formButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#ddd',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  saveButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#2e6f4f',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  hint: {
    fontSize: 11,
    color: '#999',
    lineHeight: 15,
  },
});
