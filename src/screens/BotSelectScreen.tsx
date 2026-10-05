import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { BOT_CATEGORIES, getBotsByCategory } from '../logic/bots';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { AVAILABLE_ENGINES, getEngineIdForElo, getEngineName } from '../logic/engines';
import type { BotPersonality } from '../types/bot';

interface BotSelectScreenProps {
  onSelect: (bot: BotPersonality) => void;
  onBack: () => void;
  chess960?: boolean;
  kingOfTheHill?: boolean;
  threeCheck?: boolean;
  setupChess?: boolean;
  fogOfWar?: boolean;
  giveaway?: boolean;
  atomic?: boolean;
  duckChess?: boolean;
  spellChess?: boolean;
  horde?: boolean;
}

/** A placeholder ELO shown for custom-engine cards — irrelevant to actual play, since
 * `engineId` overrides the normal ELO->engine mapping (see getEngineIdForElo). */
const CUSTOM_ENGINE_BOT_ELO = 1500;

function toCustomEngineBot(engineId: string, engineName: string): BotPersonality {
  return {
    id: `custom-bot-${engineId}`,
    name: engineName,
    elo: CUSTOM_ENGINE_BOT_ELO,
    category: 'custom',
    engineId,
  };
}

export default function BotSelectScreen({
  onSelect,
  onBack,
  chess960,
  kingOfTheHill,
  threeCheck,
  setupChess,
  fogOfWar,
  giveaway,
  atomic,
  duckChess,
  spellChess,
  horde,
}: BotSelectScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const customEngines = AVAILABLE_ENGINES.filter((engine) => engine.isCustom);
  const variantName = chess960
    ? 'Chess960'
    : kingOfTheHill
      ? 'King of the Hill'
      : threeCheck
        ? 'Three-Check'
        : setupChess
          ? 'Setup Chess'
          : fogOfWar
            ? 'Fog of War'
            : giveaway
              ? 'Giveaway'
              : atomic
                ? 'Atomic'
                : duckChess
                  ? 'Duck Chess'
                  : spellChess
                    ? 'Spell Chess'
                    : horde
                      ? 'Horde'
                      : undefined;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Select a Bot" subtitle={variantName} onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {BOT_CATEGORIES.map(({ category, label }) => (
          <View key={category} style={styles.section}>
            <Text style={styles.sectionTitle}>{label}</Text>
            <View style={styles.cardList}>
              {getBotsByCategory(category).map((bot) => (
                <Pressable key={bot.id} style={styles.card} onPress={() => onSelect(bot)}>
                  <Text style={styles.cardName}>{bot.name}</Text>
                  <View style={styles.cardMeta}>
                    <Text style={styles.cardElo}>ELO {bot.elo}</Text>
                    {/* Which engine plays this bot is decided automatically from its ELO — see
                        getEngineIdForElo in src/logic/engines.ts — shown here only for
                        transparency, not as something to pick. */}
                    {/* Atomic bots never use a UCI engine (see chooseAtomicBotMove), so naming one here
                        would be wrong. */}
                    <Text style={styles.cardEngine}>{atomic ? 'Atomic search bot' : duckChess ? 'Duck Chess bot' : horde ? 'Horde bot' : getEngineName(getEngineIdForElo(bot.elo))}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        {customEngines.length > 0 && !horde && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>My Engines</Text>
            <View style={styles.cardList}>
              {customEngines.map((engine) => {
                const bot = toCustomEngineBot(engine.id, engine.name);
                return (
                  <Pressable key={bot.id} style={styles.card} onPress={() => onSelect(bot)}>
                    <Text style={styles.cardName}>{bot.name}</Text>
                    <Text style={styles.cardEngine}>Custom engine</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: AppColors) {
  const isDark = colors.mode === 'dark';
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: 16,
      paddingBottom: 32,
      gap: 20,
    },
    section: {
      gap: 10,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    cardList: {
      gap: 10,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      paddingHorizontal: 20,
      backgroundColor: isDark ? '#3a3120' : '#f0d9b5',
      borderRadius: 10,
      borderWidth: 1,
      borderColor: isDark ? '#6b5a3a' : '#b58863',
    },
    cardName: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    cardMeta: {
      alignItems: 'flex-end',
      gap: 2,
    },
    cardElo: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    cardEngine: {
      fontSize: 11,
      color: colors.textSecondary,
    },
  });
}
