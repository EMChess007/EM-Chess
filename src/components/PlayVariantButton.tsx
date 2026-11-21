import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { Pressable } from './AppPressable';
import ModeButtonLabel from './ModeButtonLabel';
import type { GameVariant } from './VariantSelector';
import { type PlayMenuCard, playRowTestId } from '../logic/playMenuIds';

interface PlayVariantButtonProps {
  card: PlayMenuCard;
  variant: GameVariant;
  label: string;
  onPress: () => void;
  style: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
}

/**
 * One 2-player variant row of the Play menu (command #66, item 0): the button, its label and its testID `play-<card>-<variant>` (`logic/playMenuIds.ts`). A new variant's row written with this
 * component has its stable address without anyone remembering to add one; `playMenuIds.dom.test.tsx` fails when a variant of `TWO_PLAYER_VARIANT_IDS` has no row in the Bots or Local card.
 */
export default function PlayVariantButton({ card, variant, label, onPress, style, textStyle }: PlayVariantButtonProps) {
  return (
    <Pressable testID={playRowTestId(card, variant)} style={style} onPress={onPress}>
      <ModeButtonLabel label={label} style={textStyle} />
    </Pressable>
  );
}
