import {
  decodeHostToCodeEditor,
  decodeCodeEditorToHost,
  encodeHostToCodeEditor,
  encodeCodeEditorToHost,
  CODE_EDITOR_BRIDGE_VERSION,
} from '../src/components/vfs/CodeEditorBridge';

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

  it('round-trips Web→RN ready / change / focus / blur', () => {
    const ready = {
      v: CODE_EDITOR_BRIDGE_VERSION,
      type: 'ready' as const,
      payload: {version: 1},
    };
    expect(decodeCodeEditorToHost(encodeCodeEditorToHost(ready))).toEqual(ready);

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
