/**
 * T-CC-ASM：chat-conversation 合成包 dist 契约测（chat-webview-unify Step 2）。
 *
 * 读 webview-dist 产物（pretest 已 build:webview），风格对照 chat-transcript-boot-script.test.ts。
 * 本节点只锁「壳结构 + 注入证据」，dock 内容与协议装配由 Step 3/4/5 的测试接手。
 */
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {readWebViewDistFile} from './helpers/read-webview-dist';
import {
  attachmentDraftChipsStyles,
  composerToolBtnStyle,
} from '../src/web/chat-conversation/styles/dock-style-reference';

function bootScript(): string {
  return readWebViewDistFile('chat-conversation', 'app.js');
}

function indexHtml(): string {
  return readWebViewDistFile('chat-conversation', 'index.html');
}

function appCss(): string {
  return readWebViewDistFile('chat-conversation', 'app.css');
}

/** 合成包 web 源文件（相对 src/web）。 */
function webSrc(rel: string): string {
  return readFileSync(join(__dirname, '../src/web', rel), 'utf8');
}

type ShellNode = {tag: string; id: string | null; parent: string | null};

/** 合成包源文件（基底 + dock 段单源）。 */
const CONVERSATION_CSS_SRC = join(
  __dirname,
  '../src/web/chat-conversation/styles/chat-conversation.css',
);
/** 转录包源文件（合成包的基底真源）。 */
const TRANSCRIPT_CSS_SRC = join(
  __dirname,
  '../src/web/chat-transcript/styles/transcript.css',
);

/**
 * 剥注释后取全部顶层规则（selector 归一化）→ 声明体。
 * 与文件顺序无关，故适合做「两份 CSS 的 selector 覆盖差集」类断言。
 * `@supports` / `@keyframes` 这类嵌套块不进 selector 面（另行断言）。
 */
function cssRules(css: string): Map<string, string> {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const map = new Map<string, string>();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped)) !== null) {
    const selector = match[1].trim().replace(/\s+/g, ' ');
    if (selector.startsWith('@')) {
      continue;
    }
    map.set(selector, match[2].trim().replace(/\s+/g, ' '));
  }
  return map;
}

/** 源文件里的注入占位注释出现次数（构建期 injectCss 依赖它们定位，各只应有一份）。 */
function placeholderCount(css: string, placeholder: string): number {
  return css.split(placeholder).length - 1;
}

/** dock 样式参照真源模块（RN 参照面，不进 bundle）。 */
const DOCK_STYLE_REFERENCE_SRC = join(
  __dirname,
  '../src/web/chat-conversation/styles/dock-style-reference.ts',
);

