/**
 * SearchEngineDetailScreen 保存/测试语义（web-search-curl T-U3/T-U4，动态清单版）：
 * 详情页经 `getSearchConfigStore(runtime)` 直接消费 core store 方法，本套件锁：
 *
 * - 标题 override 用配置读模型里的引擎名（FIX-23：读模型 name 优先）；
 * - 保存失败 toast 后立即回读（catch 内补 `await load()`），状态标签反映已生效
 *   configured；
 * - 保存成功 toast 且标签同步 set；
 * - 需 key 的预置引擎留空保存：拦截提示，不触碰密钥库、不回读；
 * - create 保存发 createCustomEngine（key / baseUrl 按草稿拆分传参，FIX-25 预填
 *   基线 + 差异提交语义）；
 * - 测试请求分流（FIX-1 拍板 1 回归锁）：预置有覆盖且表单未改（key/baseUrl 草稿
 *   空）→ 只传 engineId 不带 draft（core 合并覆盖 + SKSP 现读）；表单改动 /
 *   key 草稿非空 / 无覆盖 → 带 draft 草稿直测。
 *
 * ui/P2-8 / P2-10 回归锁（CR 第 2 轮）：预置零改动保存不发任何写调用且 toast
 * 「无改动」、baseUrl 同值不发 setEngineBaseUrl；测试失败文案错误红（FIX-27）；
 * create 模式 curl 导入预填（parseCurlCommand 真函数：method/URL/headers/
 * defaultBody 回填，明文密钥替换 {{apiKey}} 并回填 key 草稿）。
 *
 * 照 search-engines-screen-reorder.test.tsx 的 TestRenderer 直测风格：输入框 /
 * 保存 / 测试按钮 / 状态标签 mock 成带标记的可交互节点，树文本与调用参数断言；
 * store mock 扩到 core `SearchConfigStore` 全方法。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import type {SearchConfigPublic} from '@novel-master/core';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      surface: '#f8f8f8',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      border: '#ccc',
      borderLight: '#ddd',
      primary: '#007aff',
      danger: '#f00',
      success: '#0a0',
    },
  }),
}));

const mockShowToast = jest.fn();
const mockGoBack = jest.fn();
const mockSetStackOverride = jest.fn();

// 路由参数可变：默认 bocha（需 key 的预置引擎），create 用例置 undefined。
let mockRouteParams: {engineId?: string} | undefined = {engineId: 'bocha'};

jest.mock('@react-navigation/native', () => {
  const mockReact = require('react');
  return {
    // 依赖数组跟随回调身份：标题变化后重设 override，对齐 focus 语义。
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockReact.useEffect(cb, [cb]);
    },
    useRoute: () => ({params: mockRouteParams}),
    useNavigation: () => ({goBack: mockGoBack}),
  };
});

jest.mock('@/navigation/HeaderContext', () => ({
  useStackOverrideSetter: () => mockSetStackOverride,
}));

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

// 状态标签：输出状态文本，断言回读后 set / not set 翻转。
jest.mock('@/components/provider/ApiKeyStatusTag', () => {
  const mockReact = require('react');
  const {Text} = require('react-native');
  return {
    ApiKeyStatusTag: (props: {status: 'set' | 'not set'}) =>
      mockReact.createElement(Text, {tag: props.status}, `tag:${props.status}`),
  };
});

// 弹窗骨架：visible 时才渲染 children（详情页删除确认默认关闭，无需真实 Modal）。
jest.mock('@/components/ui/ModalShell', () => {
  const mockReact = require('react');
  const {Text} = require('react-native');
  return {
    ModalShell: (props: {visible: boolean; children?: React.ReactNode}) =>
      props.visible
        ? mockReact.createElement(Text, null, props.children ?? null)
        : null,
  };
});

// 表单骨架透传（卡片同时透传 rightAction，保住状态标签在树里）。
jest.mock('@/components/form/FormSectionCard', () => {
  const mockReact = require('react');
  const {View} = require('react-native');
  return {
    FormSectionCard: (props: {
      children?: React.ReactNode;
      rightAction?: React.ReactNode;
    }) =>
      mockReact.createElement(View, null, props.rightAction, props.children),
  };
});

jest.mock('@/components/form/FormField', () => {
  const mockReact = require('react');
  const {View} = require('react-native');
  return {
    FormField: (props: {children?: React.ReactNode}) =>
      mockReact.createElement(View, null, props.children),
  };
});

jest.mock('@/components/form/ScreenFormLayout', () => {
  const mockReact = require('react');
  const {View} = require('react-native');
  return {
    // children 与 footer（保存按钮所在）都透传进树。
    ScreenFormLayout: (props: {
      children?: React.ReactNode;
      footer?: React.ReactNode;
    }) => mockReact.createElement(View, null, props.children, props.footer),
  };
});

// 保存按钮：可点节点触发 handleSave。
jest.mock('@/components/form/StickyFormFooter', () => {
  const mockReact = require('react');
  const {Pressable, Text} = require('react-native');
  return {
    StickyFormFooter: (props: {onPress: () => void; label: string}) =>
      mockReact.createElement(
        Pressable,
        {onPress: props.onPress},
        mockReact.createElement(Text, null, props.label),
      ),
  };
});

// 次按钮（测试搜索 / curl 解析 / 清除密钥等）：可点节点，testLabel 标记定位。
jest.mock('@/components/ui/Buttons', () => {
  const mockReact = require('react');
  const {Pressable, Text} = require('react-native');
  return {
    PrimaryButton: () => null,
    SecondaryButton: (props: {onPress?: () => void; label: string}) =>
      mockReact.createElement(
        Pressable,
        {onPress: props.onPress, testLabel: props.label},
        mockReact.createElement(Text, null, props.label),
      ),
  };
});

// 输入框：onChangeText / value / placeholder / secureTextEntry 挂 props 供测试
// 定位、直接触发与预填断言（key 输入 secureTextEntry 可辨，其余按 placeholder
// 精确匹配；curl 导入用例靠 value 断言表单回填）。
jest.mock('@/components/form/FormTextInput', () => {
  const mockReact = require('react');
  const {Text} = require('react-native');
  return {
    FormTextInput: (props: {
      value?: string;
      onChangeText: (text: string) => void;
      secureTextEntry?: boolean;
      placeholder?: string;
    }) =>
      mockReact.createElement(
        Text,
        {
          onChangeText: props.onChangeText,
          value: props.value,
          secureTextEntry: props.secureTextEntry,
          placeholder: props.placeholder,
        },
        '',
      ),
  };
});

// searchConfig store（core `SearchConfigStore` 形状）：readConfig 的 bocha
// hasKey 随 saveEngineKey 调用次数动态变化，模拟「key 已落库生效」状态；
// 预置/自定义写方法提具名 mock，供零改动保存「不发任何写调用」断言。
const mockReadConfig = jest.fn();
const mockSaveEngineKey = jest.fn();
const mockClearEngineKey = jest.fn();
const mockCreateCustomEngine = jest.fn();
const mockSetEngineBaseUrl = jest.fn();
const mockTestEngine = jest.fn();
const mockUpdateCustomEngine = jest.fn();
const mockUpdatePresetOverride = jest.fn();

const mockRuntime = {
  searchConfig: {
    readConfig: (...args: unknown[]) => mockReadConfig(...args),
    saveEngineKey: (...args: unknown[]) => mockSaveEngineKey(...args),
    clearEngineKey: (...args: unknown[]) => mockClearEngineKey(...args),
    setEnabled: jest.fn(),
    setEngineOrder: jest.fn(),
    setEngineBaseUrl: (...args: unknown[]) => mockSetEngineBaseUrl(...args),
    createCustomEngine: (...args: unknown[]) => mockCreateCustomEngine(...args),
    updateCustomEngine: (...args: unknown[]) => mockUpdateCustomEngine(...args),
    deleteCustomEngine: jest.fn(),
    updatePresetOverride: (...args: unknown[]) =>
      mockUpdatePresetOverride(...args),
    resetPresetOverride: jest.fn(),
    testEngine: (...args: unknown[]) => mockTestEngine(...args),
  },
};

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

import {SearchEngineDetailScreen} from '@/screens/stack/SearchEngineDetailScreen';
// 被替换后的 mock 组件引用：用 findAllByType 精确定位（RN 宿主组件会把
// 自定义 props 复制到内部嵌套节点，按 props findAll 会重复匹配）。
import {FormTextInput} from '@/components/form/FormTextInput';
import {FormChipGroup} from '@/components/form/FormChipGroup';
import {StickyFormFooter} from '@/components/form/StickyFormFooter';
import {SecondaryButton} from '@/components/ui/Buttons';

/** 动态读模型 fixture：bocha 的 hasKey 跟随 saveEngineKey 调用次数；patch 可覆写 presetOverrides 等顶层字段。 */
function makeConfig(
  patch: Partial<SearchConfigPublic> = {},
): SearchConfigPublic {
  return {
    engines: [
      {
        id: 'bocha',
        name: '博查搜索',
        enabled: true,
        needsKey: true,
        hasKey: mockSaveEngineKey.mock.calls.length > 0,
        needsBaseUrl: false,
        isCustom: false,
        paramHint: '博查参数',
      },
    ],
    customEngines: [],
    presetOverrides: {},
    canRun: [],
    ...patch,
  };
}

