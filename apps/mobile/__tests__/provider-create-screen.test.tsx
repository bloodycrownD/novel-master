import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {ProviderCreateScreen} from '@/screens/stack/ProviderCreateScreen';

const mockReplace = jest.fn();
const mockShowToast = jest.fn();
const mockCreate = jest.fn();
const mockNavigation = {replace: mockReplace, goBack: jest.fn()};

const createdProvider = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  displayName: '智谱',
  protocol: 'openai' as const,
  baseUrl: 'https://api.example.com/v1',
  headers: {},
  isBuiltin: false,
};

const sampleValues = {
  displayName: '智谱',
  protocol: 'openai' as const,
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'secret-key',
  headersJson: '',
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
}));

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => ({
    providers: {create: mockCreate},
  }),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      textSecondary: '#666',
    },
  }),
}));

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('@/components/provider/ProviderForm', () => {
  const mockReact = require('react');
  return {
    providerFormToCreateInput: jest.fn((values: typeof sampleValues) => ({
      protocol: values.protocol,
      baseUrl: values.baseUrl,
      displayName: values.displayName,
      apiKey: values.apiKey,
    })),
    ProviderForm: ({
      onSubmit,
      saving,
    }: {
      onSubmit: (values: typeof sampleValues) => Promise<void>;
      saving?: boolean;
    }) =>
      mockReact.createElement(
        'Pressable',
        {
          testID: 'provider-form-submit',
          disabled: saving,
          onPress: () => {
            void onSubmit(sampleValues);
          },
        },
        'Create',
      ),
  };
});

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    Pressable: ({
      children,
      onPress,
      disabled,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      testID?: string;
    }) =>
      mockReact.createElement(
        'Pressable',
        {testID, onPress: disabled ? undefined : onPress},
        children,
      ),
    StyleSheet: {create: (s: object) => s},
    View: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', null, children),
  };
});

describe('ProviderCreateScreen (T-PI9)', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockShowToast.mockClear();
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(createdProvider);
  });

  it('创建成功后用返回的 provider.id 导航，toast 用 displayName', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ProviderCreateScreen />);
    });
    const submit = tree.root.findByProps({testID: 'provider-form-submit'});
    await act(async () => {
      submit.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: '智谱',
      }),
    );
    expect(mockCreate.mock.calls[0]?.[0]).not.toHaveProperty('id');
    expect(mockShowToast).toHaveBeenCalledWith('已创建服务商：智谱');
    expect(mockReplace).toHaveBeenCalledWith('ProviderDetail', {
      providerId: createdProvider.id,
    });
  });
});
