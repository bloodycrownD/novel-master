import {describe, expect, it} from '@jest/globals';

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      textSecondary: '#666',
      text: '#000',
      primary: '#08f',
    },
  }),
}));

jest.mock('../src/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: jest.fn()}),
}));

import {
  EMPTY_PROVIDER_FORM,
  providerFormToCreateInput,
  providerFormToEditPatch,
  type ProviderFormValues,
} from '../src/components/provider/ProviderForm';

const baseValues: ProviderFormValues = {
  ...EMPTY_PROVIDER_FORM,
  displayName: '智谱',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'secret-key',
};

describe('providerForm helpers (T-PI9)', () => {
  it('providerFormToCreateInput 要求 displayName 且无用户 id', () => {
    const input = providerFormToCreateInput(baseValues);
    expect(input).toMatchObject({
      displayName: '智谱',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret-key',
    });
    expect('id' in input).toBe(false);
  });

  it('providerFormToCreateInput 拒绝空白名称（翻转原 omit displayName）', () => {
    expect(() =>
      providerFormToCreateInput({
        ...baseValues,
        displayName: '   ',
      }),
    ).toThrow(/服务商名称/);
  });

  it('providerFormToEditPatch 可携带 displayName（翻转原 omit）', () => {
    const patch = providerFormToEditPatch({
      ...baseValues,
      displayName: '新名称',
      baseUrl: 'https://api.example.com/v2',
    });
    expect(patch.baseUrl).toBe('https://api.example.com/v2');
    expect(patch.displayName).toBe('新名称');
  });
});