/** 递归收集渲染树里全部展示文本（避开 toJSON 的循环引用）。 */
function treeText(
  node: TestRenderer.ReactTestInstance | string | number,
): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  let out = '';
  for (const child of node.children) {
    out += treeText(child);
  }
  return out;
}

/** 取 key 输入框（secureTextEntry 标记；create/预置表单各只有密钥框一个）。 */
function keyInput(root: TestRenderer.ReactTestInstance) {
  const nodes = root
    .findAllByType(FormTextInput)
    .filter(n => n.props.secureTextEntry);
  expect(nodes.length).toBe(1);
  return nodes[0];
}

/** 按 placeholder 精确匹配定位输入框（FormTextInput mock 把 placeholder 挂 props）。 */
function inputByPlaceholder(
  root: TestRenderer.ReactTestInstance,
  placeholder: string,
) {
  const nodes = root
    .findAllByType(FormTextInput)
    .filter(n => n.props.placeholder === placeholder);
  expect(nodes.length).toBe(1);
  return nodes[0];
}

function saveFooter(root: TestRenderer.ReactTestInstance) {
  return root.findByType(StickyFormFooter);
}

/** 测试搜索按钮（SecondaryButton 复合节点的 label prop 定位）。 */
function testButton(root: TestRenderer.ReactTestInstance) {
  const nodes = root
    .findAllByType(SecondaryButton)
    .filter(n => n.props.label === '测试搜索');
  expect(nodes.length).toBe(1);
  return nodes[0];
}

