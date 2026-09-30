import {
  decodeHostToCodeEditor,
  decodeCodeEditorToHost,
  encodeHostToCodeEditor,
  encodeCodeEditorToHost,
  CODE_EDITOR_BRIDGE_VERSION,
} from '@/components/vfs/CodeEditorBridge';

describe('code-editor-bridge', () => {
  it('round-trips RN→Web init envelope', () => {
    const message = {
      v: CODE_EDITOR_BRIDGE_VERSION,
      type: 'init' as const,
      payload: {
        theme: {
          background: '#fff',
          text: '#111',
          textSecondary: '#666',
          primary: '#06c',
          surface: '#f8f8f8',
          borderLight: '#ddd',
        },
      },
    };
    const raw = encodeHostToCodeEditor(message);
    const parsed = decodeHostToCodeEditor(raw);
    expect(parsed).toEqual(message);
  });

  it('round-trips RN→Web setDocument envelope', () => {
    const message = {
      v: CODE_EDITOR_BRIDGE_VERSION,
      type: 'setDocument' as const,
      payload: {text: '# Hello', path: '/notes/readme.md'},
    };
    expect(decodeHostToCodeEditor(encodeHostToCodeEditor(message))).toEqual(
      message,
    );
  });

  it('round-trips RN→Web setDocument with selection (token 插入的程序化落位)', () => {
    const message = {
      v: CODE_EDITOR_BRIDGE_VERSION,
      type: 'setDocument' as const,
      payload: {
        text: '帮我写 @src/main.ts 的重构',
        path: 'composer.md',
        selectionStart: 19,
        selectionEnd: 19,
      },
    };
    const parsed = decodeHostToCodeEditor(encodeHostToCodeEditor(message));
    expect(parsed).toEqual(message);
    // 选区字段必须落在 setDocument 载荷上（web 侧 mountEditor/setDocument 的
    // selectionSpec 读的就是这两个键；改名/改层会静默丢选区）
    const payload = (parsed as {payload: {selectionStart?: number}}).payload;
    expect(payload.selectionStart).toBe(19);
  });

  it('round-trips Web→RN selectionChange {start,end} (typeahead 活跃查询判定)', () => {
    const message = {
      v: CODE_EDITOR_BRIDGE_VERSION,
      type: 'selectionChange' as const,
      payload: {start: 12, end: 18},
    };
    const parsed = decodeCodeEditorToHost(encodeCodeEditorToHost(message));
    expect(parsed).toEqual(message);
    // 宿主按这两个字段切出「光标前的活跃 @/$ 查询」；字段名与坐标口径
    // （与 change.text 同一 plain 文本坐标系）不能漂
    const payload = (parsed as {payload: {start?: number; end?: number}}).payload;
    expect(payload.start).toBe(12);
    expect(payload.end).toBe(18);
  });

  it('round-trips init theme with host-derived primaryMuted (capsule/C-orch-1)', () => {
    const message = {
      v: CODE_EDITOR_BRIDGE_VERSION,
      type: 'init' as const,
      payload: {
        theme: {
          background: '#fff',
          text: '#111',
          textSecondary: '#666',
          primary: '#06c',
          primaryMuted: '#06c22',
          surface: '#f8f8f8',
          borderLight: '#ddd',
        },
      },
    };
    const parsed = decodeHostToCodeEditor(encodeHostToCodeEditor(message));
    const theme = (parsed as {payload: {theme: {primaryMuted?: string}}}).payload
      .theme;
    // 胶囊底色由宿主算好下发（web 侧只做条件式写入 --primary-muted）
    expect(theme.primaryMuted).toBe('#06c22');
  });

  it('round-trips Web→RN ready / change / focus / blur', () => {
    const ready = {
      v: CODE_EDITOR_BRIDGE_VERSION,
      type: 'ready' as const,
      payload: {version: 1},
    };
    expect(decodeCodeEditorToHost(encodeCodeEditorToHost(ready))).toEqual(
      ready,
    );

    const change = {
      v: CODE_EDITOR_BRIDGE_VERSION,
      type: 'change' as const,
      payload: {text: 'updated'},
    };
    expect(decodeCodeEditorToHost(encodeCodeEditorToHost(change))).toEqual(
      change,
    );

    const focus = {
      v: CODE_EDITOR_BRIDGE_VERSION,
      type: 'focus' as const,
      payload: {},
    };
    expect(decodeCodeEditorToHost(encodeCodeEditorToHost(focus))).toEqual(
      focus,
    );

    const blur = {
      v: CODE_EDITOR_BRIDGE_VERSION,
      type: 'blur' as const,
      payload: {},
    };
    expect(decodeCodeEditorToHost(encodeCodeEditorToHost(blur))).toEqual(blur);
  });

  it('rejects invalid bridge version', () => {
    expect(() =>
      decodeCodeEditorToHost(
        JSON.stringify({v: 99, type: 'ready', payload: {version: 1}}),
      ),
    ).toThrow(/version/i);
  });
});
