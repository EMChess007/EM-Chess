import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import VariantSelector, { type GameVariant } from '../VariantSelector';

/**
 * Command #62: PR #47's online slice judged `tap {"label":"Chaturaji"}` (Create Challenge) LOST because choosing a chip changes no words on the screen; the friend buddy then "joined the
 * chaturaji room", so the tap had landed. The chosen chip is now `selected` for accessibility (TalkBack says it; the Android tree carries selected="true", which the e2e judge reads).
 */
function Harness() {
  const [value, setValue] = useState<GameVariant>('classic');
  return <VariantSelector value={value} onChange={setValue} />;
}

describe('VariantSelector: the chosen chip is selected for accessibility', () => {
  it('exactly one chip is selected, and a tap on another chip moves the selection', () => {
    render(<Harness />);
    const selected = () => screen.getAllByLabelText(/.+/).filter((el) => el.getAttribute('aria-selected') === 'true').map((el) => el.getAttribute('aria-label'));
    expect(selected()).toEqual(['Classic']);
    fireEvent.click(screen.getByLabelText('Horde'));
    expect(selected()).toEqual(['Horde']);
  });
});
