import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {useDismissOverlaysOnBlur} from '../src/hooks/useDismissOverlaysOnBlur';

let focusCleanup: (() => void) | undefined;

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    focusCleanup = effect() as (() => void) | undefined;
  },
}));

function TestHost({dismiss}: {dismiss: () => void}) {
  useDismissOverlaysOnBlur(dismiss);
  return null;
}

describe('useDismissOverlaysOnBlur', () => {
  beforeEach(() => {
    focusCleanup = undefined;
  });

  it('calls dismiss once when focus cleanup runs', () => {
    const dismiss = jest.fn();
    act(() => {
      TestRenderer.create(<TestHost dismiss={dismiss} />);
    });
    expect(focusCleanup).toBeDefined();
    act(() => {
      focusCleanup?.();
    });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
