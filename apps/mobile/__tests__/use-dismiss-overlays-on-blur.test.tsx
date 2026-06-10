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

  it('does not call dismiss when dismiss callback identity changes', () => {
    const dismiss1 = jest.fn();
    const dismiss2 = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<TestHost dismiss={dismiss1} />);
    });
    act(() => {
      renderer!.update(<TestHost dismiss={dismiss2} />);
    });
    expect(dismiss1).not.toHaveBeenCalled();
    expect(dismiss2).not.toHaveBeenCalled();
    act(() => {
      focusCleanup?.();
    });
    expect(dismiss2).toHaveBeenCalledTimes(1);
    expect(dismiss1).not.toHaveBeenCalled();
  });
});
