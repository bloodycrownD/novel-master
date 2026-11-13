/**
 * SearchEngineDetailScreen 保存语义（web-search-curl T-U3/T-U4，动态清单版）：
 * 详情页经 `getSearchConfigStore(runtime)` 直接消费 core store 方法，本套件锁：
 *
 * - 标题 override 用配置读模型里的引擎名（FIX-23：读模型 name 优先）；
 * - 保存失败 toast 后立即回读（catch 内补 `await load()`），状态标签反映已生效
 *   configured；
 * - 保存成功 toast 且标签同步 set；
 * - 需 key 的预置引擎留空保存：拦截提示，不触碰密钥库、不回读；
 * - create 保存发 createCustomEngine（key / baseUrl 按草稿拆分传参，FIX-25 预填
 *   基线 + 差异提交语义）；
 * - 有覆盖预置的「恢复默认模板」与已配 key 的「清除密钥」写路径（含失败 toast
 *   前缀，ui-copy/G-1）。
 *
 * ui/P2-8 / P2-10 回归锁（CR 第 2 轮）：预置零改动保存不发任何写调用且 toast
 * 「无改动」、baseUrl 同值不发 setEngineBaseUrl。
 * （v3 口径：mobile 测试搜索按钮已退役——testEngine 不在本套件覆盖面；create
 * 模式 curl 导入亦已随本迭代删除，本套件不再覆盖该路径。）
 *
 * 照 search-engines-screen-reorder.test.tsx 的 TestRenderer 直测风格：输入框 /
 * 保存按钮 / 状态标签 mock 成带标记的可交互节点，树文本与调用参数断言；
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
    ApiKeyStatusTag: (props: {status: 'set' | 'not set'}) => mockReact.createElement(Text, {tag: props.status}, `tag:${props.status}`),
  };
});

// 弹窗骨架：visible 时才渲染 children（详情页删除确认默认关闭，无需真实 Modal）。
jest.mock('@/components/ui/ModalShell', () => {
  const mockReact = require('react');
  const {Text} = require('react-native');
  return {
    ModalShell: (props: {visible: boolean; children?: React.ReactNode}) => (props.visible ? mockReact.createElement(Text, null, props.children ?? null) : null),
  };
});

// 表单骨架透传（卡片同时透传 rightAction，保住状态标签在树里）。
jest.mock('@/components/form/FormSectionCard', () => {
  const mockReact = require('react');
  const {View} = require('react-native');
  return {
    FormSectionCard: (props: {children?: React.ReactNode; rightAction?: React.ReactNode}) => mockReact.createElement(View, null, props.rightAction, props.children),
  };
});

jest.mock('@/components/form/FormField', () => {
  const mockReact = require('react');
  const {View} = require('react-native');
  return {
    FormField: (props: {children?: React.ReactNode}) => mockReact.createElement(View, null, props.children),
  };
});

jest.mock('@/components/form/ScreenFormLayout', () => {
  const mockReact = require('react');
  const {View} = require('react-native');
  return {
    // children 与 footer（保存按钮所在）都透传进树。
    ScreenFormLayout: (props: {children?: React.ReactNode; footer?: React.ReactNode}) => mockReact.createElement(View, null, props.children, props.footer),
  };
});

// 保存按钮：可点节点触发 handleSave。
jest.mock('@/components/form/StickyFormFooter', () => {
  const mockReact = require('react');
  const {Pressable, Text} = require('react-native');
  return {
    StickyFormFooter: (props: {onPress: () => void; label: string}) => mockReact.createElement(Pressable, {onPress: props.onPress}, mockReact.createElement(Text, null, props.label)),
  };
});

// 次按钮（添加请求头 / 清除密钥 / 恢复默认等）：可点节点，testLabel 标记定位。
jest.mock('@/components/ui/Buttons', () => {
  const mockReact = require('react');
  const {Pressable, Text} = require('react-native');
  return {
    PrimaryButton: () => null,
    SecondaryButton: (props: {onPress?: () => void; label: string}) =>
      mockReact.createElement(Pressable, {onPress: props.onPress, testLabel: props.label}, mockReact.createElement(Text, null, props.label)),
  };
});

// 输入框：onChangeText / value / placeholder / secureTextEntry / disabled 挂
// props 供测试定位、直接触发与只读断言（key 输入 secureTextEntry 可辨，
// 其余按 placeholder 精确匹配）。
jest.mock('@/components/form/FormTextInput', () => {
  const mockReact = require('react');
  const {Text} = require('react-native');
  return {
    FormTextInput: (props: {value?: string; onChangeText: (text: string) => void; secureTextEntry?: boolean; placeholder?: string; disabled?: boolean}) =>
      mockReact.createElement(
        Text,
        {
          onChangeText: props.onChangeText,
          value: props.value,
          secureTextEntry: props.secureTextEntry,
          placeholder: props.placeholder,
          disabled: props.disabled,
        },
        '',
      ),
  };
});

// 下拉（认证方式）：onChange/value/disabled 挂 props 供测试触发与只读断言。
jest.mock('@/components/form/FormSelectField', () => {
  const mockReact = require('react');
  const {Text} = require('react-native');
  return {
    FormSelectField: (props: {value: string; onChange: (value: string) => void; disabled?: boolean}) =>
      mockReact.createElement(
        Text,
        {
          onChange: props.onChange,
          value: props.value,
          disabled: props.disabled,
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
const mockUpdateCustomEngine = jest.fn();
const mockUpdatePresetOverride = jest.fn();
const mockResetPresetOverride = jest.fn();

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
    updatePresetOverride: (...args: unknown[]) => mockUpdatePresetOverride(...args),
    resetPresetOverride: (...args: unknown[]) => mockResetPresetOverride(...args),
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
import {FormSelectField} from '@/components/form/FormSelectField';
import {StickyFormFooter} from '@/components/form/StickyFormFooter';
import {SecondaryButton} from '@/components/ui/Buttons';

/** 动态读模型 fixture：bocha 的 hasKey 跟随 saveEngineKey 调用次数；patch 可覆写 presetOverrides 等顶层字段。 */
function makeConfig(patch: Partial<SearchConfigPublic> = {}): SearchConfigPublic {
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
function treeText(node: TestRenderer.ReactTestInstance | string | number): string {
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
  const nodes = root.findAllByType(FormTextInput).filter(n => n.props.secureTextEntry);
  expect(nodes.length).toBe(1);
  return nodes[0];
}

/** 按 placeholder 精确匹配定位输入框（FormTextInput mock 把 placeholder 挂 props）。 */
function inputByPlaceholder(root: TestRenderer.ReactTestInstance, placeholder: string) {
  const nodes = root.findAllByType(FormTextInput).filter(n => n.props.placeholder === placeholder);
  expect(nodes.length).toBe(1);
  return nodes[0];
}

/** 按 value 内容片段定位输入框（参数说明等预填字段无 placeholder 稳定值）。 */
function inputContaining(root: TestRenderer.ReactTestInstance, fragment: string) {
  const nodes = root.findAllByType(FormTextInput).filter(n => String(n.props.value ?? '').includes(fragment));
  expect(nodes.length).toBe(1);
  return nodes[0];
}

function saveFooter(root: TestRenderer.ReactTestInstance) {
  return root.findByType(StickyFormFooter);
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

async function typeInto(node: TestRenderer.ReactTestInstance, text: string): Promise<void> {
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
    mockResetPresetOverride.mockReset().mockResolvedValue(undefined);
    mockReadConfig.mockReset().mockImplementation(async () => makeConfig());
  });

  it('详情页标题 override 用配置读模型里的引擎名（FIX-23：name 优先）', async () => {
    await renderScreen();
    expect(mockSetStackOverride).toHaveBeenCalledWith({title: '博查搜索'});
  });

  it('参数说明（内置引擎）：只读展示，不渲染全屏编辑入口', async () => {
    const {renderer} = await renderScreen();
    const hintInput = inputContaining(renderer.root, '博查（POST）');
    expect(hintInput.props.disabled).toBe(true);
    expect(treeText(renderer.root)).not.toContain('⛶');
  });

  it('保存失败后回读，toast 失败且 readConfig 被再次调用', async () => {
    mockSaveEngineKey.mockRejectedValueOnce(new Error('盘炸了'));
    const {renderer} = await renderScreen();
    const readsBefore = mockReadConfig.mock.calls.length;

    await typeKey(renderer.root, 'sk-bocha-1');
    await tapSave(renderer.root);

    expect(mockSaveEngineKey).toHaveBeenCalledWith('bocha', 'sk-bocha-1');
    expect(mockShowToast).toHaveBeenCalledWith('保存失败：盘炸了');
    expect(mockReadConfig.mock.calls.length).toBeGreaterThan(readsBefore);
  });

  it('保存成功：toast 成功（成功路径回归）', async () => {
    const {renderer} = await renderScreen();
    await typeKey(renderer.root, 'sk-bocha-1');
    await tapSave(renderer.root);

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith('配置已保存');
  });

  it('留空保存：拦截并提示，不触碰密钥库、不回读', async () => {
    const {renderer} = await renderScreen();
    const readsBefore = mockReadConfig.mock.calls.length;
    await tapSave(renderer.root);

    expect(mockSaveEngineKey).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith('请输入 API Key（留空不会修改已保存的密钥）');
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

  /** 按按钮文案定位 SecondaryButton mock（实例 props 即屏幕传入的 label，见顶部 mock 说明）。 */
  function buttonByLabel(root: TestRenderer.ReactTestInstance, label: string) {
    const nodes = root.findAllByType(SecondaryButton).filter(node => node.props.label === label);
    expect(nodes.length).toBe(1);
    return nodes[0]!;
  }

  describe('预置写路径：恢复默认模板 / 清除密钥（ui-copy/G-1）', () => {
    it('有覆盖预置点恢复默认：发 resetPresetOverride、toast 完成并静默回读', async () => {
      mockReadConfig.mockImplementation(async () =>
        makeConfig({
          engines: [
            {
              id: 'bocha',
              name: '博查搜索',
              enabled: true,
              needsKey: true,
              hasKey: false,
              needsBaseUrl: false,
              isCustom: false,
              paramHint: '博查参数',
            },
          ],
          presetOverrides: {bocha: true},
        }),
      );
      const {renderer} = await renderScreen();
      const readsBefore = mockReadConfig.mock.calls.length;

      await act(async () => {
        buttonByLabel(renderer.root, '恢复默认模板').props.onPress();
        await flush();
      });

      expect(mockResetPresetOverride).toHaveBeenCalledTimes(1);
      expect(mockResetPresetOverride).toHaveBeenCalledWith('bocha');
      expect(mockShowToast).toHaveBeenCalledWith('已恢复默认模板');
      // 回读让覆盖区按钮随 presetOverrides 复位消失（写成功后的静默 reload）。
      expect(mockReadConfig.mock.calls.length).toBeGreaterThan(readsBefore);
    });

    it('恢复默认失败：toast 失败前缀 + 原因，不回读', async () => {
      mockReadConfig.mockImplementation(async () => makeConfig({presetOverrides: {bocha: true}}));
      mockResetPresetOverride.mockRejectedValueOnce(new Error('盘炸了'));
      const {renderer} = await renderScreen();
      const readsBefore = mockReadConfig.mock.calls.length;

      await act(async () => {
        buttonByLabel(renderer.root, '恢复默认模板').props.onPress();
        await flush();
      });

      expect(mockShowToast).toHaveBeenCalledWith('恢复默认失败：盘炸了');
      // 失败路径无回读（runWrite catch 只 toast）。
      expect(mockReadConfig.mock.calls.length).toBe(readsBefore);
    });

    it('已配 key 点清除密钥：发 clearEngineKey、toast 带引擎名并静默回读', async () => {
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

      await act(async () => {
        buttonByLabel(renderer.root, '清除已存密钥').props.onPress();
        await flush();
      });

      expect(mockClearEngineKey).toHaveBeenCalledTimes(1);
      expect(mockClearEngineKey).toHaveBeenCalledWith('bocha');
      expect(mockShowToast).toHaveBeenCalledWith('已清除 博查搜索 API Key');
      expect(mockReadConfig.mock.calls.length).toBeGreaterThan(readsBefore);
    });

    it('清除密钥失败：toast 失败前缀 + 原因，不回读', async () => {
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
      mockClearEngineKey.mockRejectedValueOnce(new Error('盘炸了'));
      const {renderer} = await renderScreen();
      const readsBefore = mockReadConfig.mock.calls.length;

      await act(async () => {
        buttonByLabel(renderer.root, '清除已存密钥').props.onPress();
        await flush();
      });

      expect(mockShowToast).toHaveBeenCalledWith('清除失败：盘炸了');
      expect(mockReadConfig.mock.calls.length).toBe(readsBefore);
    });
  });

  describe('create 模式（FIX-25 预填 + 差异拆分提交）', () => {
    beforeEach(() => {
      mockRouteParams = undefined;
    });

    it('create 保存发 createCustomEngine：key 单独拆分、无 baseUrl 时该键缺省', async () => {
      const {renderer} = await renderScreen();

      // FIX-25：预填基线（POST + headers/defaultBody 出厂示例），只补显示名/URL/key。
      await typeInto(inputByPlaceholder(renderer.root, '如 我的搜索'), '我的搜索');
      await typeInto(inputByPlaceholder(renderer.root, 'https://api.example.com/search'), 'https://api.example.com/search');
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
      // 预填基线进了模板（POST + JSON 内容头；v3 起无请求体字段、无映射字段）。
      expect(payload.def.template).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: 'Bearer {{apiKey}}',
        },
      });
      expect('defaultBody' in payload.def.template).toBe(false);
      // key / baseUrl 拆分：key 草稿进 apiKey；模板未引用 {{baseUrl}} 时无 baseUrl 键。
      expect(payload.apiKey).toBe('sk-create-1');
      expect('baseUrl' in payload).toBe(false);
      expect(mockShowToast).toHaveBeenCalledWith('已创建自定义引擎');
      expect(mockGoBack).toHaveBeenCalledTimes(1);
    });

    it('create 保存 baseUrl 拆分：模板引用 {{baseUrl}} 时实例地址单独传参', async () => {
      const {renderer} = await renderScreen();
      await typeInto(inputByPlaceholder(renderer.root, '如 我的搜索'), '我的搜索');
      await typeInto(inputByPlaceholder(renderer.root, 'https://api.example.com/search'), '{{baseUrl}}/search?q={{query}}');
      await typeInto(inputByPlaceholder(renderer.root, 'https://search.example.com'), 'https://search.example.com');
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

    it('认证方式下拉：切到自定义请求头并填头名，保存的 headers 带该头且无 Bearer', async () => {
      const {renderer} = await renderScreen();
      await typeInto(inputByPlaceholder(renderer.root, '如 我的搜索'), '我的搜索');
      await typeInto(inputByPlaceholder(renderer.root, 'https://api.example.com/search'), 'https://api.example.com/search');
      await act(async () => {
        renderer.root.findByType(FormSelectField).props.onChange('header');
        await flush();
      });
      await typeInto(inputByPlaceholder(renderer.root, 'X-API-Key'), 'X-API-Key');
      await tapSave(renderer.root);

      expect(mockCreateCustomEngine).toHaveBeenCalledTimes(1);
      const payload = mockCreateCustomEngine.mock.calls[0]![0] as {
        def: {template: {headers: Record<string, string>}};
      };
      expect(payload.def.template.headers['X-API-Key']).toBe('{{apiKey}}');
      expect(payload.def.template.headers.Authorization).toBeUndefined();
    });
  });

  it('内置引擎（bocha）名称与方法只读：显示名禁用、方法 chip 组禁用（v3 锁内置元数据）', async () => {
    const {renderer} = await renderScreen();
    const nameInput = inputByPlaceholder(renderer.root, '如 我的搜索');
    expect(nameInput.props.disabled).toBe(true);
    const methodGroup = renderer.root.findAllByType(FormChipGroup).filter(node => node.props.options.some((option: {value: string}) => option.value === 'GET'));
    expect(methodGroup.length).toBe(1);
    expect(methodGroup[0]!.props.disabled).toBe(true);
    // 认证方式下拉同样锁死（内置认证头出厂固定）。
    expect(renderer.root.findByType(FormSelectField).props.disabled).toBe(true);
  });
});
