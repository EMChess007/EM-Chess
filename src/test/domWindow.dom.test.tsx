import { Dimensions } from 'react-native';
import { describe, expect, it } from 'vitest';
import { setWindowSize } from './domKit';

/**
 * The rendered tests' window: every test starts as a phone (412 x 915, domSetup.ts) - jsdom's own answer would be 0 x 0 - and a test that resizes it leaves the next one
 * at the default again. The two tests run in this order on purpose.
 */
describe('the default window of a rendered test', () => {
  it('is 412 x 915 as react-native-web sees it, and a resize is followed', () => {
    expect(Dimensions.get('window')).toMatchObject({ width: 412, height: 915 });
    setWindowSize(360, 640);
    expect(Dimensions.get('window')).toMatchObject({ width: 360, height: 640 });
  });

  it('is back at 412 x 915 in the next test', () => {
    expect(Dimensions.get('window')).toMatchObject({ width: 412, height: 915 });
    expect(window.innerWidth).toBe(412);
    expect(document.documentElement.clientHeight).toBe(915);
  });
});
