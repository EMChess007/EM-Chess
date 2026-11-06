import type { ImageSourcePropType } from 'react-native';
import type { PieceImageSource } from '../types/theme';

/**
 * What an `<Image source>` takes for a piece image. A file URI (a custom theme's file, or a URL under vitest) becomes `{ uri }`; a BUNDLED asset goes in as it is: on a phone `import x from '...png'`
 * is an asset id (a number), in the Expo web build it is already `{ uri, width, height }` - found by the device matrix, which saw every image theme blank on web when this wrapped everything that
 * was not a number in another `{ uri }`. The single place that decides it (a scan pins that no board builds `{ uri: images[...] }` itself).
 */
export function pieceImageSource(image: PieceImageSource): ImageSourcePropType {
  return typeof image === 'string' ? { uri: image } : image;
}
