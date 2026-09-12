/**
 * T-L5：mobile 聊天链接路由测试（chat-link-file-nav）。
 *
 * 分级（tests/G-3）：
 * - 第一段行为级：resolveChatLinkIntent 为纯依赖注入函数，stub vfs 直测
 *   （识别→探测顺序→意图），http(s)/mailto 与目录不命中均在覆盖内；
 * - 第二段源码契约：openChatLink（useChatTabScope）与 SubagentSessionScreen
 *   的意图执行接线跨 WebView/导航边界，TestRenderer 触达成本高，按
 *   message-menu-entry 先例保留源码断言（子会话 parentSessionId 口径双钉）。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
  resolveChatLinkIntent,
  type ChatLinkProbeVfs,
} from '@/screens/tabs/chat-tab/chat-link-nav';

const rnSrc = (rel: string) =>
  readFileSync(join(__dirname, '../src', rel), 'utf8');

/** 单层 list stub：entries 形如 {path, kind}；throwDirs 列举会抛错的目录。 */
function makeVfs(
  entries: ReadonlyArray<{path: string; kind: 'file' | 'directory'}>,
  throwDirs: string[] = [],
): ChatLinkProbeVfs & {list: jest.Mock} {
  const impl = {
    list: jest.fn(async (dir: string) => {
      if (throwDirs.includes(dir)) {
        throw new Error(`NOT_FOUND: ${dir}`);
      }
      return entries.filter(e => e.path.startsWith(`${dir === '/' ? '' : dir}/`));
    }),
  };
  return impl;
}

describe('resolveChatLinkIntent (T-L5 行为)', () => {
  it('session 工作区命中 → file/session 意图，且不探测 project', async () => {
    const sessionVfs = makeVfs([{path: '/续写/chapter.md', kind: 'file'}]);
    const projectVfs = makeVfs([{path: '/续写/chapter.md', kind: 'file'}]);
    const intent = await resolveChatLinkIntent('%E7%BB%AD%E5%86%99/chapter.md', {
      sessionVfs,
      projectVfs,
    });
    expect(intent).toEqual({
      kind: 'file',
      scope: 'session',
      path: '/续写/chapter.md',
    });
    // 探测顺序：session 命中即止，project 不被调用
    expect(projectVfs.list).not.toHaveBeenCalled();
    // list 探测的是父目录（单层、非递归）
    expect(sessionVfs.list).toHaveBeenCalledWith('/续写');
  });

  it('仅 project 工作区命中 → file/project 意图', async () => {
    const sessionVfs = makeVfs([]);
    const projectVfs = makeVfs([{path: '/notes/a.md', kind: 'file'}]);
    const intent = await resolveChatLinkIntent('notes/a.md', {
      sessionVfs,
      projectVfs,
    });
    expect(intent).toEqual({kind: 'file', scope: 'project', path: '/notes/a.md'});
  });

  it('双未命中 → not-found（调用方弹「路径不存在」提示）', async () => {
    const intent = await resolveChatLinkIntent('missing.md', {
      sessionVfs: makeVfs([]),
      projectVfs: makeVfs([]),
    });
    expect(intent).toEqual({kind: 'not-found', path: '/missing.md'});
  });

  it('http(s) → external，不触发任何 vfs 探测', async () => {
    const sessionVfs = makeVfs([]);
    const projectVfs = makeVfs([]);
    const http = await resolveChatLinkIntent('http://example.com/x', {
      sessionVfs,
      projectVfs,
    });
    expect(http).toEqual({kind: 'external', url: 'http://example.com/x'});
    const https = await resolveChatLinkIntent('https://example.com/y', {
      sessionVfs,
      projectVfs,
    });
    expect(https).toEqual({kind: 'external', url: 'https://example.com/y'});
    expect(sessionVfs.list).not.toHaveBeenCalled();
    expect(projectVfs.list).not.toHaveBeenCalled();
  });

  it('HTTP:// 大写与带空白的外链均外跳', async () => {
    const intent = await resolveChatLinkIntent('  HTTP://Example.com  ', {
      sessionVfs: null,
      projectVfs: null,
    });
    expect(intent).toEqual({kind: 'external', url: 'HTTP://Example.com'});
  });

  it('mailto 及其它 scheme → none（维持现状）', async () => {
    const intent = await resolveChatLinkIntent('mailto:a@b.com', {
      sessionVfs: makeVfs([]),
      projectVfs: makeVfs([]),
    });
    expect(intent).toEqual({kind: 'none'});
  });

  it('目标存在但是目录 → 不命中 → not-found', async () => {
    const intent = await resolveChatLinkIntent('notes', {
      sessionVfs: makeVfs([{path: '/notes', kind: 'directory'}]),
      projectVfs: makeVfs([{path: '/notes', kind: 'directory'}]),
    });
    expect(intent).toEqual({kind: 'not-found', path: '/notes'});
  });

  it('父目录 NOT_FOUND（list 抛错）按未命中，继续探 project', async () => {
    const sessionVfs = makeVfs([], ['/notes']);
    const projectVfs = makeVfs([{path: '/notes/a.md', kind: 'file'}]);
    const intent = await resolveChatLinkIntent('/notes/a.md', {
      sessionVfs,
      projectVfs,
    });
    expect(intent).toEqual({kind: 'file', scope: 'project', path: '/notes/a.md'});
  });

  it('vfs 为 null（无会话上下文）不炸，直接落下一级', async () => {
    const intent = await resolveChatLinkIntent('notes/a.md', {
      sessionVfs: null,
      projectVfs: makeVfs([{path: '/notes/a.md', kind: 'file'}]),
    });
    expect(intent).toEqual({kind: 'file', scope: 'project', path: '/notes/a.md'});
  });

  it('根下文件（无目录段）探测父目录 /', async () => {
    const sessionVfs = makeVfs([{path: '/a.md', kind: 'file'}]);
    const intent = await resolveChatLinkIntent('a.md', {
      sessionVfs,
      projectVfs: makeVfs([]),
    });
    expect(intent).toEqual({kind: 'file', scope: 'session', path: '/a.md'});
    expect(sessionVfs.list).toHaveBeenCalledWith('/');
  });

  it('锚点 + 路径混合 href：剥锚点后命中', async () => {
    const intent = await resolveChatLinkIntent('notes/a.md#heading', {
      sessionVfs: makeVfs([{path: '/notes/a.md', kind: 'file'}]),
      projectVfs: makeVfs([]),
    });
    expect(intent).toEqual({kind: 'file', scope: 'session', path: '/notes/a.md'});
  });
});

