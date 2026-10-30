import type { ImageSourcePropType } from 'react-native';
import type { PieceImageSource } from '../types/theme';

/** What an `<Image source>` takes for a piece image: a bundled asset id as it is, a file URI as `{ uri }`. The single place that decides it (a scan pins that no board builds `{ uri: images[...] }` itself). */
export function pieceImageSource(image: PieceImageSource): ImageSourcePropType {
  return typeof image === 'number' ? image : { uri: image };
}
