import {
  COMPOSER_INPUT_BRIDGE_VERSION,
  decodeComposerInputToHost,
  decodeHostToComposerInput,
  encodeComposerInputToHost,
  encodeHostToComposerInput,
} from '@/components/chat/ComposerInputBridge';
// 单源一致性：web 侧模型（webview bundle 打包真源）同文件参与断言
import {BRIDGE_V} from '@web/composer-input/webview/runtime/model';

const THEME = {
  background: '#ffffff',
  text: '#111111',
  textSecondary: '#666666',
  primary: '#0066cc',
  primaryMuted: '#0066cc22',
  selection: '#0066cc33',
} as const;

const METRICS = {
  fontSize: 16,
  lineHeight: 22,
  paddingH: 4,
  paddingV: 6,
  minHeight: 56,
  maxHeight: 160,
} as const;

describe('composer-input-bridge', () => {
  it('T-CB1：双端 BRIDGE_V 一致（RN 常量 = web 模型）', () => {
    expect(COMPOSER_INPUT_BRIDGE_VERSION).toBe(1);
    expect(BRIDGE_V).toBe(COMPOSER_INPUT_BRIDGE_VERSION);
  });

  it('T-CB2：RN→Web init 信封往返（含 mode/disabled/metrics/placeholder）', () => {
    const message = {
      v: COMPOSER_INPUT_BRIDGE_VERSION,
      type: 'init' as const,
      payload: {
        mode: 'composer-token' as const,
        disabled: true,
        theme: THEME,
        metrics: METRICS,
        placeholder: '问点什么…',
      },
    };
    const parsed = decodeHostToComposerInput(
      encodeHostToComposerInput(message),
    );
    expect(parsed).toEqual(message);
    expect(parsed.payload.mode).toBe('composer-token');
    expect(parsed.payload.disabled).toBe(true);
    expect(parsed.payload.metrics.maxHeight).toBe(160);
  });

  it('T-CB2：宏模式 init 载荷 maxHeight=null（chat 全屏不限高语义）', () => {
    const message = {
      v: COMPOSER_INPUT_BRIDGE_VERSION,
      type: 'init' as const,
      payload: {
        mode: 'prompt-macro' as const,
        disabled: false,
        theme: THEME,
        metrics: {...METRICS, maxHeight: null},
        placeholder: '',
      },
    };
    const parsed = decodeHostToComposerInput(
      encodeHostToComposerInput(message),
    );
    expect(parsed.payload.metrics.maxHeight).toBeNull();
    expect(parsed.payload.mode).toBe('prompt-macro');
  });

  it('T-CB2：RN→Web setText 往返（带与不带 selection 两态）', () => {
    const withSelection = {
      v: COMPOSER_INPUT_BRIDGE_VERSION,
      type: 'setText' as const,
      payload: {text: '看 @src/a.ts', selectionStart: 12, selectionEnd: 12},
    };
    expect(
      decodeHostToComposerInput(encodeHostToComposerInput(withSelection)),
    ).toEqual(withSelection);

    const withoutSelection = {
      v: COMPOSER_INPUT_BRIDGE_VERSION,
      type: 'setText' as const,
      payload: {text: ''},
    };
    expect(
      decodeHostToComposerInput(encodeHostToComposerInput(withoutSelection)),
    ).toEqual(withoutSelection);
  });

  it('T-CB2：RN→Web setSelection / setDisabled / themeUpdate / blur 往返', () => {
    const messages = [
      {
        v: COMPOSER_INPUT_BRIDGE_VERSION,
        type: 'setSelection' as const,
        payload: {start: 0, end: 0},
      },
      {
        v: COMPOSER_INPUT_BRIDGE_VERSION,
        type: 'setDisabled' as const,
        payload: {disabled: false},
      },
      {
        v: COMPOSER_INPUT_BRIDGE_VERSION,
        type: 'themeUpdate' as const,
        payload: {theme: THEME},
      },
      {
        v: COMPOSER_INPUT_BRIDGE_VERSION,
        type: 'blur' as const,
        payload: {},
      },
    ];
    for (const message of messages) {
      expect(
        decodeHostToComposerInput(encodeHostToComposerInput(message)),
      ).toEqual(message);
    }
  });

  it('T-CB3：Web→RN 全消息往返（ready/change/selectionChange/focus/blur/heightChange）', () => {
    const messages = [
      {
        v: COMPOSER_INPUT_BRIDGE_VERSION,
        type: 'ready' as const,
        payload: {version: 1},
      },
      {
        v: COMPOSER_INPUT_BRIDGE_VERSION,
        type: 'change' as const,
        payload: {text: '你好 @a.rb'},
      },
      {
        v: COMPOSER_INPUT_BRIDGE_VERSION,
        type: 'selectionChange' as const,
        payload: {start: 3, end: 8},
      },
      {
        v: COMPOSER_INPUT_BRIDGE_VERSION,
        type: 'focus' as const,
        payload: {},
      },
      {
        v: COMPOSER_INPUT_BRIDGE_VERSION,
        type: 'blur' as const,
        payload: {},
      },
      {
        v: COMPOSER_INPUT_BRIDGE_VERSION,
        type: 'heightChange' as const,
        payload: {height: 78},
      },
    ];
    for (const message of messages) {
      expect(
        decodeComposerInputToHost(encodeComposerInputToHost(message)),
      ).toEqual(message);
    }
  });

  it('T-CB4：坏信封一律抛错（宿主 try/catch 静默丢弃）', () => {
    // v 不符
    expect(() =>
      decodeComposerInputToHost(
        JSON.stringify({v: 99, type: 'change', payload: {text: 'x'}}),
      ),
    ).toThrow(/version/i);
    expect(() =>
      decodeHostToComposerInput(
        JSON.stringify({v: 2, type: 'init', payload: {}}),
      ),
    ).toThrow(/version/i);
    // type 缺失
    expect(() =>
      decodeComposerInputToHost(
        JSON.stringify({v: COMPOSER_INPUT_BRIDGE_VERSION, payload: {}}),
      ),
    ).toThrow(/shape/i);
    expect(() =>
      decodeHostToComposerInput(
        JSON.stringify({v: COMPOSER_INPUT_BRIDGE_VERSION, payload: {}}),
      ),
    ).toThrow(/shape/i);
    // payload 非对象
    expect(() =>
      decodeComposerInputToHost(
        JSON.stringify({v: COMPOSER_INPUT_BRIDGE_VERSION, type: 'change'}),
      ),
    ).toThrow(/shape/i);
    // 数组信封（非 record → v 校验即败）
    expect(() => decodeComposerInputToHost('[]')).toThrow(/version|shape/i);
    // JSON 坏
    expect(() => decodeComposerInputToHost('{oops')).toThrow();
    expect(() => decodeHostToComposerInput('not-json')).toThrow();
  });
});