async function renderScreen() {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<SearchEngineDetailScreen />);
    // 首轮 load（readConfig → setConfig/setDraft）的 promise 链落定。
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
  return {renderer: renderer!};
}

/** 输入 draft（单独 act flush 重渲染，保证 handleSave 闭包捕获新 draft）。 */
async function typeKey(root: TestRenderer.ReactTestInstance, text: string) {
  await act(async () => {
    keyInput(root).props.onChangeText(text);
  });
}

async function typeInto(
  node: TestRenderer.ReactTestInstance,
  text: string,
): Promise<void> {
  await act(async () => {
    node.props.onChangeText(text);
  });
}

/** flush 整条 async 链（写操作 → toast/回读/导航的多级 await）。 */
async function flush() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

/** 点保存并 flush 整条 async 链（含 catch 内回读的 load）。 */
async function tapSave(root: TestRenderer.ReactTestInstance) {
  await act(async () => {
    saveFooter(root).props.onPress();
    // saveEngineKey →（catch）load 内 readConfig 的 promise 链逐级
    // await，多轮 microtask 全部落定。
    await flush();
  });
}

/** 点「测试搜索」并 flush 草稿直测的 async 链。 */
async function tapTest(root: TestRenderer.ReactTestInstance) {
  await act(async () => {
    testButton(root).props.onPress();
    await flush();
  });
}

