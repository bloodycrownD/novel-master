import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {AboutScreen} from '../src/screens/stack/AboutScreen';

jest.mock('../src/runtime/novel-master-context', () => ({
  useNovelMaster: () => ({
    appUi: {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    },
  }),
}));

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      text: '#000',
      textSecondary: '#666',
      surfaceElevated: '#f5f5f5',
      borderLight: '#eee',
    },
  }),
}));

jest.mock('../src/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: jest.fn()}),
}));

describe('AboutScreen', () => {
  it('renders version text', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<AboutScreen />);
    });
    const json = JSON.stringify(tree!.toJSON());
    expect(json).toMatch(/版本/);
    expect(json).toMatch(/Novel Master/);
  });
});
