import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {ProviderEditScreen} from '../src/screens/stack/ProviderEditScreen';

const mockGoBack = jest.fn();
const mockShowToast = jest.fn();
const mockEdit = jest.fn();
const mockSetStackOverride = jest.fn();
const mockNavigation = {goBack: mockGoBack, replace: jest.fn()};
const mockProvidersGet = jest.fn(async () => ({
  id: 'p1',
  protocol: 'openai',
  baseUrl: 'https://api.example.com',
  displayName: 'Test',
  headers: {},
  isBuiltin: false,
}));
const mockProvidersList = jest.fn(async () => [
  {id: 'p1', apiKeyStatus: 'not set' as const},
]);
const mockRuntime = {
  providers: {
    get: mockProvidersGet,
    list: mockProvidersList,
    edit: mockEdit,
  },
};

const sampleValues = {
  id: 'p1',
  protocol: 'openai' as const,
  baseUrl: 'https://api.example.com',
  displayName: 'Test',
  apiKey: 'secret-key',
  headersJson: '',
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({params: {providerId: 'p1'}}),
}));

jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

jest.mock('../src/navigation/HeaderContext', () => ({
  useHeaderContext: () => ({setStackOverride: mockSetStackOverride}),
}));

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      textSecondary: '#666',
    },
  }),
}));

const mockToastApi = {showToast: mockShowToast};

jest.mock('../src/components/chrome/ToastHost', () => ({
  useToast: () => mockToastApi,
}));

jest.mock('../src/components/provider/ProviderForm', () => {
  const mockReact = require('react');
  return {
    providerFormToEditPatch: jest.fn(() => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'secret-key',
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
        'Save',
      ),
  };
});

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    ActivityIndicator: () => mockReact.createElement('ActivityIndicator'),
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
    Text: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('Text', null, children),
    View: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', null, children),
  };
});

async function renderLoadedScreen(): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<ProviderEditScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return tree;
}

describe('ProviderEditScreen', () => {
  beforeEach(() => {
    mockGoBack.mockClear();
    mockShowToast.mockClear();
    mockEdit.mockReset();
    mockEdit.mockResolvedValue(undefined);
  });

  it('T4: save failure shows toast and does not goBack', async () => {
    mockEdit.mockRejectedValueOnce(new Error('SKSP write failed'));
    const tree = await renderLoadedScreen();
    const submit = tree.root.findByProps({testID: 'provider-form-submit'});
    await act(async () => {
      submit.props.onPress();
      await Promise.resolve();
    });
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringContaining('保存失败'),
    );
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('save success shows toast and goes back', async () => {
    const tree = await renderLoadedScreen();
    const submit = tree.root.findByProps({testID: 'provider-form-submit'});
    await act(async () => {
      submit.props.onPress();
      await Promise.resolve();
    });
    expect(mockShowToast).toHaveBeenCalledWith('已保存');
    expect(mockGoBack).toHaveBeenCalled();
  });
});