/** 递归收集目录下的 `.ts` / `.tsx` 文件绝对路径。 */
function tsFilesIn(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      tsFilesIn(full, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * 从 `{ a, b as c }` 的一段里取**原标识符**（`b as c` → `b`）——别处的名字不重要，
 * 「这个模块到底导出了什么、谁引了谁」只认原名。
 */
function originalName(raw: string): string {
  const alias = raw.search(/\s+as\s+/);
  return (alias === -1 ? raw : raw.slice(0, alias)).trim();
}

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
    // composer runtime 挂载点在 dock 子树内（createComposerRuntime('#composer-input')）：
    // dock → box（styles.box 单一视觉容器）→ input-area（typeahead 定位上下文）→ input
    expect(nodes.get('composer-box')?.parent).toBe('composer-dock');
    expect(nodes.get('composer-input-area')?.parent).toBe('composer-box');
    expect(nodes.get('composer-input')?.parent).toBe('composer-input-area');
    // 反面：portal 不得被卷进 #app
    expect(nodes.get('menu-portal')?.parent).not.toBe('app');
    expect(nodes.get('mermaid-viewer-portal')?.parent).not.toBe('app');
  });

  /**
   * 第二阶段 wave-1：列表视图容器与对话视图**平级**挂在 #app 下。
   *
   * 平级是治本的形状条件：#session-list 若被塞进 #scroller 或 #composer-dock 的
   * 子树，切列表视图就不得不连带隐藏/重建对话侧的某一块，WebView 保活的前提
   * （两块 DOM 从头到尾都在）就没了。
   */
  it('T-CC-LIST-ASM-01: #session-list 与 #scroller / #composer-dock 平级（parent 都是 app）', () => {
    const nodes = parseShell(indexHtml());
    for (const id of ['session-list', 'session-list-rows', 'session-list-empty']) {
      expect(nodes.get(id)).toBeDefined();
    }
    expect(nodes.get('session-list')?.parent).toBe('app');
    // 内部骨架：header(标题 + 新建) → rows → empty
    expect(nodes.get('session-list-header')?.parent).toBe('session-list');
    expect(nodes.get('session-list-title')?.parent).toBe('session-list-header');
    expect(nodes.get('session-list-create')?.parent).toBe('session-list-header');
    expect(nodes.get('session-list-rows')?.parent).toBe('session-list');
    expect(nodes.get('session-list-empty')?.parent).toBe('session-list');
    // 反面：不得卷进对话域任一子树
    expect(nodes.get('session-list')?.parent).not.toBe('composer-dock');
    expect(nodes.get('session-list')?.parent).not.toBe('scroller');
  });

  it('T-CC-LIST-ASM-02: #app 挂 data-view（初值 conversation），列表壳带 web 化 testID', () => {
    const html = indexHtml();
    // 初值 conversation：viewState 到达前不至于开屏就一张空列表
    expect(html).toMatch(/<div id="app" data-view="conversation">/);
    for (const testId of [
      'session-list',
      'session-list-header',
      'session-list-create',
      'session-list-rows',
      'session-list-empty',
    ]) {
      expect(html).toContain(`data-testid="${testId}"`);
    }
    expect(html).toContain('新建会话');
    // 反面：display 不得在 CSS 里被硬编码成某个视图（显隐只能由 JS 驱动）。
    // 注意：conversation 态**允许**出现 #app[data-view='conversation'] 选择器——
    // 双视图转场的淡入动画（view-fade-in）挂在其上（纯 opacity，不参与布局）。
    // 真正要禁的是用 display 覆写 conversation 态的可见性，故按声明面判。
    const conversationRules = cssRules(appCss());
    for (const [selector, body] of conversationRules) {
      if (selector.includes("data-view='conversation'")) {
        expect(body).not.toMatch(/display\s*:/);
      }
    }
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
    // #scroller 由旧包 height:100% 改 flex:1（高度在文档内消化）。
    // 构建期 join 后 app.css 里有**两条** #scroller 规则（基底 height:100% 在前、
    // 覆盖段 flex:1 在后），单条正则只会命中基底那条——故按「存在一条同时含
    // flex:1 与 min-height:0 的 #scroller 规则」判，而不是「第一条 #scroller」。
    const scrollerRules = [...css.matchAll(/#scroller\s*\{([^}]*)\}/g)].map(
      m => m[1] ?? '',
    );
    expect(scrollerRules.length).toBeGreaterThanOrEqual(2);
    const flexed = scrollerRules.filter(bodyText =>
      /flex:\s*1/.test(bodyText) && /min-height:\s*0/.test(bodyText),
    );
    expect(flexed).toHaveLength(1);
    // 基底那条仍保留 100%（覆盖段靠 height:auto 压掉它）
    expect(scrollerRules[0]).toMatch(/height:\s*100%/);
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

  it('T-CC-BUILD-01: PACKAGES 四包齐全；chat-conversation 的 cssRel 为 join 数组（transcript-converge）', () => {
    const buildScript = readFileSync(
      join(__dirname, '../scripts/build-webview.mjs'),
      'utf8',
    );
    expect(buildScript).toContain("id: 'chat-conversation'");
    expect(buildScript).toContain("htmlRel: 'chat-conversation/index.html'");
    // cssRel 数组 = 构建期 join：transcript.css（转录基底，含两个注入占位）
    // 在前、chat-conversation.css（增量段）在后，顺序即层叠序。
    expect(buildScript).toMatch(
      /id: 'chat-conversation',[\s\S]*?cssRel:\s*\[\s*'chat-transcript\/styles\/transcript\.css',\s*'chat-conversation\/styles\/chat-conversation\.css',\s*\]/,
    );
    // 四包齐全（chat-transcript 不再是独立包）
    for (const id of [
      'rich-document',
      'code-editor',
      'composer-input',
      'chat-conversation',
    ]) {
      expect(buildScript).toContain(`id: '${id}'`);
    }
    // 反面：旧 chat-transcript 包条目不得回流（转录已并入合成包）
    expect(buildScript).not.toMatch(/id: 'chat-transcript'/);
  });
});

/* ================================================================== *
 * Step 3 / 4 / 5：dock 壳、样式数值清单、协议装配（chat-webview-unify）
 * ================================================================== */

describe('chat-conversation dock 壳（Step 3 · 文档布局）', () => {
  it('T-CC-DOCK-01: dock 六段齐备且纵向次序为 hintRow → error → box(chips → typeahead → input → toolbar)', () => {
    const nodes = parseShell(indexHtml());
    for (const id of [
      'composer-hint-row',
      'composer-error',
      'composer-box',
      'composer-chips',
      'composer-typeahead',
      'composer-input',
      'composer-toolbar',
    ]) {
      expect(nodes.get(id)).toBeDefined();
    }
    // hintRow / error 直接挂在 dock 上（box 之外——现网同构：提示与报错在 box 上方）
    expect(nodes.get('composer-hint-row')?.parent).toBe('composer-dock');
    expect(nodes.get('composer-error')?.parent).toBe('composer-dock');
    // box 内次序
    expect(nodes.get('composer-chips')?.parent).toBe('composer-box');
    expect(nodes.get('composer-input-area')?.parent).toBe('composer-box');
    // input-area 内次序：typeahead 浮层在 input 上方
    expect(nodes.get('composer-typeahead')?.parent).toBe('composer-input-area');
    expect(nodes.get('composer-toolbar')?.parent).toBe('composer-input-area');
  });

  it('T-CC-DOCK-02: dock 壳带 web 化 testID（testID 统一到 web data-testid）', () => {
    const html = indexHtml();
    for (const testId of [
      'composer-hint-row',
      'composer-error',
      'composer-chips',
      'composer-typeahead',
      'composer-toolbar',
    ]) {
      expect(html).toContain(`data-testid="${testId}"`);
    }
  });
});

describe('chat-conversation dock 样式数值清单（Step 4 · T-CU10 样式相等）', () => {
  /** 取某选择器的第一条规则体（CSS 被注入拼接后可能有重复，取首个命中）。 */
  function rule(css: string, selector: string): string {
    const re = new RegExp(
      `(^|[},])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
      'm',
    );
    const match = re.exec(css);
    if (match == null) {
      throw new Error(`app.css 缺少规则 ${selector}`);
    }
    return match[2];
  }

  it('T-CC-CSS-04: styles.dock 四值 + 实底（paddingH12 / padT4 / padB8 / background 非 transparent）', () => {
    const dock = rule(appCss(), '#composer-dock');
    expect(dock).toMatch(/padding:\s*4px\s+12px\s+8px/);
    expect(dock).toMatch(/background:\s*var\(--bg/);
    // 反面清单（源级）：合成包自持 CSS 不搬 composer-input.css 的
    // `html,body{background:transparent}`——与基底的 `background: var(--bg, #fff)`
    // 直接冲突。transcript-converge 后 html,body 的底色由**基底真源**
    // transcript.css 承担，合成包只做 overflow 覆盖，故两条都按各自真源判。
    const source = readFileSync(CONVERSATION_CSS_SRC, 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    expect(source).not.toMatch(
      /html,\s*body\s*\{[^}]*background:\s*transparent/,
    );
    // 合成包不得对 html,body 另起一份底色（唯一真源在 transcript.css）
    expect(source).not.toMatch(/html,\s*body\s*\{[^}]*background\s*:/);
    // 基底真源的 html,body 底色必须是 --bg 实底
    const base = readFileSync(TRANSCRIPT_CSS_SRC, 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    expect(base).toMatch(/html,\s*body\s*\{[^}]*background:\s*var\(--bg/);
  });

  /**
   * T-FS1 迁居点（Step 8）：⛶ / @ / $ 同排三钮「同款圆钮」的样式相等断言。
   *
   * 原来这条断言长在 `composer-fullscreen.test.tsx` 里，量的是 RN 侧
   * `ChatComposer` 工具栏三个 Pressable 的展平 style。Step 8 legacy 转录引擎
   * 退役后 `ChatComposer.tsx` 整个删掉，⛶ 已经是 web 文档里的
   * `<button class="toolbar__btn toolbar__fullscreen">`，RN 侧没有这个元素了。
   *
   * 断言没有跟着消失，而是换了参照面：RN 侧真源由 `dock-style-reference.ts` 转出
   * 共享常量 `composer-toolbar-style.ts` 的 `composerToolBtnStyle`（它本身是纯常量
   * 文件，不随 `ChatComposer` 删除而消失，所以这里比的是**活常量**而不是手抄快照——
   * cr1-P1-5 缩范围时，参照文件里其余 8 份手抄快照正是因此被清掉的），
   * 于是「相等」由 **web CSS 规则 ⇄ RN 参照常量** 逐项对。
   * 描边宽度按 hairline 量纲断言（0 < w ≤ 1）：RN 的 `StyleSheet.hairlineWidth`
   * 在 iOS 是 0.33、Android 是 0.5，锁死某个平台的值会让这条断言在另一个
   * 平台红掉，而 hairline 的语义就是「设备上一根物理像素」这一量级。
   */
  it('T-FS1 迁居：⛶ / @ / $ 三钮同款 36 圆钮 + hairline 描边，与 RN 参照常量相等', () => {
    const toolBtn = rule(appCss(), '.toolbar__btn');
    expect(toolBtn).toMatch(/width:\s*36px/);
    expect(toolBtn).toMatch(/height:\s*36px/);
    expect(toolBtn).toMatch(/border-radius:\s*18px/);
    // 与 RN 参照常量 composerToolBtnStyle 的 36/36/18 逐项相等
    expect(composerToolBtnStyle.width).toBe(36);
    expect(composerToolBtnStyle.height).toBe(36);
    expect(composerToolBtnStyle.borderRadius).toBe(18);
    const borderWidth = Number(
      /border:\s*([\d.]+)px/.exec(toolBtn)?.[1] ?? Number.NaN,
    );
    expect(Number.isFinite(borderWidth)).toBe(true);
    expect(borderWidth).toBeGreaterThan(0);
    expect(borderWidth).toBeLessThanOrEqual(1);

    // 三个引用钮只加各自的修饰类（⛶ 另设字号），圆钮本体是同一条规则——
    // 「同排同款」在 CSS 层的落点就是它们共用 `.toolbar__btn`。
    const dock = webSrc('chat-conversation/webview/dock.ts');
    for (const modifier of [
      'toolbar__btn toolbar__fullscreen',
      'toolbar__btn toolbar__at',
      'toolbar__btn toolbar__skill',
    ]) {
      expect(dock).toContain(modifier);
    }
  });

  it('T-CC-CSS-11: dist 含转录段关键 selector（基底补全的回归防线）', () => {    const rules = cssRules(appCss());
    // 这批 selector 只可能来自 transcript.css 基底——dock 段没有同名物。
    // 缺任意一条 = 基底被截断（合成包会退化成「只有壳 + dock」的空白转录区）。
    for (const selector of [
      '.bubble',
      '.row.user .bubble',
      '.bubble-body',
      '.bubble-body.rich',
      '.thinking-header',
      '.thinking-body',
      '.tool-card',
      '.tool-group-header',
      '.tool-invoking-bar',
      '.menu-backdrop',
      '.context-menu',
      '.context-menu.scrollable',
      '.menu-item',
      '.menu-item.danger',
      'body.menu-open',
      '.row-window-spacer',
      '.load-older',
      '.empty-state',
      '.message-menu-row',
      '.message-menu-btn',
    ]) {
      expect(rules.has(selector)).toBe(true);
    }
  });

  it('T-CC-CSS-12: 基底源保留且只保留一份注入占位注释；dist 里两个占位均已消失', () => {
    // transcript-converge：两个注入占位随基底真源一起搬进 transcript.css
    // （构建期 join 的前一半），故判据落在基底源上。
    const base = readFileSync(TRANSCRIPT_CSS_SRC, 'utf8');
    expect(placeholderCount(base, '/* __RICH_CSS__ */')).toBe(1);
    expect(placeholderCount(base, '/* __MERMAID_FULLSCREEN_CSS__ */')).toBe(1);
    // 占位在 dist 消失 = injectCss 命中（漏一个就会原样留在产物里）
    const css = appCss();
    expect(css).not.toContain('/* __RICH_CSS__ */');
    expect(css).not.toContain('/* __MERMAID_FULLSCREEN_CSS__ */');
  });

  it('T-CC-CSS-13: 合成包产物含 transcript.css 全部顶层 selector（基底 = 全文）', () => {
    // transcript-converge：基底不再手抄进 chat-conversation.css，改由构建期
    // join 保证「产物 = 基底全文 + 增量段」。故断言面从**源文件差集**移到
    // **构建产物**：transcript.css 的每条顶层 selector 都必须出现在 app.css 里。
    // 少任何一条 = join 断了（合成包会退化成「只有壳 + dock」的空白转录区）。
    const transcript = cssRules(readFileSync(TRANSCRIPT_CSS_SRC, 'utf8'));
    const built = cssRules(appCss());
    const missing = [...transcript.keys()].filter(s => !built.has(s));
    expect(missing).toEqual([]);
  });

  it('T-CC-CSS-14: 输入框与 toolbar 按钮均无自创 :disabled / --disabled 置灰（现网 RN disabled 无灰化变体）', () => {
    const rules = cssRules(appCss());
    // 反面清单：`:disabled { opacity }` 是合成包自创的置灰，现网 RN 侧 disabled
    // 只是透传的死参数，没有视觉变体——留它会让圆钮凭空变灰。
    expect(rules.has('.toolbar__btn:disabled')).toBe(false);
    // 输入区整块淡出（`.composer-input--disabled { opacity:.55 }`）同样是从旧 RN 链
    // styles 逐字搬来的产物：现网 chat 链 TextInput 从无淡出变体，而 `inputDisabled`
    // （运行中 / 未选模型）常态置位，留着等于把整片输入区灰掉。
    // **必须查 dist 合成包**——旧包 `composer-input/styles/composer-input.css` 的同名规则
    // 是宏链活链的既有表现、刻意保留，拿旧包来判会永远红。
    expect(rules.has('.composer-input--disabled')).toBe(false);
    // 发送键的 disabled 视觉走底色态（tokens.border），保留
    expect(rules.get('.toolbar__send--disabled')).toMatch(/var\(--border/);
    // chips 同样不置灰（走的是「不随 inputDisabled 变灰」的既约定）
    expect(rules.get('.chip') ?? '').not.toMatch(/opacity/);
  });

  it('T-CC-CSS-15: dock-style-reference 每个导出都有消费方（RN 真源死了就不许再抄一份快照）', () => {
    const source = readFileSync(DOCK_STYLE_REFERENCE_SRC, 'utf8');
    const exported = new Set<string>();
    for (const m of source.matchAll(
      /^export\s+(?:const|function|class)\s+([A-Za-z0-9_$]+)/gm,
    )) {
      exported.add(m[1]);
    }
    for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const part of m[1].split(',')) {
        const name = originalName(part);
        if (name) {
          exported.add(name);
        }
      }
    }
    // 解析器本身也要有牙齿：全空说明上面的匹配写坏了，断言会假绿
    expect(exported.size).toBeGreaterThan(0);

    // 消费面 = 全仓 import 了本模块的文件里实际引入的标识符
    const consumed = new Set<string>();
    const files = [
      ...tsFilesIn(join(__dirname, '../src')),
      ...tsFilesIn(__dirname),
    ];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes('dock-style-reference')) {
        continue;
      }
      for (const m of text.matchAll(
        /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'[^']*dock-style-reference'/g,
      )) {
        for (const part of m[1].split(',')) {
          const name = originalName(part);
          if (name) {
            consumed.add(name);
          }
        }
      }
    }
    // 零消费导出 = 又一份没人对照的数值快照；当初手抄 8 份的教训就是它们全在等文件删除。
    expect([...exported].filter(name => !consumed.has(name))).toEqual([]);
  });

  it('T-CC-CSS-05: styles.box（hairline 描边 / radius 12 / paddingH 8 / padT 4 / padB 6 / surface 实底）', () => {
    const box = rule(appCss(), '.dock__box');
    expect(box).toMatch(/border:\s*0\.5px solid/);
    expect(box).toMatch(/border-radius:\s*12px/);
    expect(box).toMatch(/padding:\s*4px\s+8px\s+6px/);
    expect(box).toMatch(/background:\s*var\(--surface/);
  });

  it('T-CC-CSS-06: hintRow marginBottom:6；error marginBottom:6 + fontSize:13', () => {
    const css = appCss();
    expect(rule(css, '.dock__hint-row')).toMatch(/margin-bottom:\s*6px/);
    const error = rule(css, '.dock__error');
    expect(error).toMatch(/margin-bottom:\s*6px/);
    expect(error).toMatch(/font-size:\s*13px/);
  });

  it('T-CC-CSS-07: chips 数值清单 ⇄ AttachmentDraftChips RN 真源（chip padV6/padH10/radius14/maxW200；label 12/maxW160；行 maxH36/transparentRow marginBottom4；content gap6/padR8；横向滚动）', () => {
    const css = appCss();
    // RN 真源：`AttachmentDraftChips.tsx` 的 StyleSheet（组件本体仍在生产中）。
    // 断言从组件 import，而不是在测试里手抄一份常量——手抄的那份一旦与组件分叉，
    // 本条就退化成「CSS vs 硬编码」，恒真且永不报警（cr1-P1-5 缩范围后的首批真源面）。
    const chips = attachmentDraftChipsStyles;
    // 行容器：非 transparent 变体的 maxHeight 对 transparent 变体**仍然生效**
    // （rowTransparent 只覆盖 backgroundColor 与 marginBottom），CSS 侧必须同样落 36。
    expect(chips.row.maxHeight).toBe(36);
    expect(chips.rowTransparent.marginBottom).toBe(4);
    expect(chips.content.gap).toBe(6);
    expect(chips.content.paddingRight).toBe(8);

    const row = rule(css, '.chips__row');
    expect(row).toMatch(/max-height:\s*36px/);
    // transparentRow 变体：行底色透明 + marginBottom:4
    expect(row).toMatch(/margin-bottom:\s*4px/);
    expect(row).toMatch(/gap:\s*6px/);
    expect(row).toMatch(/padding-right:\s*8px/);
    expect(row).toMatch(/overflow-x:\s*auto/);
    expect(row).toMatch(/background:\s*transparent/);

    expect(chips.chip.maxWidth).toBe(200);
    expect(chips.chip.paddingVertical).toBe(6);
    expect(chips.chip.paddingLeft).toBe(10);
    expect(chips.chip.paddingRight).toBe(10);
    expect(chips.chip.borderRadius).toBe(14);
    const chip = rule(css, '.chip');
    expect(chip).toMatch(/max-width:\s*200px/);
    expect(chip).toMatch(/padding:\s*6px\s+10px/);
    expect(chip).toMatch(/border-radius:\s*14px/);
    expect(chip).toMatch(/border:\s*0\.5px solid/);
    // RN chip 没有 flexShrink/background 两条（那边由 ScrollView 布局与注入底色承担），
    // 但 CSS 侧必须有：前者防 chip 被横向滚动压扁，后者是 chips 段的实底。
    expect(chip).toMatch(/flex-shrink:\s*0/);
    expect(chip).toMatch(/background:\s*var\(--surface/);

    expect(chips.label.fontSize).toBe(12);
    expect(chips.label.maxWidth).toBe(160);
    const label = rule(css, '.chip__label');
    expect(label).toMatch(/font-size:\s*12px/);
    expect(label).toMatch(/max-width:\s*160px/);
    // ellipsis 三件套（RN 侧 numberOfLines={1} 的 CSS 等价物）：少任一条，
    // 长路径 chip 文本就会顶破 160 上限横向溢出，而不是省略号收尾。
    expect(label).toMatch(/overflow:\s*hidden/);
    expect(label).toMatch(/text-overflow:\s*ellipsis/);
    expect(label).toMatch(/white-space:\s*nowrap/);
  });

  it('T-CC-CSS-08: typeahead 浮层（absolute 锚 input 上缘 / 与 input 等宽 left0·right0 / radius 10 / hairline / surface 底 + 行内边距 8×10）', () => {
    const css = appCss();
    const area = rule(css, '.dock__input-area');
    expect(area).toMatch(/position:\s*relative/);
    const list = rule(css, '.typeahead');
    expect(list).toMatch(/position:\s*absolute/);
    // 与 input 等宽：现网 typeahead 是 box 的直接子 View，两侧贴边不内缩。
    // 写成 left/right: 8px 会让浮层比输入框窄一圈——现网不存在这 8px 内缩。
    expect(list).toMatch(/left:\s*0/);
    expect(list).toMatch(/right:\s*0/);
    expect(list).not.toMatch(/left:\s*8px/);
    expect(list).not.toMatch(/right:\s*8px/);
    expect(list).toMatch(/bottom:\s*100%/);
    // 浮层层级：chips 行在 DOM 里排在上游，浮层若不抬 z-index 会被它盖住
    expect(list).toMatch(/z-index:\s*20/);
    // 候选封顶高度 + 纵向滚动（候选多时滚，而不是把 input 撑高）
    expect(list).toMatch(/max-height:\s*240px/);
    expect(list).toMatch(/overflow-y:\s*auto/);
    expect(list).toMatch(/border-radius:\s*10px/);
    expect(list).toMatch(/border:\s*0\.5px solid/);
    expect(list).toMatch(/background:\s*var\(--surface/);
    const row = rule(css, '.typeahead__row');
    expect(row).toMatch(/padding:\s*8px\s+10px/);
    // SkillTypeahead styles.item 的 gap:8（@ 路径候选无此修饰类）
    expect(rule(css, '.typeahead__row--skill')).toMatch(/gap:\s*8px/);
    expect(rule(css, '.typeahead__tag')).toMatch(/font-size:\s*11px/);
  });

  it('T-CC-CSS-09: input metrics 六值兜底（16/22/4/6/56/122）—— maxHeight 122 = paddingV×2 + lineHeight×5', () => {
    const css = appCss();
    expect(rule(css, '.composer-input')).toMatch(/font-size:\s*16px/);
    expect(rule(css, '.composer-input')).toMatch(/line-height:\s*22px/);
    const highlight = rule(css, '.composer-input__highlight');
    expect(highlight).toMatch(/padding:\s*6px\s+4px/);
    expect(highlight).toMatch(/min-height:\s*56px/);
    expect(highlight).toMatch(/max-height:\s*122px/);
    // 透明 textarea：文字不可见、插入符显式着色、选区只剩底色
    const input = rule(css, '.composer-input__input');
    expect(input).toMatch(/color:\s*transparent/);
    expect(input).toMatch(/caret-color:\s*var\(--text/);
    expect(rule(css, '.composer-input__input::selection')).toMatch(
      /background:\s*var\(--selection/,
    );
  });

  it('T-CC-CSS-10: toolbar 数值（gap 8 / marginTop 4 / 36 圆钮 radius 18 hairline / 发送钮 40 半径 20 + 三态配色）', () => {
    const css = appCss();
    const toolbar = rule(css, '.toolbar');
    expect(toolbar).toMatch(/gap:\s*8px/);
    expect(toolbar).toMatch(/margin-top:\s*4px/);
    expect(rule(css, '.toolbar__spacer')).toMatch(/flex:\s*1/);
    const btn = rule(css, '.toolbar__btn');
    expect(btn).toMatch(/width:\s*36px/);
    expect(btn).toMatch(/height:\s*36px/);
    expect(btn).toMatch(/border-radius:\s*18px/);
    expect(btn).toMatch(/border:\s*0\.5px solid/);
    // 引用钮字色：⛶ / @ / $ 是图标钮，字色经 currentColor 落到图标，
    // 漏这条就可能退回浏览器默认黑而与现网 tokens.textSecondary 不一致。
    // （36/36/18 与 RN 参照常量的相等由 T-FS1 迁居那条断言承担，此处不重复。）
    expect(btn).toMatch(/color:\s*var\(--text-secondary/);
    const send = rule(css, '.toolbar__send');
    expect(send).toMatch(/width:\s*40px/);
    expect(send).toMatch(/height:\s*40px/);
    expect(send).toMatch(/border-radius:\s*20px/);
    expect(rule(css, '.toolbar__send--primary')).toMatch(/var\(--primary/);
    expect(rule(css, '.toolbar__send--danger')).toMatch(/var\(--danger/);
    expect(rule(css, '.toolbar__send--disabled')).toMatch(/var\(--border/);
  });
});

describe('chat-conversation 协议装配（Step 5 · T-CU1 / T-CU3 契约）', () => {
  it('T-CC-V2-01: dist 含 dispatcher / dock handler 与 v2 身份符号', () => {
    const script = bootScript();
    expect(script).toContain('createConversationDispatcher');
    expect(script).toContain('createConversationDock');
    expect(script).toContain('routeHostMessage');
    // v:2 身份：自有能力位 + ready 版本标识
    expect(script).toContain('composer-dock');
    expect(script).toContain('"u1"');
    // dock 域三 type
    expect(script).toContain('composerState');
    expect(script).toContain('composerPaste');
    expect(script).toContain('selectAll');
    // dockAction 六项
    for (const action of [
      'send',
      'terminate',
      'needModel',
      'fullscreen',
      'atPicker',
      'skillPicker',
    ]) {
      expect(script).toContain(action);
    }
  });

  it('T-CC-V2-02: 桥版本为 2（新包下行信封），且单次 bindHostMessageChannel 在两工厂之前', () => {
    const script = bootScript();
    // 下行信封 v=2：`CONVERSATION_BRIDGE_V = 2` 参与 matchHostMessage 与 createBoundPost
    expect(script).toMatch(/CONVERSATION_BRIDGE_V\s*=\s*2/);
    expect(script).toMatch(
      /matchHostMessage\(raw,\s*CONVERSATION_BRIDGE_V\)/,
    );
    // 上行 v:2 出口只服务 ready / dockAction
    expect(script).toContain('createBoundPost(CONVERSATION_BRIDGE_V)');

    // 顺序红线：入口装配块内 bindHostMessageChannel 必须早于两工厂
    const entryAt = script.indexOf('src/web/chat-conversation/webview/main.ts');
    expect(entryAt).toBeGreaterThan(-1);
    const entry = script.slice(entryAt, entryAt + 1600);
    const bindAt = entry.indexOf('bindHostMessageChannel(dispatcher)');
    const transcriptAt = entry.indexOf('createTranscriptRuntime(');
    const composerAt = entry.indexOf('createComposerRuntime(');
    const mountAt = entry.indexOf('dock.mount()');
    expect(bindAt).toBeGreaterThan(-1);
    expect(transcriptAt).toBeGreaterThan(bindAt);
    expect(composerAt).toBeGreaterThan(bindAt);
    // dock handler 在两 runtime 之后挂载（textarea 由 composer 挂出）
    expect(mountAt).toBeGreaterThan(composerAt);
    // 单次注册：入口块内 bindHostMessageChannel 只出现一次
    expect(entry.split('bindHostMessageChannel(').length - 1).toBe(1);
  });

  it('T-CC-V2-04: dist 含 ready 装配闸（shouldEmitConversationReady 导出 + 入口设闸 + 失败诊断）', () => {
    const script = bootScript();
    // 判定函数被导出且**函数名在产物里保留**（esbuild minify:false）——
    // 闸门被内联掉或被 tree-shake 掉，这条都归零。
    expect(script).toContain('function shouldEmitConversationReady(');
    // 入口真的接了两面返回值并喂给闸门（不是导出了却没人调）
    expect(script).toMatch(
      /shouldEmitConversationReady\(\{\s*composerMounted:\s*composerRuntime\.mounted,\s*dockMounted\s*\}\)/,
    );
    // 闸门不通过时的中文诊断 + 直接 return（不发 ready，把信号交回宿主 8s 兜底）
    expect(script).toMatch(/console\.error\(\s*`\[chat-conversation\]/);
  });

  it('T-CC-V2-03: 零 heightChange 上行链（heightReport:false）与零 composer ready', () => {
    const script = bootScript();
    // 两 runtime 均以 emitReady:false 装配 → 合成包内 composer 不发自己的 ready
    expect(script).toMatch(/emitReady:\s*false/);
    expect(script).toMatch(/heightReport:\s*false/);
    // ready 版本标识是字符串字面量 "u1"（不是旧包的数字 1 / 'm4'）
    expect(script).toContain('"u1"');
  });
});

/* ================================================================== *
 * 第二阶段 wave-1：列表视图（双视图显隐 + 数值清单 + 协议 + 装配序）
 * ================================================================== */

describe('chat-conversation 列表视图（第二阶段 wave-1 · T-CL-DIST）', () => {
  /** 取某选择器的第一条规则体（与上文样式段同一 helper）。 */
  function rule(css: string, selector: string): string {
    const re = new RegExp(
      `(^|[},])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
      'm',
    );
    const match = re.exec(css);
    if (match == null) {
      throw new Error(`app.css 缺少规则 ${selector}`);
    }
    return match[2];
  }

  it('T-CL-DIST-01: 双视图显隐由 #app[data-view] 驱动（list 态藏对话两块）', () => {
    const css = appCss();
    // 对话两块在 list 态 display:none（不是 hidden 属性——#scroller 的 flex:1 与
    // #composer-dock 的 flex:0 0 auto 是布局声明，必须整块脱离流）。
    // 两条选择器跨行，rule() 的单 selector 匹配吃不下逗号组，这里直接查声明面。
    const hideRule =
      /#app\[data-view='list'\]\s+#scroller,\s*#app\[data-view='list'\]\s+#composer-dock\s*\{([^}]*)\}/.exec(
        css,
      );
    expect(hideRule).not.toBeNull();
    expect(hideRule ? hideRule[1] : '').toMatch(/display:\s*none/);
    expect(rule(css, "#app[data-view='list'] #session-list")).toMatch(
      /display:\s*flex/,
    );
    // 列表默认隐藏（conversation 态）
    expect(rule(css, '#session-list')).toMatch(/display:\s*none/);
    // 反面：不得出现 conversation 态的**display 覆写**——那会与基底段 + dock 段的
    // flex 值打架（这里覆写出来的 display:none 会让对话永远出不来）。
    // 注意：转场淡入动画（view-fade-in）合法地挂在 conversation 态选择器上，
    // 那是纯 opacity 声明、不参与布局，故按声明面判 display 而非按选择器判。
    for (const [selector, decl] of cssRules(css)) {
      if (selector.includes("data-view='conversation'")) {
        expect(decl).not.toMatch(/display\s*:/);
      }
    }
  });

  it('T-CL-DIST-02: sessionCard 数值清单（pad16/radius16/marginH5·B12/hairline/gap8/阴影）', () => {
    const row = rule(appCss(), '.session-row');
    expect(row).toMatch(/padding:\s*16px/);
    expect(row).toMatch(/border-radius:\s*16px/);
    expect(row).toMatch(/margin:\s*0 5px 12px/);
    expect(row).toMatch(/gap:\s*8px/);
    // hairline 量纲（0 < w ≤ 1）：锁死某个平台的值会让这条在另一个平台红掉
    const borderWidth = Number(
      /border:\s*([\d.]+)px/.exec(row)?.[1] ?? Number.NaN,
    );
    expect(Number.isFinite(borderWidth)).toBe(true);
    expect(borderWidth).toBeGreaterThan(0);
    expect(borderWidth).toBeLessThanOrEqual(1);
    // RN 的 shadowOffset/opacity/radius → 等价 box-shadow
    expect(row).toMatch(/box-shadow:\s*0 1px 3px rgba\(0, 0, 0, 0\.08\)/);
    // 底色走 --surface（见 CSS 段头「RN→CSS 口径差」第 1 条：surfaceElevated 不在 9 键超集）
    expect(row).toMatch(/background:\s*var\(--surface/);
  });

  it('T-CL-DIST-03: 标题 16/600/单行省略三件套 + info 的 min-width:0', () => {
    const css = appCss();
    // numberOfLines={1} 的 CSS 等价三件套：少任一条就是横向溢出而非省略号收尾
    const title = rule(css, '.session-row__title');
    expect(title).toMatch(/font-size:\s*16px/);
    expect(title).toMatch(/font-weight:\s*600/);
    expect(title).toMatch(/margin-bottom:\s*4px/);
    expect(title).toMatch(/overflow:\s*hidden/);
    expect(title).toMatch(/text-overflow:\s*ellipsis/);
    expect(title).toMatch(/white-space:\s*nowrap/);
    // styles.sessionInfo 的 minWidth:0 是标题省略的前提
    expect(rule(css, '.session-row__info')).toMatch(/min-width:\s*0/);
    // meta 13
    expect(rule(css, '.session-row__meta')).toMatch(/font-size:\s*13px/);
  });

  it('T-CL-DIST-04: 三徽标 px8/py4/radius12/mr4 + 白字 12/600，三色各一', () => {
    const css = appCss();
    const badge = rule(css, '.session-row__badge');
    expect(badge).toMatch(/padding:\s*4px 8px/);
    expect(badge).toMatch(/border-radius:\s*12px/);
    expect(badge).toMatch(/margin-right:\s*4px/);
    expect(badge).toMatch(/color:\s*#fff/);
    expect(badge).toMatch(/font-size:\s*12px/);
    expect(badge).toMatch(/font-weight:\s*600/);
    // 三色：生成中=primary、已中断=textSecondary、当前=primary
    expect(rule(css, '.session-row__badge--generating')).toMatch(
      /var\(--primary/,
    );
    expect(rule(css, '.session-row__badge--interrupted')).toMatch(
      /var\(--text-secondary/,
    );
    expect(rule(css, '.session-row__badge--current')).toMatch(/var\(--primary/);
  });

  it('T-CL-DIST-05: ⋮ 18 号 + 命中区 padding 8·4、› 22/300、勾选框 18/r4/1.5', () => {
    const css = appCss();
    // 现网 hitSlop 8 → web 侧靠 padding 把命中区撑开（18 号 ⋮ 视觉不变）
    expect(rule(css, '.session-row__menu')).toMatch(/font-size:\s*18px/);
    expect(rule(css, '.session-row__menu')).toMatch(/padding:\s*8px 4px/);
    expect(rule(css, '.session-row__chevron')).toMatch(/font-size:\s*22px/);
    expect(rule(css, '.session-row__chevron')).toMatch(/font-weight:\s*300/);
    // BatchCheckbox：18 见方 / radius 4 / 1.5 描边，勾上时 primary 底
    const check = rule(css, '.session-row__check');
    expect(check).toMatch(/width:\s*18px/);
    expect(check).toMatch(/height:\s*18px/);
    expect(check).toMatch(/border-radius:\s*4px/);
    expect(check).toMatch(/border:\s*1\.5px solid/);
    // 命中区只能由 ::after 外扩承担——padding/content-box 会把边框底色一起撑成
    // 37px 大方块（真机视觉回归，2026-10-03 用户反馈实锤），此处钉死不再回潮。
    expect(check).not.toMatch(/padding:/);
    expect(check).not.toMatch(/box-sizing:\s*content-box/);
    expect(rule(css, '.session-row__check::after')).toMatch(/inset:\s*-8px/);
    expect(rule(css, '.session-row__check--on')).toMatch(/var\(--primary/);
    // 批量勾选态描边加粗主色（现网 borderColor:primary + borderWidth:2）
    expect(rule(css, '.session-row--selected')).toMatch(
      /border:\s*2px solid var\(--primary/,
    );
  });

  it('T-CL-DIST-06: 列表头 ManageHeader（px5/py12/下边框/title 18·600）+ 新建按钮 14·8·8', () => {
    const css = appCss();
    expect(rule(css, '.session-list__header')).toMatch(/padding:\s*12px 5px/);
    expect(rule(css, '.session-list__header')).toMatch(
      /border-bottom:\s*0\.5px solid var\(--border/,
    );
    const title = rule(css, '.session-list__title');
    expect(title).toMatch(/font-size:\s*18px/);
    expect(title).toMatch(/font-weight:\s*600/);
    // PrimaryButton：px14 / py8 / radius8 / primary 底 / 白字 14·600
    const create = rule(css, '.session-list__create');
    expect(create).toMatch(/padding:\s*8px 14px/);
    expect(create).toMatch(/border-radius:\s*8px/);
    expect(create).toMatch(/background:\s*var\(--primary/);
    expect(create).toMatch(/color:\s*#fff/);
    expect(create).toMatch(/font-size:\s*14px/);
    expect(create).toMatch(/font-weight:\s*600/);
    // 反面：现网注释明确警告过——加 align-items:center 会让 Android 命中区收成文字大小
    expect(create).not.toMatch(/align-items:\s*center/);
  });

  it('T-CL-DIST-07: 协议与装配进 dist（列表工厂 / 第四域 / listAction 五项）', () => {
    const script = bootScript();
    // 与 dock 同款命名分层：工厂 createConversationSessionList + 实例方法 .mount()
    expect(script).toContain('createConversationSessionList');
    expect(script).toContain('sessionList.mount()');
    // 第四域两条下行 type
    expect(script).toContain('sessionList');
    expect(script).toContain('viewState');
    // listAction 上行出口
    expect(script).toContain('listAction');
    // **web 只发五项**：rename / copy / delete / stopRun 四个是 RN 原生菜单里的
    // 选项（BottomSheetMenu 弹层留原生，见 spec §范围「不做」），web 侧既不发也
    // 不引用——所以它们被 tree-shake 出产物是**正确**表现。九项白名单的完整性由
    // dispatcher.test（T-CSL-D-06）与 bridge.test（双端相等）承担，那里读的是源码
    // 侧常量数组，不会被 tree-shake 影响。
    for (const action of ['open', 'create', 'menuOpen', 'longPress', 'batchToggle']) {
      expect(script).toContain(action);
    }
    for (const menuOnly of ['stopRun']) {
      expect(script).not.toContain(menuOnly);
    }
    // 显隐由 data-view 驱动：applyRoute 的 viewState 分支必须真写这个属性
    expect(script).toMatch(/setAttribute\("data-view", view\)/);
    // 长按常量（350ms / 10px）进产物
    expect(script).toMatch(/SESSION_LIST_LONG_PRESS_MS\s*=\s*350/);
    expect(script).toMatch(/SESSION_LIST_LONG_PRESS_MOVE_PX\s*=\s*10/);
  });

  it('T-CL-DIST-08: 装配序 = 通道 → 两 runtime → dock.mount() → sessionList.mount() → ready', () => {
    const script = bootScript();
    const entryAt = script.indexOf('src/web/chat-conversation/webview/main.ts');
    expect(entryAt).toBeGreaterThan(-1);
    const entry = script.slice(entryAt, entryAt + 2000);
    const at = (needle: string) => entry.indexOf(needle);
    expect(at('bindHostMessageChannel(dispatcher)')).toBeGreaterThan(-1);
    expect(at('createTranscriptRuntime(')).toBeGreaterThan(
      at('bindHostMessageChannel(dispatcher)'),
    );
    expect(at('createComposerRuntime(')).toBeGreaterThan(
      at('createTranscriptRuntime('),
    );
    expect(at('dock.mount()')).toBeGreaterThan(at('createComposerRuntime('));
    // 列表在 dock 之后：dock 的诊断要先于列表落地，两条错误不许互相夹带
    expect(at('sessionList.mount()')).toBeGreaterThan(at('dock.mount()'));    // 列表失败只诊断、不进 ready 闸门（闸门仍只看 composerMounted + dockMounted）
    const gate = /shouldEmitConversationReady\(\{\s*composerMounted:\s*composerRuntime\.mounted,\s*dockMounted\s*\}\)/;
    expect(entry).toMatch(gate);
    expect(entry).not.toMatch(/shouldEmitConversationReady\(\{[^}]*sessionListMounted/);
    // 列表诊断的中文串在产物里被 esbuild 转成 \uXXXX（大写十六进制）——直接查
    // 中文字面量恒不命中，得按同一套转义规则拼出来。
    expect(script).toContain(
      [...'列表视图未装配']
        .map(ch => '\\u' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'))
        .join(''),
    );
  });
});

/* ================================================================== *
 * transcriptOnly 变体的 web 侧消费面（transcript-converge · cr2-A-3 OQ3）
 *
 * 断言面刻意落**构建产物**而不是源文件：这条链的真源跨三个文件
 * （chat-conversation.css 的类名 ↔ dock.applyRoute 的 classList.toggle ↔
 * init 载荷键名），任一侧改了对不上就是「子会话屏留一条空白 dock」这种
 * 屏上看得见、源码里对不出来的问题。源文件差集断言已按 deviation 4 让位于此。
 * ================================================================== */

describe('chat-conversation transcriptOnly 变体（dist 消费面 · T-CT-DIST）', () => {
  it('T-CT-DIST-01: app.css 含 transcript-only 隐藏 dock 规则（空白不敏感）', () => {
    const css = appCss();
    // 产物实际是多行带空格形态（构建期 join + 保留缩进），照抄单行字符串会假红，
    // 故用空白不敏感正则断。少这条规则 = 子会话屏底下留一条空白 dock。
    expect(css).toMatch(
      /#app\.transcript-only\s+#composer-dock\s*\{\s*display:\s*none;?\s*\}/,
    );
  });

  it('T-CT-DIST-02: app.js 的 init 分支按 transcriptOnly 给 #app 挂类', () => {
    const script = bootScript();
    expect(script).toContain('transcript-only');
    // 类名必须与 CSS 侧选择器同名，且挂在 #app（隐藏 dock 的祖先）上。
    expect(script).toMatch(
      /getElementById\("app"\)[^;]*classList\.toggle\(\s*"transcript-only"/,
    );
  });
});
