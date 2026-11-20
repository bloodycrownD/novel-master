import {VfsMarkdownPreviewEngine} from '@/storage/vfs-markdown-preview-engine'

describe('vfs-markdown-preview-engine', () => {
  it('defaults to webview in all builds', () => {
    expect(VfsMarkdownPreviewEngine.default()).toBe('webview');
  });

  it('honors KKV override to rn', async () => {
    const appUi = {
      get: jest.fn(async () => ({ok: true, value: 'rn'})),
    };
    expect(await VfsMarkdownPreviewEngine.read(appUi as never)).toBe('rn');
  });

  it('falls back to webview when KKV unset', async () => {
    const appUi = {
      get: jest.fn(async () => ({ok: true, value: undefined})),
    };
    expect(await VfsMarkdownPreviewEngine.read(appUi as never)).toBe('webview');
  });
});
