import {
  defaultVfsMarkdownPreviewEngine,
  readVfsMarkdownPreviewEngine,
} from '../src/storage/vfs-markdown-preview-engine';

describe('vfs-markdown-preview-engine', () => {
  it('defaults to webview in all builds', () => {
    expect(defaultVfsMarkdownPreviewEngine()).toBe('webview');
  });

  it('honors KKV override to rn', async () => {
    const appUi = {
      get: jest.fn(async () => 'rn'),
    };
    expect(await readVfsMarkdownPreviewEngine(appUi as never)).toBe('rn');
  });

  it('falls back to webview when KKV unset', async () => {
    const appUi = {
      get: jest.fn(async () => undefined),
    };
    expect(await readVfsMarkdownPreviewEngine(appUi as never)).toBe('webview');
  });
});