describe('SearchEngineDetailScreen 保存语义（web-search-curl 动态清单）', () => {
  beforeEach(() => {
    mockRouteParams = {engineId: 'bocha'};
    mockShowToast.mockReset();
    mockGoBack.mockReset();
    mockSetStackOverride.mockReset();
    mockSaveEngineKey.mockReset().mockResolvedValue(undefined);
    mockClearEngineKey.mockReset().mockResolvedValue(undefined);
    mockCreateCustomEngine.mockReset().mockResolvedValue(undefined);
    mockSetEngineBaseUrl.mockReset().mockResolvedValue(undefined);
    mockUpdateCustomEngine.mockReset().mockResolvedValue(undefined);
    mockUpdatePresetOverride.mockReset().mockResolvedValue(undefined);
    mockTestEngine.mockReset().mockResolvedValue({
      ok: true,
      value: {preview: '[{"title":"T"}]', resultCount: 2, truncated: false},
    });
    mockReadConfig.mockReset().mockImplementation(async () => makeConfig());
  });

  it('详情页标题 override 用配置读模型里的引擎名（FIX-23：name 优先）', async () => {
    await renderScreen();
    expect(mockSetStackOverride).toHaveBeenCalledWith({title: '博查搜索'});
  });

  it('保存失败后回读，toast 失败且 readConfig 被再次调用', async () => {
    mockSaveEngineKey.mockRejectedValueOnce(new Error('盘炸了'));
    const {renderer} = await renderScreen();
    expect(treeText(renderer.root)).toContain('tag:not set');
    const readsBefore = mockReadConfig.mock.calls.length;

    await typeKey(renderer.root, 'sk-bocha-1');
    await tapSave(renderer.root);

    // toast 失败 + catch 内回读（状态标签刷新链路被触发）。
    expect(mockSaveEngineKey).toHaveBeenCalledWith('bocha', 'sk-bocha-1');
    expect(mockShowToast).toHaveBeenCalledWith('保存失败：盘炸了');
    expect(mockReadConfig.mock.calls.length).toBeGreaterThan(readsBefore);
  });

  it('保存成功：toast 成功且标签同步为 set（成功路径回归）', async () => {
    const {renderer} = await renderScreen();
    await typeKey(renderer.root, 'sk-bocha-1');
    await tapSave(renderer.root);

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith('配置已保存');
    expect(treeText(renderer.root)).toContain('tag:set');
  });

  it('留空保存：拦截并提示，不触碰密钥库、不回读', async () => {
    const {renderer} = await renderScreen();
    const readsBefore = mockReadConfig.mock.calls.length;
    await tapSave(renderer.root);

    expect(mockSaveEngineKey).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(
      '请输入 API Key（留空不会修改已保存的密钥）',
    );
    // 拦截早退：无成功链路的回读（readConfig 调用数不变）。
    expect(mockReadConfig.mock.calls.length).toBe(readsBefore);
  });

  it('零改动保存：不发任何写调用且 toast「无改动」（ui/P2-8 对齐 desktop）', async () => {
    // bocha 已存 key（不触发拦截）+ 表单未改 + key/baseUrl 草稿空 → 零写操作。
    mockReadConfig.mockImplementation(async () =>
      makeConfig({
        engines: [
          {
            id: 'bocha',
            name: '博查搜索',
            enabled: true,
            needsKey: true,
            hasKey: true,
            needsBaseUrl: false,
            isCustom: false,
            paramHint: '博查参数',
          },
        ],
      }),
    );
    const {renderer} = await renderScreen();
    const readsBefore = mockReadConfig.mock.calls.length;
    await tapSave(renderer.root);

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith('无改动');
    expect(mockUpdatePresetOverride).not.toHaveBeenCalled();
    expect(mockSaveEngineKey).not.toHaveBeenCalled();
    expect(mockSetEngineBaseUrl).not.toHaveBeenCalled();
    expect(mockUpdateCustomEngine).not.toHaveBeenCalled();
    // 零改动早退：无成功链路的回读（readConfig 调用数不变）。
    expect(mockReadConfig.mock.calls.length).toBe(readsBefore);
  });

  it('baseUrl 同值保存：不发 setEngineBaseUrl（ui/P2-8 同值不写）', async () => {
    // searxng 出厂模板引用 {{baseUrl}}：已存实例地址与草稿相同 → 无写操作早退，
    // 锁「仅 baseUrlChanged 才发 setEngineBaseUrl」的 desktop 同款判定。
    mockRouteParams = {engineId: 'searxng'};
    mockReadConfig.mockImplementation(async () =>
      makeConfig({
        engines: [
          {
            id: 'searxng',
            name: 'SearXNG',
            enabled: true,
            needsKey: false,
            hasKey: false,
            needsBaseUrl: true,
            baseUrl: 'https://searx.example.com',
            isCustom: false,
            paramHint: '',
          },
        ],
      }),
    );
    const {renderer} = await renderScreen();
    const readsBefore = mockReadConfig.mock.calls.length;
    await tapSave(renderer.root);

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith('无改动');
    expect(mockSetEngineBaseUrl).not.toHaveBeenCalled();
    expect(mockUpdatePresetOverride).not.toHaveBeenCalled();
    expect(mockSaveEngineKey).not.toHaveBeenCalled();
    expect(mockReadConfig.mock.calls.length).toBe(readsBefore);
  });

  describe('create 模式（FIX-25 预填 + 差异拆分提交）', () => {
    beforeEach(() => {
      mockRouteParams = undefined;
    });

    it('create 保存发 createCustomEngine：key 单独拆分、无 baseUrl 时该键缺省', async () => {
      const {renderer} = await renderScreen();

      // FIX-25：预填基线（POST + headers/defaultBody 出厂示例），只补显示名/URL/key。
      await typeInto(
        inputByPlaceholder(renderer.root, '如 我的搜索'),
        '我的搜索',
      );
      await typeInto(
        inputByPlaceholder(renderer.root, 'https://api.example.com/search'),
        'https://api.example.com/search',
      );
      await typeKey(renderer.root, 'sk-create-1');
      await tapSave(renderer.root);

      expect(mockCreateCustomEngine).toHaveBeenCalledTimes(1);
      const payload = mockCreateCustomEngine.mock.calls[0]![0] as {
        def: {id: string; name: string; template: Record<string, unknown>};
        apiKey?: string;
        baseUrl?: string;
      };
      expect(payload.def.id).toMatch(/^custom:[0-9a-z]{8}$/);
      expect(payload.def.name).toBe('我的搜索');
      // 预填基线进了模板（POST + JSON 头 + defaultBody 示例；v2 无映射字段）。
      expect(payload.def.template).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        defaultBody: JSON.stringify(
          {query: '{{query}}', count: '{{count}}'},
          null,
          2,
        ),
      });
      // key / baseUrl 拆分：key 草稿进 apiKey；模板未引用 {{baseUrl}} 时无 baseUrl 键。
      expect(payload.apiKey).toBe('sk-create-1');
      expect('baseUrl' in payload).toBe(false);
      expect(mockShowToast).toHaveBeenCalledWith('已创建自定义引擎');
      expect(mockGoBack).toHaveBeenCalledTimes(1);
    });

    it('create 保存 baseUrl 拆分：模板引用 {{baseUrl}} 时实例地址单独传参', async () => {
      const {renderer} = await renderScreen();
      await typeInto(
        inputByPlaceholder(renderer.root, '如 我的搜索'),
        '我的搜索',
      );
      await typeInto(
        inputByPlaceholder(renderer.root, 'https://api.example.com/search'),
        '{{baseUrl}}/search?q={{query}}',
      );
      await typeInto(
        inputByPlaceholder(renderer.root, 'https://search.example.com'),
        'https://search.example.com',
      );
      await tapSave(renderer.root);

      expect(mockCreateCustomEngine).toHaveBeenCalledTimes(1);
      const payload = mockCreateCustomEngine.mock.calls[0]![0] as {
        def: {template: {url: string}};
        apiKey?: string;
        baseUrl?: string;
      };
      expect(payload.def.template.url).toBe('{{baseUrl}}/search?q={{query}}');
      expect(payload.baseUrl).toBe('https://search.example.com');
      expect('apiKey' in payload).toBe(false);
    });

    it('curl 导入：预填 method/URL/headers/defaultBody，密钥替换 {{apiKey}} 并回填 key 草稿', async () => {
      const {renderer} = await renderScreen();
      const curlInput = inputByPlaceholder(
        renderer.root,
        "curl -X POST https://api.example.com/search -H 'Authorization: Bearer ...' -d '{...}'",
      );
      await typeInto(
        curlInput,
        'curl -X POST https://api.example.com/search -H "Authorization: Bearer sk-abcdef123456789012" -d \'{"query":"{{query}}"}\'',
      );
      await act(async () => {
        renderer.root
          .findAllByType(SecondaryButton)
          .filter(node => node.props.label === '解析并预填')[0]
          .props.onPress();
        await flush();
      });

      expect(mockShowToast).toHaveBeenCalledWith(
        '已解析 curl 命令，请补全显示名后保存',
      );
      // method 预填 POST（options 含 GET 的那组 chip 是请求方法组）。
      const methodChip = renderer.root
        .findAllByType(FormChipGroup)
        .filter(node =>
          node.props.options.some(
            (option: {value: string}) => option.value === 'GET',
          ),
        );
      expect(methodChip.length).toBe(1);
      expect(methodChip[0].props.value).toBe('POST');
      // URL / headers / defaultBody 预填；明文密钥替换为 {{apiKey}} 占位符。
      expect(
        inputByPlaceholder(renderer.root, 'https://api.example.com/search')
          .props.value,
      ).toBe('https://api.example.com/search');
      const headers = inputByPlaceholder(
        renderer.root,
        '{"Accept": "application/json"}',
      );
      expect(headers.props.value).toContain('Bearer {{apiKey}}');
      expect(headers.props.value).not.toContain('sk-abcdef');
      const body = inputByPlaceholder(
        renderer.root,
        '{"query": "{{query}}", "count": "{{count}}"}',
      );
      expect(body.props.value).toBe('{"query":"{{query}}"}');
      // 识别出的密钥原文回填 key 草稿（保存时落密钥库，不留在模板里）。
      expect(keyInput(renderer.root).props.value).toBe('sk-abcdef123456789012');
    });
  });

  it('测试成功渲染 v2 预览：共 N 条 + JSON 预览 + 截断标记（TestEngineSuccess 新形状）', async () => {
    mockTestEngine.mockResolvedValue({
      ok: true,
      value: {
        preview: '[{"title":"第一条"},{"title":"第二条"}]',
        resultCount: 12,
        truncated: true,
      },
    });
    const {renderer} = await renderScreen();
    await typeInto(
      inputByPlaceholder(renderer.root, '如 人工智能'),
      '人工智能',
    );
    await tapTest(renderer.root);

    // spec v2 §5：preview 文本块 + resultCount（「共 N 条」）+ truncated 标记，
    // 不再渲染 title/url 人类列表。
    const text = treeText(renderer.root);
    expect(text).toContain('共 12 条');
    expect(text).toContain('[{"title":"第一条"},{"title":"第二条"}]');
    expect(text).toContain('（预览已截断）');
    expect(text).not.toContain('返回 12 条结果');
  });

  it('测试失败文案红色展示（tokens.danger，FIX-27 回归锁）', async () => {
    mockTestEngine.mockResolvedValue({
      ok: false,
      error: {message: '引擎不可用（测试桩）'},
    });
    const {renderer} = await renderScreen();
    await typeInto(
      inputByPlaceholder(renderer.root, '如 人工智能'),
      '人工智能',
    );
    await tapTest(renderer.root);

    const text = treeText(renderer.root);
    expect(text).toContain('测试失败：引擎不可用（测试桩）');
    const failNode = renderer.root
      .findAll(
        node =>
          typeof node.props.children === 'string' &&
          node.props.children.includes('测试失败'),
      )
      .at(0);
    expect(failNode).toBeDefined();
    // 失败文案用错误红（mock tokens.danger = '#f00'），与成功说明的次级灰区分。
    expect(failNode!.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({color: '#f00'})]),
    );
  });

  describe('测试请求分流（FIX-1 拍板 1 回归锁）', () => {
    async function typeAndTest(renderer: TestRenderer.ReactTestRenderer) {
      await typeInto(
        inputByPlaceholder(renderer.root, '如 人工智能'),
        '人工智能',
      );
      await tapTest(renderer.root);
    }

    it('预置有覆盖且表单未改：测试请求只传 engineId，不带 draft', async () => {
      mockReadConfig.mockImplementation(async () =>
        makeConfig({presetOverrides: {bocha: true}}),
      );
      const {renderer} = await renderScreen();
      await typeAndTest(renderer);

      expect(mockTestEngine).toHaveBeenCalledTimes(1);
      // toEqual 严格形状：恰为 engineId + query，draft 键必须缺省。
      expect(mockTestEngine).toHaveBeenCalledWith({
        engineId: 'bocha',
        query: '人工智能',
      });
    });

    it('预置有覆盖但表单改动：测试请求带 draft（草稿直测语义不变）', async () => {
      mockReadConfig.mockImplementation(async () =>
        makeConfig({presetOverrides: {bocha: true}}),
      );
      const {renderer} = await renderScreen();
      // v2 全平铺：模板字段不再藏折叠区，URL 输入框直接定位。
      await typeInto(
        inputByPlaceholder(renderer.root, 'https://api.example.com/search'),
        'https://api.example.com/v2',
      );
      await typeAndTest(renderer);

      expect(mockTestEngine).toHaveBeenCalledTimes(1);
      const req = mockTestEngine.mock.calls[0]![0] as {
        engineId: string;
        draft?: {template: {url: string}};
        query: string;
      };
      expect(req.engineId).toBe('bocha');
      expect(req.query).toBe('人工智能');
      expect(req.draft).toBeDefined();
      expect(req.draft!.template.url).toBe('https://api.example.com/v2');
    });

    it('预置有覆盖但 key 草稿非空：测试请求带 draft（凭据草稿直测）', async () => {
      mockReadConfig.mockImplementation(async () =>
        makeConfig({presetOverrides: {bocha: true}}),
      );
      const {renderer} = await renderScreen();
      await typeKey(renderer.root, 'sk-draft-1');
      await typeAndTest(renderer);

      const req = mockTestEngine.mock.calls[0]![0] as {
        draft?: {apiKey?: string};
      };
      expect(req.draft).toBeDefined();
      expect(req.draft!.apiKey).toBe('sk-draft-1');
    });

    it('预置无覆盖：即使表单与出厂相等也带 draft（覆盖开关是省略前提）', async () => {
      const {renderer} = await renderScreen();
      await typeAndTest(renderer);

      const req = mockTestEngine.mock.calls[0]![0] as {
        engineId: string;
        draft?: {template: {name: string}};
      };
      expect(req.engineId).toBe('bocha');
      expect(req.draft).toBeDefined();
      // 出厂模板经表单往返无损（草稿直测的模板与出厂逐字段一致）。
      expect(req.draft!.template.name).toBe('博查搜索');
    });
  });
});
