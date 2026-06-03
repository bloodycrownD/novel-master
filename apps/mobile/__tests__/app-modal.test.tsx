import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {AppModal} from '../src/components/ui/AppModal';

let mockIsFocused = true;

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockIsFocused,
}));

const mockModalRender = jest.fn(
  (props: {visible?: boolean; children?: React.ReactNode}) =>
    React.createElement('RNModal', props, props.children),
);

jest.mock('react-native', () => ({
  Modal: (props: {visible?: boolean; children?: React.ReactNode}) =>
    mockModalRender(props),
}));

describe('AppModal', () => {
  beforeEach(() => {
    mockIsFocused = true;
    mockModalRender.mockClear();
  });

  it('passes visible=false to RN Modal when screen is unfocused', () => {
    mockIsFocused = false;
    act(() => {
      TestRenderer.create(
        <AppModal visible onRequestClose={jest.fn()}>
          {null}
        </AppModal>,
      );
    });
    expect(mockModalRender).toHaveBeenCalledWith(
      expect.objectContaining({visible: false}),
    );
  });

  it('passes visible=true to RN Modal when visible and focused', () => {
    mockIsFocused = true;
    act(() => {
      TestRenderer.create(
        <AppModal visible onRequestClose={jest.fn()}>
          {null}
        </AppModal>,
      );
    });
    expect(mockModalRender).toHaveBeenCalledWith(
      expect.objectContaining({visible: true}),
    );
  });
});
