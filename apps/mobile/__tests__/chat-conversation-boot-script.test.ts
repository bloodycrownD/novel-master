/**
 * T-CC-ASM：chat-conversation 合成包 dist 契约测（chat-webview-unify Step 2）。
 *
 * 读 webview-dist 产物（pretest 已 build:webview），风格对照 chat-transcript-boot-script.test.ts。
 * 本节点只锁「壳结构 + 注入证据」，dock 内容与协议装配由 Step 3/4/5 的测试接手。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {readWebViewDistFile} from './helpers/read-webview-dist';

function bootScript(): string {
  return readWebViewDistFile('chat-conversation', 'app.js');
}

function indexHtml(): string {
  return readWebViewDistFile('chat-conversation', 'index.html');
}

function appCss(): string {
  return readWebViewDistFile('chat-conversation', 'app.css');
}

type ShellNode = {tag: string; id: string | null; parent: string | null};

/**
 * 极简 HTML 结构解析：只取标签栈与 id / 父级 id，足以断言「谁包住谁」。
 * RN jest preset 是 node 环境（无 DOM），故不依赖 DOMParser/jsdom。
 */
function parseShell(html: string): Map<string, ShellNode> {
  // 注释先剥掉：里面出现的 id 字面量不算结构
  const src = html.replace(/<!--[\s\S]*?-->/g, '');
  const nodes = new Map<string, ShellNode>();
  const stack: ShellNode[] = [];
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(src)) !== null) {
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const selfClosing = match[4] === '/';
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const idMatch = /\bid\s*=\s*"([^"]*)"/.exec(match[3] ?? '');
    const id = idMatch ? idMatch[1] : null;
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    if (id) {
      nodes.set(id, {tag, id, parent: parent ? parent.id : null});
    }
    if (!selfClosing) {
      stack.push({tag, id, parent: parent ? parent.id : null});
    }
  }
  return nodes;
}

describe('chat-conversation WebView boot (dist)', () => {
  it('T-CC-ASM-01: 壳含 #app / #scroller / #composer-dock 与相对 app.js/app.css', () => {
    const html = indexHtml();
    expect(html).toContain('id="app"');
    expect(html).toContain('id="scroller"');
    expect(html).toContain('id="rows"');
    expect(html).toContain('id="composer-dock"');
    expect(html).toContain('id="composer-input"');
    expect(html).toContain('./app.js');
    expect(html).toContain('./app.css');
    expect(html).toContain('<script src="./app.js"');
    expect(html).not.toContain('type="module"');
    expect(html).not.toContain('https://novel-master.local/');
  });

  it('T-CC-ASM-02: 双 portal 为 body 直接子级（fixed 包含块语境，勿移入 #app）', () => {
    const html = indexHtml();
    const nodes = parseShell(html);
    // body 自身无 id → 直接子级的 parent 记为 null
    expect(nodes.get('menu-portal')).toEqual({
      tag: 'div',
      id: 'menu-portal',
      parent: null,
    });
    expect(nodes.get('mermaid-viewer-portal')).toEqual({
      tag: 'div',
      id: 'mermaid-viewer-portal',
      parent: null,
    });
  });

  it('T-CC-ASM-03: #app 包住 #scroller 与 #composer-dock（flex 文档布局）', () => {
    const nodes = parseShell(indexHtml());
    expect(nodes.get('app')?.tag).toBe('div');
    expect(nodes.get('scroller')?.parent).toBe('app');
    expect(nodes.get('rows')?.parent).toBe('scroller');
    expect(nodes.get('composer-dock')?.parent).toBe('app');
    // composer runtime 挂载点在 dock 内（createComposerRuntime('#composer-input')）
    expect(nodes.get('composer-input')?.parent).toBe('composer-dock');
    // 反面：portal 不得被卷进 #app
    expect(nodes.get('menu-portal')?.parent).not.toBe('app');
    expect(nodes.get('mermaid-viewer-portal')?.parent).not.toBe('app');
  });

  it('T-CC-CSS-01: #app 四属性齐全（缺一则 dock 不贴底）', () => {
    const css = appCss();
    const appRule = /#app\s*\{([^}]*)\}/.exec(css);
    expect(appRule).not.toBeNull();
    const body = appRule ? appRule[1] : '';
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-direction:\s*column/);
    expect(body).toMatch(/height:\s*100%/);
    expect(body).toMatch(/min-height:\s*0/);
    // #scroller 由旧包 height:100% 改 flex:1（高度在文档内消化）
    const scrollerRule = /#scroller\s*\{([^}]*)\}/.exec(css);
    expect(scrollerRule).not.toBeNull();
    expect(scrollerRule ? scrollerRule[1] : '').toMatch(/flex:\s*1/);
    expect(scrollerRule ? scrollerRule[1] : '').toMatch(/min-height:\s*0/);
  });

  it('T-CC-CSS-02: 两个占位注释均被真 CSS 替换（注入未 throw 且已落内容）', () => {
    const css = appCss();
    // 占位残留 = 注入没做
    expect(css).not.toContain('/* __RICH_CSS__ */');
    expect(css).not.toContain('/* __MERMAID_FULLSCREEN_CSS__ */');
    // mermaid 全屏查看器（MERMAID_FULLSCREEN_CSS 独立注入位）
    expect(css).toContain('.mermaid-fullscreen-backdrop');
    // 富文本 CSS（CHAT_TRANSCRIPT_RICH_CSS）
    expect(css).toContain('.bubble.rich');
  });

  it('T-CC-CSS-03: .ref-token 为壳自带具体规则（非仅靠注入）', () => {
    const css = appCss();
    expect(css).toMatch(/\.ref-token\s*\{[^}]*\}/);
    expect(css).toMatch(/\.ref-token\s*\{[^}]*border-radius:\s*999px/);
  });

  it('T-CC-ASM-04: script parses；两 runtime 以 bindChannel/emitReady=false 装配', () => {
    const script = bootScript();
    expect(() => {
      // eslint-disable-next-line no-new-func -- 语法守护：boot IIFE 不可损坏
      new Function(script);
    }).not.toThrow();
    expect(script).toContain('createTranscriptRuntime');
    expect(script).toContain('createComposerRuntime');
    // 高度在文档内消化 → composer runtime 不发 heightChange 上行
    expect(script).toContain('mountComposerEditor');
  });

  it('T-CC-BUILD-01: PACKAGES 增第五包，cssRel 保持单值（spec CSS 定案）', () => {
    const buildScript = readFileSync(
      join(__dirname, '../scripts/build-webview.mjs'),
      'utf8',
    );
    expect(buildScript).toContain("id: 'chat-conversation'");
    expect(buildScript).toContain("cssRel: 'chat-conversation/styles/chat-conversation.css'");
    expect(buildScript).toContain("htmlRel: 'chat-conversation/index.html'");
    // 五包齐全
    for (const id of [
      'chat-transcript',
      'rich-document',
      'code-editor',
      'composer-input',
      'chat-conversation',
    ]) {
      expect(buildScript).toContain(`id: '${id}'`);
    }
  });
});