describe('openChatLink 接线源码契约 (T-L5)', () => {
  it('useChatTabScope：external 外跳、file 打开、not-found 弹「路径不存在」提示', () => {
    const src = rnSrc('screens/tabs/chat-tab/useChatTabScope.ts');
    expect(src).toContain('resolveChatLinkIntent');
    expect(src).toMatch(/Linking\.openURL\(intent\.url\)/);
    expect(src).toMatch(/openFileEditor\(intent\.path, intent\.scope\)/);
    // 路径型链接双域未命中：弹提示（用户拍板，不再静默无动作）
    expect(src).toMatch(/showAppToast\(`文件路径不存在：\$\{intent\.path\}`\)/);
    // 外跳失败静默兜底（与原导航守卫语义一致）
    expect(src).toMatch(/Linking\.openURL\(intent\.url\)\.catch\(\(\) => undefined\)/);
    expect(src).toContain('openChatLink');
  });

  it('ChatConversationPanel：webview 路接 onLinkClick（legacy 纯文本路不接）', () => {
    const src = rnSrc('screens/tabs/chat-tab/ChatConversationPanel.tsx');
    expect(src).toContain('onLinkClick={scope.openChatLink}');
    // 仅一处接线（webview 路）；legacy MessageList 无 <a> 可拦，不接线
    expect(src.match(/onLinkClick=/g)?.length).toBe(1);
  });

  it('SubagentSessionScreen：session 探测与打开均用 parentSessionId', () => {
    const src = rnSrc('screens/stack/SubagentSessionScreen.tsx');
    // 探测口径：sessionVfs 用父会话（子会话共享父工作区）
    expect(src).toMatch(
      /runtime\.sessionVfs\(projectId, parentSessionId\)/,
    );
    // 未命中提示与主会话同源（showAppToast）
    expect(src).toMatch(/showAppToast\(`文件路径不存在：\$\{intent\.path\}`\)/);
    // 打开口径：session 域 FileEditor 也用 parentSessionId
    expect(src).toMatch(
      /scopeKind: 'session',\s*projectId,\s*sessionId: parentSessionId,/s,
    );
    expect(src).toContain('onLinkClick={onLinkClick}');
    expect(src).toMatch(/Linking\.openURL\(intent\.url\)\.catch\(\(\) => undefined\)/);
  });
});
