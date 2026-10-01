/**
 * T-CC-ASM：chat-conversation 合成包 dist 契约测（chat-webview-unify Step 2）。
 *
 * 读 webview-dist 产物（pretest 已 build:webview），风格对照 chat-transcript-boot-script.test.ts。
 * 本节点只锁「壳结构 + 注入证据」，dock 内容与协议装配由 Step 3/4/5 的测试接手。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {readWebViewDistFile} from './helpers/read-webview-dist';
import {composerToolBtnStyle} from '../src/web/chat-conversation/styles/dock-style-reference';

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
    // `html,body{background:transparent}`——与本文件的 `--bg` 实底直接冲突。
    // （注入段 CHAT_TRANSCRIPT_RICH_CSS 自带的规则不在本断言面内，故读源文件；
    //   源文件的说明注释里恰好引用了这条反面清单，先剥注释再判。）
    const source = readFileSync(
      join(
        __dirname,
        '../src/web/chat-conversation/styles/chat-conversation.css',
      ),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(source).not.toMatch(
      /html,\s*body\s*\{[^}]*background:\s*transparent/,
    );
    // 源文件的 html,body 底色必须是 --bg 实底
    expect(source).toMatch(/html,\s*body\s*\{[^}]*background:\s*var\(--bg/);
  });

  /**
   * T-FS1 迁居点（Step 8）：⛶ / @ / $ 同排三钮「同款圆钮」的样式相等断言。
   *
   * 原来这条断言长在 `composer-fullscreen.test.tsx` 里，量的是 RN 侧
   * `ChatComposer` 工具栏三个 Pressable 的展平 style。Step 8 legacy 转录引擎
   * 退役后 `ChatComposer.tsx` 整个删掉，⛶ 已经是 web 文档里的
   * `<button class="toolbar__btn toolbar__fullscreen">`，RN 侧没有这个元素了。
   *
   * 断言没有跟着消失，而是换了参照面：RN 侧的真源被 Step 6 提前手抄进了
   * `dock-style-reference.ts`（`ChatComposer.tsx` 一删，数值出处就没了），
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

  it('T-CC-CSS-12: 源文件保留且只保留一份注入占位注释；dist 里两个占位均已消失', () => {
    const source = readFileSync(CONVERSATION_CSS_SRC, 'utf8');
    expect(placeholderCount(source, '/* __RICH_CSS__ */')).toBe(1);
    expect(
      placeholderCount(source, '/* __MERMAID_FULLSCREEN_CSS__ */'),
    ).toBe(1);
    // 占位在 dist 消失 = injectCss 命中（漏一个就会原样留在产物里）
    const css = appCss();
    expect(css).not.toContain('/* __RICH_CSS__ */');
    expect(css).not.toContain('/* __MERMAID_FULLSCREEN_CSS__ */');
  });

  it('T-CC-CSS-13: 合成包源覆盖 transcript.css 全部顶层 selector（基底 = 全文）', () => {
    const transcript = cssRules(readFileSync(TRANSCRIPT_CSS_SRC, 'utf8'));
    const conversation = cssRules(readFileSync(CONVERSATION_CSS_SRC, 'utf8'));
    const missing = [...transcript.keys()].filter(s => !conversation.has(s));
    expect(missing).toEqual([]);
    // 反面：只挑几条关键 selector 抄一遍不算基底补全（漂移会静默复发），
    // 故此处以全量差集为零作为契约。
  });

  it('T-CC-CSS-14: toolbar 按钮无自创 :disabled 置灰（现网 RN disabled 无灰化变体）', () => {
    const rules = cssRules(appCss());
    // 反面清单：`:disabled { opacity }` 是合成包自创的置灰，现网 RN 侧 disabled
    // 只是透传的死参数，没有视觉变体——留它会让圆钮凭空变灰。
    expect(rules.has('.toolbar__btn:disabled')).toBe(false);
    // 发送键的 disabled 视觉走底色态（tokens.border），保留
    expect(rules.get('.toolbar__send--disabled')).toMatch(/var\(--border/);
    // chips 同样不置灰（走的是「不随 inputDisabled 变灰」的既约定）
    expect(rules.get('.chip') ?? '').not.toMatch(/opacity/);
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

  it('T-CC-CSS-07: chips 数值清单（chip padV6/padH10/radius14/hairline/maxW200；label 12/maxW160；transparentRow marginBottom4；content gap6/padR8；横向滚动）', () => {
    const css = appCss();
    const row = rule(css, '.chips__row');
    // transparentRow 变体：行底色透明 + marginBottom:4（maxHeight:36/marginBottom:6 属非 transparent 变体）
    expect(row).toMatch(/margin-bottom:\s*4px/);
    expect(row).toMatch(/gap:\s*6px/);
    expect(row).toMatch(/padding-right:\s*8px/);
    expect(row).toMatch(/overflow-x:\s*auto/);
    expect(row).toMatch(/background:\s*transparent/);
    expect(row).not.toMatch(/max-height:\s*36px/);

    const chip = rule(css, '.chip');
    expect(chip).toMatch(/max-width:\s*200px/);
    expect(chip).toMatch(/padding:\s*6px\s+10px/);
    expect(chip).toMatch(/border-radius:\s*14px/);
    expect(chip).toMatch(/border:\s*0\.5px solid/);

    const label = rule(css, '.chip__label');
    expect(label).toMatch(/font-size:\s*12px/);
    expect(label).toMatch(/max-width:\s*160px/);
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
    expect(list).toMatch(/border-radius:\s*10px/);
    expect(list).toMatch(/border:\s*0\.5px solid/);
    expect(list).toMatch(/background:\s*var\(--surface/);
    const row = rule(css, '.typeahead__row');
    expect(row).toMatch(/padding:\s*8px\s+10px/);
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

  it('T-CC-V2-03: 零 heightChange 上行链（heightReport:false）与零 composer ready', () => {
    const script = bootScript();
    // 两 runtime 均以 emitReady:false 装配 → 合成包内 composer 不发自己的 ready
    expect(script).toMatch(/emitReady:\s*false/);
    expect(script).toMatch(/heightReport:\s*false/);
    // ready 版本标识是字符串字面量 "u1"（不是旧包的数字 1 / 'm4'）
    expect(script).toContain('"u1"');
  });
});
