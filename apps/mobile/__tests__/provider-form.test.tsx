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
  id: 'my-openai',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'secret-key',
};

describe('providerForm helpers', () => {
  it('providerFormToCreateInput omits displayName (T5)', () => {
    const input = providerFormToCreateInput(baseValues);
    expect(input).toMatchObject({
      id: 'my-openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret-key',
    });
    expect('displayName' in input).toBe(false);
  });

  it('providerFormToEditPatch omits displayName key (T5)', () => {
    const patch = providerFormToEditPatch({
      ...baseValues,
      baseUrl: 'https://api.example.com/v2',
    });
    expect(patch.baseUrl).toBe('https://api.example.com/v2');
    expect('displayName' in patch).toBe(false);
  });
});
