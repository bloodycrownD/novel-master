import {describe, expect, it} from '@jest/globals';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      textSecondary: '#666',
      text: '#000',
      primary: '#08f',
    },
  }),
}));

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: jest.fn()}),
}));

import {
  EMPTY_PROVIDER_FORM,
  parseBodyParamsJson,
  providerFormToCreateInput,
  providerFormToEditPatch,
  type ProviderFormValues,
} from '@/components/provider/ProviderForm';

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

describe('providerForm 自定义参数（provider-body-params）', () => {
  it('create：非空自定义参数原样进入 bodyParams（值任意 JSON）', () => {
    const input = providerFormToCreateInput({
      ...baseValues,
      bodyParamsJson:
        '{"tool_stream": true, "top_k": 5, "nested": {"a": [1, null]}}',
    });
    expect(input.bodyParams).toEqual({
      tool_stream: true,
      top_k: 5,
      nested: {a: [1, null]},
    });
  });

  it('create：空文本自定义参数为显式空对象', () => {
    const input = providerFormToCreateInput(baseValues);
    expect(input.bodyParams).toEqual({});
  });

  it('create：数组根/非 JSON 拖中文错误', () => {
    expect(() =>
      providerFormToCreateInput({
        ...baseValues,
        bodyParamsJson: '[1,2]',
      }),
    ).toThrow(/自定义参数必须是 JSON 对象/);
    expect(() =>
      providerFormToCreateInput({
        ...baseValues,
        bodyParamsJson: 'not-json',
      }),
    ).toThrow();
  });

  it('edit：空文本保存 → 显式清空 bodyParams（区别于不传）', () => {
    const patch = providerFormToEditPatch({
      ...baseValues,
      bodyParamsJson: '',
    });
    // 显式空对象：服务层会写回 {}（清空），而非保留原值
    expect(patch.bodyParams).toEqual({});
    expect('bodyParams' in patch).toBe(true);
  });

  it('edit：非空自定义参数透传解析结果', () => {
    const patch = providerFormToEditPatch({
      ...baseValues,
      bodyParamsJson: '{"temperature": 0.9}',
    });
    expect(patch.bodyParams).toEqual({temperature: 0.9});
  });

  it('edit：headers 空文本仍不写入 patch（既有行为不变）', () => {
    const patch = providerFormToEditPatch({
      ...baseValues,
      headersJson: '',
      bodyParamsJson: '',
    });
    expect('headers' in patch).toBe(false);
    // bodyParams 恒在（清空语义），patch 不会因 headers 空而空
    expect('bodyParams' in patch).toBe(true);
  });

  it('parseBodyParamsJson：null 根拖中文错误，空文本返回 {}', () => {
    expect(parseBodyParamsJson('')).toEqual({});
    expect(parseBodyParamsJson('  ')).toEqual({});
    expect(() => parseBodyParamsJson('null')).toThrow(
      /自定义参数必须是 JSON 对象/,
    );
  });
});
