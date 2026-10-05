/**
 * T-BB-06：chat-transcript 契约测迁移矩阵 — 读 webview-dist 产物（pretest 已 build:webview）。
 * 三列矩阵见 mobile-webview-preact-htm SPEC（必须保留 / 可改为 token / 允许删除）。
 *
 * transcript-converge 后转录不再有独立的 chat-transcript 文档包（转录并入
 * chat-conversation 合成包，旧 index.html / main.ts 退役），故本套件的 dist 读取
 * 一律改指合成包产物——转录 runtime（renderRows / 菜单 / 流式 / 快照）由合成包
 * 以 `bindChannel:false, emitReady:false` 装配后打进同一份 app.js，契约面不变。
 * 合成包壳自身的结构断言由 chat-conversation-boot-script.test.ts 承担。
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

describe('chat-transcript WebView boot (T-BB-06 / dist)', () => {
  it('T-PH-07: build-webview 保持 minify:true（dist 契约测断言 minify 稳定面）', () => {
    const buildScript = readFileSync(
      join(__dirname, '../scripts/build-webview.mjs'),
      'utf8',
    );
    // 2026-10-05 SPA 回滚轮起 minify:true。本断言原先钉 minify:false，压缩打开后
    // 它会被脚本里那段讲「未压缩 8.8MiB 产物病态回溯」的**注释**里的 `minify:false`
    // 命中而假通过——比红还坏。改成钉真实配置行（注释里那处前面带 `minify:false 的
    // 8.8 MiB`，前后都有中文，用「行首即配置项」区分）。
    expect(buildScript).toMatch(/^\s*minify:\s*true,?\s*$/m);
    expect(buildScript).not.toMatch(/^\s*minify:\s*false,?\s*$/m);
  });

  it('T-BR-ASM-01: script parses and has readyState fallback', () => {
    const script = bootScript();
    // minify 会把 `readyState === "loading"` 的空格压掉 → `readyState==="loading"`，
    // 故用容忍空白的正则锁「DOMContentLoaded 兜底」这一形态。
    expect(script).toMatch(/readyState\s*===\s*['"]loading['"]/);
    // minify 重命名 bootTranscript 本体；换它唯一产出的稳定面——转录 runtime
    // 发 ready 时带的版本标识字面量 `version:"m4"`（数字 1 / 'u1' 是合成包
    // 壳的 ready，别混）。装配行为由 chat-conversation-entry.test 真跑
    // main.ts 的断言锁（那里更强）。
    expect(script).toMatch(/version:\s*['"]m4['"]/);
    expect(() => {
      // eslint-disable-next-line no-new-func -- 语法守护：boot IIFE 不可损坏
      new Function(script);
    }).not.toThrow();
  });

  it('T-BR-ASM-03: shell has scroller/rows; relative app.js/app.css（无 BASE_URL）', () => {
    const html = indexHtml();
    expect(html).toContain('id="scroller"');
    expect(html).toContain('id="rows"');
    expect(html).toContain('./app.js');
    expect(html).toContain('./app.css');
    expect(html).toContain('<script src="./app.js"');
    expect(html).not.toContain('type="module"');
    expect(html).not.toContain('https://novel-master.local/');
  });

  it('T-BR-ASM-04: ready post and bootTranscript present', () => {
    const script = bootScript();
    // transcript-converge：转录 runtime 在合成包里以 `emitReady:!1` 装配，
    // ready 由合成包入口自持的 post 发（转录侧 `version:"m4"`、壳侧 `"u1"`）。
    // minify 会把 post 绑定本身重命名（post / post2 / _t / mot…），函数名锚恒失；
    // 锚「(type 字面量, {version:…} payload)」这个调用形态——发单条 ready 的
    // 意图由 T-BR-ASM-01 的 version:"m4" 与本条的 version payload 共同钉住。
    expect(script).toMatch(/\(\s*['"]ready['"]\s*,\s*\{\s*version:/);
    expect(script).toMatch(/version:\s*['"]m4['"]/);
  });

  it('T-PH-05: renderRows Preact 装配 + TrustedHtml（行/工具）', () => {
    const script = bootScript();
    // minify 重命名所有组件/工厂标识符（registerRenderRows / RowList /
    // MessageRow / ToolGroup / TrustedHtml）。断言换它们留下的稳定面：
    //   · 行列表渲染根 = #rows（唯一挂载口，删了 Preact 装配就没了）
    //   · 消息行 / 工具组 = data-action 与 data-* 标记字符串
    //   · TrustedHtml = 它唯一产出的 {__html:…} 属性字面量
    //   · ToolGroup 的折叠键 = "toggle-tool-group"
    // 装配行为本身由 chat-transcript-row-window.test.ts /
    // chat-transcript-snapshot-chunk.test.ts 真跑 renderRows 的行为断言锁。
    expect(script).toMatch(/getElementById\(['"]rows['"]\)/);
    expect(script).toContain('message-menu-row');
    expect(script).toMatch(/['"]toggle-tool-group['"]/);
    expect(script).toMatch(/['"]toggle-attach-group['"]/);
    expect(script).toMatch(/dangerouslySetInnerHTML:\{__html:\w+\}/);
    // 行列表主路径不再 list.innerHTML = 拼串骨架
    expect(script).not.toMatch(/list\.innerHTML\s*=\s*html/);
  });

  it('T-TRB: 工具结果阅读分支进包（渲染键与上抛键成对出现）', () => {
    // 弱证据但有兜底价值：渲染侧 data-action='open-tool-result' 与
    // rows-click 上抛 'openToolResult' 必须同时存在于产物——少一个即
    // 点了没反应（渲染键/读取键不一致是 ucu P0 的旧伤）。
    const script = bootScript();
    expect(script).toContain('open-tool-result');
    expect(script).toContain('openToolResult');
  });

  it('T-BR-CT-01: menu overlay / grace / layoutContextMenu contracts', () => {
    const script = bootScript();
    const html = indexHtml();
    // 必须保留（ISD SPEC 契约测修订矩阵）
    // minify 重命名所有函数标识符（layoutContextMenu / handleMenuOverlayEvent /
    // openContextMenuFromAnchor / attachMenuNativeTextBlock /
    // registerRenderContextMenu / MenuOverlay / ContextMenu）。断言换稳定面：
    // 上行协议 type、DOM id/类名/属性名、state 字段名、数值常量。
    // ① overlay 关闭监听位：click + touchend 都挂在 state.menuOverlayHandler 上
    //    （state 字段名是属性名，压缩改不了）
    expect(script).toMatch(/menuOverlayHandler/);
    expect(script).toMatch(
      /addEventListener\(\s*['"]touchend['"]\s*,\s*\w+\.menuOverlayHandler/,
    );
    expect(script).toMatch(
      /addEventListener\(\s*['"]click['"]\s*,\s*\w+\.menuOverlayHandler/,
    );
    // ② 原生长按菜单拦截：contextmenu/selectstart 挂在
    //    state.menuNativeTextBlockHandler 上，且 handler 同时取
    //    #context-menu 与 #menu-backdrop（attachMenuNativeTextBlock 的产出）
    expect(script).toMatch(/menuNativeTextBlockHandler/);
    expect(script).toMatch(
      /addEventListener\(\s*['"]contextmenu['"]\s*,\s*\w+\.menuNativeTextBlockHandler/,
    );
    expect(script).toMatch(
      /getElementById\(\s*['"]context-menu['"]\s*\)[\s\S]{0,120}?getElementById\(\s*['"]menu-backdrop['"]\s*\)/,
    );
    // ③ grace：MENU_OPEN_GRACE_MS(400) 内点消息行不误关（openContextMenuFromAnchor
    //    打开时写的 menuOpenedAt 时间戳）。常量被 minify 内联，故钉数值形态。
    expect(script).toMatch(/menuOpenedAt/);
    expect(script).toMatch(
      /menuOpenedAt\s*&&\s*\w+\.now\(\)\s*-\s*\w+\.menuOpenedAt\s*<\s*400/,
    );
    // ④ layoutContextMenu：产出 scrollable 位 + 「context-menu scrollable」类名
    expect(script).toMatch(/scrollable:\s*(?:false|!1)/);
    expect(script).toMatch(/['"]context-menu scrollable['"]/);
    // ⑤ 菜单壳：portal / backdrop / 项 / 协议 type
    expect(html).toContain('id="menu-portal"');
    expect(script).toMatch(/getElementById\(\s*['"]menu-portal['"]\s*\)/);
    expect(script).toContain('context-menu');
    expect(script).toContain('menu-backdrop');
    expect(script).toMatch(/className:\s*['"]menu-item['"]/);
    expect(script).toMatch(/['"]data-action['"]\s*:\s*['"]menu-action['"]/);
    expect(script).toMatch(/getAttribute\(\s*['"]data-menu-action['"]\s*\)/);
    // 菜单开/关/动作三段上行协议 type（openContextMenuFromAnchor / closeContextMenu
    // / handleMenuOverlayEvent 的唯一外部可见面）
    expect(script).toMatch(/['"]openMessageMenu['"]\s*,\s*\{\s*messageId:/);
    expect(script).toMatch(/['"]menuOpened['"]\s*,\s*\{\}/);
    expect(script).toMatch(/['"]menuClosed['"]\s*,\s*\{\}/);
    expect(script).toMatch(/['"]messageMenuAction['"]\s*,\s*\{\s*messageId:/);
    // P1-4 弱证据：visibility 上下行 + measure 形态（menuEl.offsetHeight ||
    // menuEl.scrollHeight → 非 0 才定位）。原先锚的 `measuredHeight` 是局部变量名，
    // minify 恒失——换它读的属性名。
    expect(script).toMatch(/['"]visibility['"]\s*,\s*\{\s*hidden:/);
    expect(script).toMatch(/\.offsetHeight\|\|\w+\.scrollHeight/);
    // 布局 / 锚点意图（⋯ 传按钮 rect；长按开菜单主路径已移除）
    expect(script).toContain('message-menu-btn');
    expect(script).toContain('scrollable');
    expect(script).toMatch(
      /className:\s*['"]message-menu-btn['"][\s\S]{0,400}?getBoundingClientRect\(\)/,
    );
    // 项数门禁已迁 MenuOverlay（不再是 menu.items.length）：常量
    // MESSAGE_ACTION_MENU_ITEM_COUNT(5) 被内联，故钉 `<len> <= 5 &&` 比较形态
    expect(script).toMatch(/\.length\s*<=\s*5\s*&&/);
    // decodeLiteralHtmlEntities 被重命名；锁它唯一的实现指纹（实体解码表首项）
    expect(script).toMatch(/replace\(\/&quot;\/g/);
    expect(script).toMatch(/replace\(\/&lt;\/g/);
    // 「rich 开关」本地量 richToggledOn 被重命名；锁它所在的 flagsUpdate 分支
    // 与它写的 richText 位（重渲由 flags 变更驱动）
    expect(script).toMatch(/case\s*['"]flagsUpdate['"]\s*:/);
    expect(script).toMatch(/flags:\s*\{\s*richText:\s*!1\s*,\s*menuDisabled:\s*!1\s*\}|richText:\s*!1/);
    // bind-shell 无长按开菜单：原先锚的 onMessagePointerDown/Move 是标识符，
    // minify 下 not.toContain 恒真失效——换事件名形态（产物里一个 touchstart
    // 监听都不该有）。
    expect(script).not.toMatch(/addEventListener\(\s*['"]touchstart['"]/);
    // 菜单项不再手拼 html +=
    expect(script).not.toMatch(/['"][^'"]*<button[^'"]*menu-item/);
    // 防回潮：菜单壳不得再 createElement + appendChild(body)
    expect(script).not.toMatch(
      /document\.createElement\([\s\S]{0,400}?\.appendChild\s*\(\s*(?:document\.)?body\s*\)/,
    );
    // overlay 关闭入口可检（允许删精确 addEventListener 整行字面）
    expect(script).toMatch(/addEventListener\s*\(\s*["']click["']/);
  });

  it('T-MN2: ⋯ 为菜单主入口；bind-shell 无长按开菜单', () => {
    const script = bootScript();
    const css = appCss();
    // minify 重命名 openContextMenuFromAnchor；锚它唯一产出的上行协议
    // （openMessageMenu 带 messageId/pageX/pageY —— 「⋯ 传按钮 rect 作锚点」
    // 的外部可见面）+ 按钮类名。
    expect(script).toMatch(/['"]openMessageMenu['"]\s*,\s*\{\s*messageId:/);
    expect(script).toContain('message-menu-btn');
    expect(css).toContain('.message-menu-btn');
    // 长按开菜单主路径已从 boot 移除：原先锚的 onMessagePointerDown 是标识符，
    // minify 下恒真失效——换事件名形态（产物里不应再有 touchstart 监听）。
    expect(script).not.toMatch(/addEventListener\(\s*['"]touchstart['"]/);
  });

  it('T-BR-CT-02: openContextMenuFromAnchor 使用按钮 rect 作 MenuAnchor', () => {
    const script = bootScript();
    // minify 重命名 openContextMenuFromAnchor 本体（⋯ 按钮 onClick 里那个调用
    // 形如 `<短符号>(t.id,h.getBoundingClientRect(),h)`）；锚「按钮类名 →
    // getBoundingClientRect()」这条调用链的距离形态 + anchor 四元组字段名。
    expect(script).toMatch(
      /className:\s*['"]message-menu-btn['"][\s\S]{0,400}?getBoundingClientRect\(\)/,
    );
    // anchor 写入 rect 的 x/y/width/height（打包后局部名被压成短符号，字段名保留）
    expect(script).toMatch(
      /\{\s*x:\s*\w+\.x\s*,\s*y:\s*\w+\.y\s*,\s*width:\s*\w+\.width\s*,\s*height:\s*\w+\.height\s*\}|width:\s*\w+\.width/,
    );
  });

  it('T-BR-CT-03: stream waiting-first / incremental / rich+noHtml', () => {
    const script = bootScript();
    // 必须保留：相位 / 增量 / 符号（三列矩阵）
    // minify 把这批内部函数/组件标识符全压成短符号（getStreamTailPhase /
    // streamHasContent / setStreamToolInvokingDom / ensureStreamTextBody /
    // updateStreamBubble / appendStreamDelta* / applyStreamBatch /
    // renderStreamingMarkdown / scheduleStreamRichUpgrade / StreamTail /
    // StreamBodyHost / applyTrustedHtml）。断言换它们的稳定面：
    // 相位与 kind 的字符串字面量阶梯、state 字段名、DOM 类名/属性名、
    // 「html 缺失退回空串」的表达式形态。
    // ① 相位阶梯（getStreamTailPhase 的三档返回值，顺序即优先级）
    expect(script).toMatch(
      /['"]idle-after-content['"]\s*:\s*['"]waiting-first['"]\s*:\s*['"]active['"]/,
    );
    // ② 有内容判定（streamHasContent）：text 或 thinking 任一 trim 后非空
    expect(script).toMatch(
      /String\(\w+\.stream\.text\|\|['"]{2}\)\.trim\(\)\.length>0\|\|String\(\w+\.stream\.thinking\|\|['"]{2}\)\.trim\(\)\.length>0/,
    );
    // ③ 文本壳（ensureStreamTextBody / setStreamToolInvokingDom 共用）：
    //    .bubble-body 容器 + data-text-shell 标记
    expect(script).toMatch(/querySelector\(['"]\.bubble-body['"]\)/);
    expect(script).toMatch(
      /setAttribute\(\s*['"]data-text-shell['"],\s*['"]1['"]\s*\)/,
    );
    // ④ 流式累积状态字段名（updateStreamBubble 写的两个 html 位）
    expect(script).toMatch(/stream\.textHtml=/);
    expect(script).toMatch(/stream\.thinkingHtml=/);
    // ⑤ kind 分派（appendStreamDelta / applyStreamBatch 的 text|thinking 二分）
    expect(script).toMatch(
      /kind===\s*['"]thinking['"]\s*\?\s*['"]thinking['"]\s*:\s*['"]text['"]/,
    );
    // ⑥ 增量优先：按 kind 分桶累积（`<桶表>[kind].push(delta)`）
    expect(script).toMatch(/\w+\[\w+\]\.push\(/);
    // ⑦ 两条下行协议分支（case 形态：minify 去掉 case 与冒号间空白）
    expect(script).toMatch(/case\s*['"]streamBatch['"]\s*:/);
    expect(script).toMatch(/case\s*['"]streamBlockCommit['"]\s*:/);
    // 可改为 token：waiting-first / text-shell / TrustedHtml（壳已迁 ui/stream）
    expect(script).toContain('stream--waiting-first');
    expect(script).toContain('stream-waiting-indicator');
    expect(script).toContain('data-text-shell');
    expect(script).toMatch(/querySelector\(\s*['"]\.bubble['"]\s*\)/);
    // TrustedHtml 组件标识符被重命名；锁它唯一产出的 {__html:…} 属性字面量
    expect(script).toMatch(/dangerouslySetInnerHTML:\{__html:\w+\}/);
    // StreamTail 壳：#stream-tail 承载根 + stream 行类名
    expect(script).toContain('getElementById("stream-tail")');
    expect(script).toMatch(/className:\s*['"]row stream['"]/);
    // 允许删除：renderStream* / renderAssistantBubbleInner 纯 HTML 壳函数。
    // 原先锚的是函数标识符（minify 下恒真失效），换成它们**产出**的形态——
    // 一旦有人把拼串 HTML 壳搬回来，产物里就会重新出现
    // 「<div …stream / …bubble」这类 HTML 字面量。
    expect(script).not.toMatch(/['"][^'"]*<div[^'"]*stream/);
    expect(script).not.toMatch(/['"][^'"]*<div[^'"]*bubble/);
    expect(script).not.toMatch(/['"][^'"]*class=['"]?[^'"]*bubble/);
    // 局部名可能因 Preact 打包重命名；保留 payload.html / 增量回退意图
    expect(script).toMatch(/\w+\.html\s*\|\|\s*[\"'][\"']/);
    // streamReset / streamCommit 两处把两个 html 位清空（minify 后是对象字面量形态）
    expect(script).toMatch(/textHtml:\s*['"]['"]/);
    expect(script).toMatch(/thinkingHtml:\s*['"]['"]/);
    // rich 开关缺 html 时不得渲染空壳：现产物形态为
    // `flags.richText&&<html>` 短路（局部名被压成短符号，用 \w+ 容忍）
    expect(script).toMatch(/flags\.richText&&\w+/);
    // tool-invoking 单路径：壳归 Preact ToolInvokingBar；runtime 不得再拼串/createElement 插条。
    // ToolInvokingBar 标识符被重命名 → 锁它产出的三个类名。
    expect(script).toContain('tool-invoking-bar');
    expect(script).toContain('tool-invoking-dot');
    expect(script).toContain('tool-invoking-label');
    // renderToolInvokingBar（runtime 侧旧拼串壳）标识符已不存在；
    // 换锚：Preact 壳里那条「生成中」文案（runtime 手拼会产出同样的字面量，
    // 故只锁类名不锁文案，防误伤）。
    expect(script).not.toMatch(/['"][^'"]*<div[^'"]*tool-invoking-bar/);
  });

  it('T-PH-06: 流式壳/增量分离与 P0-2 所有权', () => {
    const script = bootScript();
    // minify 重命名 appendStreamDeltaIncremental / appendStreamDelta /
    // StreamTail / StreamBodyHost / applyTrustedHtml。断言换稳定面：
    // 增量分桶累积（appendStreamDelta* 的热路径）+ 按 kind 分派 +
    // 文本壳 #stream-tail 承载根 + TrustedHtml 的 __html 字面量。
    expect(script).toMatch(/\w+\[\w+\]\.push\(/);
    expect(script).toMatch(
      /kind===\s*['"]thinking['"]\s*\?\s*['"]thinking['"]\s*:\s*['"]text['"]/,
    );
    expect(script).toContain('getElementById("stream-tail")');
    expect(script).toMatch(/className:\s*['"]row stream['"]/);
    expect(script).toMatch(/dangerouslySetInnerHTML:\{__html:\w+\}/);
    // delta 热路径不得整表重建 #stream-tail 内容根：增量优先，失败才整表回退。
    // 回退判据的稳定面 = 相位三档字面量（增量判据读的就是它）。
    expect(script).toMatch(
      /['"]idle-after-content['"]\s*:\s*['"]waiting-first['"]\s*:\s*['"]active['"]/,
    );
  });

  it('T-BR-CT-04: streamCommit / promote tail', () => {
    const script = bootScript();
    // minify 重命名 applyStreamCommit / promoteStreamTailToRow 与 dispatcher
    // 局部（state → 短符号）。断言换稳定面：case 形态 + 协议 type 字面量 +
    // pending 队列的 kind 判别式 + 行数组 concat 形态 + 提升目标节点 id。
    expect(script).toMatch(/case\s*['"]streamCommit['"]\s*:/);
    expect(script).toMatch(/kind:\s*['"]streamCommit['"]/);
    // applyStreamCommit 把行塞进 pending 队列（kind 三态：appendTail / prependPage / streamCommit）
    expect(script).toMatch(/kind===\s*['"]appendTail['"]\?/);
    expect(script).toMatch(/kind===\s*['"]prependPage['"]\?/);
    // promoteStreamTailToRow：把流式尾节点提为行（目标节点 id 是稳定面）
    expect(script).toContain('getElementById("stream-tail")');
    // state.rows = state.rows.concat(toAppend) → `<短符号>.rows.concat(`
    expect(script).toMatch(/rows=\w+\.rows\.concat\(/);
  });

  it('T-BR-CT-05: vfs tool path normalize symbols', () => {
    const script = bootScript();
    // minify 重命名 resolveVfsToolFilePath / resolveLogicalPathForToolCard /
    // normalizePathForToolCard。断言换它们唯一产出的字符串面：抛错文案 +
    // `vfs.` 前缀裁剪 + file_path 兼容字段（core 镜像的老坑）。
    expect(script).toContain('invalid path');
    expect(script).toContain('path escapes above root');
    expect(script).toMatch(/indexOf\(\s*['"]vfs\.['"]\s*\)\s*===?\s*0/);
    expect(script).toMatch(/\.file_path/);
  });

  it('T-BR-CT-06: bubble--fill-width / data-text-shell', () => {
    const script = bootScript();
    // 意图：文本壳 / fill-width；壳可由 TSX 产出，断言改 token（三列矩阵）
    // hasThinking / hasTools / getStreamTailPhase 是局部变量与函数标识符，
    // minify 下恒失——换它们驱动出的类名与相位字面量。
    expect(script).toContain('bubble--fill-width');
    expect(script).toContain('data-text-shell');
    expect(script).toContain('thinking-body-divided');
    expect(script).toContain('idle-after-content');
  });

  it('T-BR-CT-07: no parseUserVfsAction / user-vfs-action regression', () => {
    const script = bootScript();
    expect(script).not.toContain('user-vfs-action');
    expect(script).not.toContain('parseUserVfsAction');
  });

  it('T-BR-CSS-01: rich list padding in app.css', () => {
    const css = appCss();
    expect(css).toContain('.bubble.rich ol');
    expect(css).toContain('.bubble.rich ul');
    expect(css).toContain('padding-left: 1.5em');
    expect(css).toContain('outside markers stay inside the content area');
  });

  it('T-BR-SYNC-01…14: boot 常量单源（minify 内联后 dist 面不再回显名与值）', () => {
    // 这条用例的原始形态是「在 dist 里 grep `var X = <值>;`」——它成立的前提是
    // 未压缩构建会把 `import {X} from '@web/shared/constants'` 在 IIFE 顶层
    // 还原成同名 var 声明。minify:true（2026-10-05）把常量直接内联成字面量，
    // 名与值都不再出现在产物里，`var X = N;` 指纹整体消失。
    // 换断言面：① 单源性（各消费点都从 shared/constants import，不得本地另立一份）
    //           —— 这才是这条用例真正想守的东西；② 少数几个能从产物读出的
    //           数值消费点，钉「比较形态 + 内联值」。
    const webSrc = (rel: string) =>
      readFileSync(join(__dirname, '../src/web', rel), 'utf8');
    const script = bootScript();

    const consumers = [
      'chat-transcript/webview/runtime/menu/menu.ts',
      'chat-transcript/webview/runtime/scroll/scroll.ts',
      'chat-transcript/webview/ui/menu/MenuOverlay.tsx',
    ];
    for (const rel of consumers) {
      const src = webSrc(rel);
      expect(src).toContain("from '@web/shared/constants'");
      // 不得在消费点本地重定义任一枚举常量（那才是 dist grep 当年要抓的漂移）
      for (const name of [
        'NEAR_BOTTOM_THRESHOLD_PX',
        'MENU_OPEN_GRACE_MS',
        'MESSAGE_ACTION_MENU_ITEM_COUNT',
      ]) {
        expect(src).not.toMatch(
          new RegExp(`(?:const|let|var)\\s+${name}\\s*=`),
        );
      }
    }
    // web/C-3：NEAR_BOTTOM 短别名已删，消费点统一全名。
    for (const rel of consumers) {
      expect(webSrc(rel)).not.toMatch(/\bNEAR_BOTTOM\b(?!\w)/);
    }

    // 产物里仍读得到的两个数值消费点（其余常量被布局算法整体内联，
    // 无法与同名无关的数字区分——不再硬凑，缺口见下方注释）：
    //   MENU_OPEN_GRACE_MS(400)：grace 窗口比较
    expect(script).toMatch(
      /menuOpenedAt\s*&&\s*\w+\.now\(\)\s*-\s*\w+\.menuOpenedAt\s*<\s*400/,
    );
    //   MESSAGE_ACTION_MENU_ITEM_COUNT(5)：项数门禁比较
    expect(script).toMatch(/\.length\s*<=\s*5\s*&&/);
    // 【已知缺口】NEAR_BOTTOM_THRESHOLD_PX / ANCHORED_MENU_* 九项在 minify 后
    // 无可区分的产物指纹（80/8/12/44/48/360/132/200/32/14 都是产物里到处
    // 在用的裸数字），dist 面不再覆盖；单源性由上面三条 import + 无本地
    // 重定义守住，数值本身由 shared/constants.ts 单点定义、无第二份拷贝。
  });
});
