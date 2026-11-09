/**
 * T-N7（spec §6 / 测试策略）：webview 块提交渲染契约。
 * 按 mermaid-webview.test.ts 先例——Jest 为 RN 环境无 jsdom，DOM 替换
 * 行为钉源码契约；纯逻辑（block-split 不变式）在 T-N6 直测覆盖。
 *
 * 断言口径：
 * - 块提交只 append 不重渲已完成块（insertAdjacentHTML beforebegin 到
 *   尾块容器之前，回退路径收敛到尾块容器）；
 * - 活跃块 350ms 轻量升级不破坏增量岛（升级输入/目标均为尾块容器）；
 * - 图表懒加载仍只在 commit / 历史路径触发（streamBlockCommit 分支无
 *   mermaid 扫描调用）；
 * - es2018 约束：stream 源码禁 lookbehind 等新正则特性。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {CHAT_TRANSCRIPT_BRIDGE_VERSION} from '@/components/chat/ChatTranscriptBridge';

const webSrc = (rel: string) =>
  readFileSync(join(__dirname, '../src/web', rel), 'utf8');
const rnSrc = (rel: string) =>
  readFileSync(join(__dirname, '../src/components/chat', rel), 'utf8');

/** 截取函数源码切片（G-1：脆断言改按函数切片，避免整源误报/漏报）。 */
const fnSlice = (src: string, name: string): string =>
  src.split(`function ${name}(`)[1]?.split('\nfunction ')[0] ?? '';

describe('T-N7 webview 块提交 append-only 契约', () => {
  const stream = () =>
    webSrc('chat-transcript/webview/runtime/stream/stream.ts');
  const streamMarkdown = () =>
    webSrc('chat-transcript/webview/runtime/stream/stream-markdown.ts');
  const bridge = () => webSrc('chat-transcript/webview/runtime/bridge.ts');
  const snapshot = () =>
    webSrc('chat-transcript/webview/runtime/render/snapshot.ts');
  const richStyles = () => webSrc('shared/rich-content-styles.ts');

  it('块提交 append：完成块插在尾块容器之前（insertAdjacentHTML beforebegin）', () => {
    const src = stream();
    expect(src).toContain('applyStreamBlockCommit');
    // 尾块容器类名单一来源（查询与纯文本降级判定同源常量）
    expect(src).toContain(
      "const STREAM_ACTIVE_TAIL_CLASS = 'stream-active-tail';",
    );
    expect(src).toContain("'.' + STREAM_ACTIVE_TAIL_CLASS");
    // append-only：块插到尾块容器之前，已提交块区无 innerHTML 替换路径
    expect(src).toContain('insertAdjacentHTML(');
    expect(src).toContain("'beforebegin',");
    // 块 html 缺失（超限降级）时按转义纯文本 append（同一插入点）
    expect(src).toContain('blockHtml ? blockHtml : escapeHtml(blockText)');
  });

  it('块提交后尾块重置：tailHtml 走信任边界，缺失按 tailText 降级（B-1 纯文本标记）', () => {
    const src = stream();
    const commitFn = fnSlice(src, 'applyStreamBlockCommit');
    expect(commitFn).toContain('applyTrustedHtml(tailEl, tailHtml)');
    expect(commitFn).toContain('tailEl.textContent = tailText');
    // 尾块源文本 parts 重置（350ms 升级输入）——仅随尾块载荷一起推进
    expect(commitFn).toContain(
      'tailTextParts[kind] = tailText ? [tailText] : []',
    );
    // C-orch-1：缺尾块载荷（中间 commit）时保持现状，不重置尾块
    expect(commitFn).toContain(
      'const hasTailPayload = payload.tailHtml != null || payload.tailText != null;',
    );
    // C21/C22：块提交不写回行上的 textHtml/thinkingHtml——delta 已携带全量，
    // 写回尾块会把 full 截成 tail（row.textHtml 只读用于 bubble 类名）。
    expect(commitFn).not.toMatch(/row\.textHtml\s*=[^=]/);
    expect(commitFn).not.toMatch(/row\.thinkingHtml\s*=[^=]/);
    // HTML 分支成功：清纯文本标记
    expect(commitFn).toMatch(
      /applyTrustedHtml\(tailEl, tailHtml\);[\s\S]*?setStreamTailPlainClass\(tailEl, false\)/,
    );
  });

  it('B-1: 纯文本降级走标记类补 pre-wrap——不摘 .rich（防已提交块连带降级）', () => {
    const src = stream();
    const appendFn = fnSlice(src, 'appendEscapedDelta');
    expect(appendFn).toContain('markStreamPlainTarget(el)');
    // 不再对目标摘 .rich（尾块容器摘不到、body 摘了会连带降级已提交块）
    expect(appendFn).not.toContain('setStreamBodyRichClass(el, false)');
    // 标记判定：目标是尾块容器时只挂标记类，非块级模式（目标即 body）才摘
    const markFn = fnSlice(src, 'markStreamPlainTarget');
    expect(markFn).toContain('classList.contains(STREAM_ACTIVE_TAIL_CLASS)');
    expect(markFn).toContain('setStreamBodyRichClass(el, false)');
    // CSS 单源（rich-content-styles）：尾块纯文本 pre-wrap 规则
    const css = richStyles();
    expect(css).toContain('.stream-active-tail.stream-tail-plain');
    expect(css).toContain('white-space: pre-wrap');
    // 350ms 轻量升级落富文本：清标记（否则富文本被 pre-wrap 影响）
    expect(streamMarkdown()).toContain(
      'setStreamTailPlainClass(target, false)',
    );
  });

  it('C-1: 尾块跟在已提交块之后时首段补块间距（CSS 单源）', () => {
    const css = richStyles();
    expect(css).toContain(
      '.stream-active-tail:not(:first-child) > p:first-child',
    );
    expect(css).toContain('margin-top: 0.35em;');
  });

  it('B-2: ready 上报 capabilities，RN 侧按能力协商启用块级渲染', () => {
    // webview ready 载荷：capabilities 数组为协商真源，version 仅作辅助
    const boot = webSrc(
      'chat-transcript/webview/runtime/boot/boot-transcript.ts',
    );
    expect(boot).toContain('capabilities: TRANSCRIPT_CAPABILITIES');
    expect(boot).toContain("version: 'm4'");
    // 能力标识单一来源模块（双端共用，禁 DOM/别名依赖）
    const caps = webSrc('chat-transcript/transcript-capabilities.ts');
    expect(caps).toContain(
      "TRANSCRIPT_CAPABILITY_STREAM_BLOCK_COMMIT = 'streamBlockCommit'",
    );
    expect(caps).toContain('TRANSCRIPT_CAPABILITIES');
    // RN 侧消费：ready 载荷 → 能力 ref → 切分入口恒返回 []。
    // transcript-converge 后 RN 宿主是统一组件 ChatConversationWebView
    // （旧 ChatTranscriptWebView 已退役）；ready 载荷经 readReadyCapabilities
    // 取 capabilities（等价旧的 `message.payload.capabilities` 直读）。
    const rn = rnSrc('ChatConversationWebView.tsx');
    expect(rn).toContain('readReadyCapabilities(payload)');
    expect(rn).toContain('transcriptCapabilitiesInclude(');
    expect(rn).toContain('!streamBlockCapableRef.current');
    // bridge 类型声明 capabilities 可选（旧 dist 缺字段按不支持处理）
    expect(rnSrc('ChatTranscriptBridge.ts')).toMatch(
      /capabilities\?: readonly string\[\];/,
    );
  });

  it('已完成块零重渲：增量与回退路径的渲染目标全部经尾块容器路由', () => {
    const src = stream();
    // 增量路径（appendStreamDeltaIncremental）：html 替换目标为
    // streamRenderTarget（块级模式=尾块容器，旧模式=body 兼容回滚）
    const incremental = fnSlice(src, 'appendStreamDeltaIncremental');
    expect(incremental).toContain('streamRenderTarget(');
    expect(incremental).not.toContain('applyTrustedHtml(body,');
    expect(incremental).not.toContain('applyTrustedHtml(textBody,');
    // 现网回退（updateStreamBubble → syncStreamBodiesFromState）同样不碰块区
    expect(src).toMatch(
      /function syncStreamBodiesFromState[\s\S]*?streamRenderTarget\(body\)/,
    );
    expect(src).toMatch(
      /function syncStreamBodiesFromState[\s\S]*?streamRenderTarget\(textBody\)/,
    );
    // 唯一直写 body.innerHTML 的信任边界入口只剩尾块重置（tailEl 即尾块容器）
    expect(src).toContain('applyTrustedHtml(tailEl, tailHtml)');
  });

  it('活跃块 350ms 升级：输入为尾块文本、目标为尾块容器（不破坏增量岛）', () => {
    const src = streamMarkdown();
    expect(src).toContain('STREAM_RICH_UPGRADE_MS = 350');
    expect(src).toContain("getStreamActiveTailText('thinking')");
    expect(src).toContain("getStreamActiveTailText('text')");
    expect(src).toContain('applyTrustedHtml(');
    expect(src).toContain('streamRenderTarget(');
  });

  it('图表懒加载仍只在 commit / 历史路径触发（块提交不触发）', () => {
    const bridgeSrc = bridge();
    expect(bridgeSrc).toContain("case 'streamBlockCommit':");
    expect(bridgeSrc).toContain('applyStreamBlockCommit(p)');
    expect(bridgeSrc).not.toContain('scheduleMermaidScan');
    // G-1：整源 not.toContain('mermaid') 属脆断言（改个注释就误报），改按
    // 函数切片——只钉块提交入口与尾块增量入口不触发图表扫描。
    const commitFn = fnSlice(stream(), 'applyStreamBlockCommit');
    expect(commitFn.length).toBeGreaterThan(0);
    expect(commitFn).not.toContain('mermaid');
    expect(commitFn).not.toContain('Mermaid');
    expect(commitFn).not.toContain('scheduleMermaidScan');
    const incrementalFn = fnSlice(stream(), 'appendStreamDeltaIncremental');
    expect(incrementalFn.length).toBeGreaterThan(0);
    expect(incrementalFn).not.toContain('scheduleMermaidScan');
    // streamReset 复位块级态（新一轮流从全量模式重新进入）
    expect(bridgeSrc).toMatch(
      /case 'streamReset':[\s\S]*?resetStreamBlockRenderState\(\);/,
    );
    // 历史/快照路径扫描挂接点保持 3 处（applySnapshot / applyAppendTailRows /
    // applyPrependPage；streamCommit 路径已随协议删除，T-MT1 契约不回归）
    expect(snapshot().match(/scheduleMermaidScan\(\)/g)).toHaveLength(3);
  });

  it('协议契约：streamBlockCommit payload 形状（kind/html/text/tailHtml?/tailText?）', () => {
    const bridgeTs = rnSrc('ChatTranscriptBridge.ts');
    expect(bridgeTs).toContain("'streamBlockCommit'");
    // 完成块三元组 + 尾块二元组均在 payload 类型内；尾块载荷按 C-orch-1
    // 仅末个 commit 携带，故为可选字段（webview 缺载荷保持现状）。
    expect(bridgeTs).toMatch(/kind: 'text' \| 'thinking';/);
    expect(bridgeTs).toContain('html?: string;');
    expect(bridgeTs).toContain('text: string;');
    expect(bridgeTs).toContain('tailHtml?: string;');
    expect(bridgeTs).toContain('tailText?: string;');
    // v1 信封不变：新增消息类型 + ready capabilities 均为向后兼容扩展
    // （旧端缺字段一律按不支持处理，不升版）。
    expect(CHAT_TRANSCRIPT_BRIDGE_VERSION).toBe(1);
  });

  it('RN 侧 feature flag：块级渲染默认开 + ready 能力协商运行时覆盖', () => {
    // 宿主换统一组件（transcript-converge）：行为面不变，载体随之迁移。
    const rn = rnSrc('ChatConversationWebView.tsx');
    expect(rn).toContain('STREAM_BLOCK_RENDER_ENABLED = true');
    expect(rn).toContain('takeStreamBlockSplits');
    expect(rn).toContain('postStreamBlockSplits');
    // C-orch-1：尾块载荷只挂每 split 的最后一个 commit
    expect(rn).toContain('const carriesTail = i === lastCommitIndex;');
    // 块级化只切分不 post 的顺序约束（delta 先行，块提交随后）
    expect(rn).toMatch(
      /const blockSplits = takeStreamBlockSplits\(\);[\s\S]*?postStreamBlockSplits\(blockSplits, streamId, seq\);/,
    );
    // abort overlay 全量物化口径：已提交块 parts + 活跃尾块
    expect(rn).toContain('streamCommittedTextPartsRef.current.join');
  });

  it('块提交守卫顺序与幂等：streamId → streaming → seq → blockKey → fullReplaceOnly', () => {
    const src = stream();
    const commitFn = fnSlice(src, 'applyStreamBlockCommit');
    expect(commitFn).toContain('cp.id !== payload.streamId');
    expect(commitFn).toContain("cp.status !== 'streaming'");
    expect(commitFn).toContain('payload.seq > cp.seq');
    expect(commitFn).toContain('state.appliedBlockKeys.has(payload.blockKey)');
    expect(commitFn).toContain('state.fullReplaceOnly === payload.streamId');
    // 检查顺序固定：早退放在去重/块写之前（finished 后的迟到 commit 零渲染）
    const order = [
      'cp.id !== payload.streamId',
      "cp.status !== 'streaming'",
      'payload.seq > cp.seq',
      'state.appliedBlockKeys.has(payload.blockKey)',
      'state.fullReplaceOnly === payload.streamId',
    ].map(fragment => commitFn.indexOf(fragment));
    expect(order.every(index => index >= 0)).toBe(true);
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]).toBeLessThan(order[i]);
    }
    // blockKey 只在通过全部守卫后写入（重复投递只 append 一次）
    expect(commitFn).toContain('state.appliedBlockKeys.add(payload.blockKey)');
    // 块级模式 delta 的尾块 html 参数是 tailHtml（不是全量 textHtml）：
    // 全量 html 只允许写 body 自身（writeStreamBodyFull / resetStreamBlockRenderState 后）。
    const incremental = fnSlice(src, 'appendStreamDeltaIncremental');
    expect(incremental).not.toContain('payload.textHtml');
    expect(src).toMatch(
      /appendStreamDeltaIncremental\(\s*tail,\s*kind,\s*delta,\s*tailHtml \|\| '',/,
    );
  });

  it('协议契约：streamBlockCommit 携带 streamId/seq/blockKey；流式收尾走 streamStatus', () => {
    const bridgeTs = rnSrc('ChatTranscriptBridge.ts');
    expect(bridgeTs).toContain('readonly streamId: string;');
    expect(bridgeTs).toContain('readonly seq: number;');
    expect(bridgeTs).toContain('readonly blockKey: string;');
    // 收尾只改 status（全量终态行随行），不再有 streamCommit 变体
    expect(bridgeTs).toContain("'streamStatus'");
    expect(bridgeTs).toContain('row?: TranscriptRow;');
    // 上行 resync 新协议
    expect(bridgeTs).toMatch(/streamResync.*expectedSeq/s);
  });

  it('块级态复位：streamReset 分支先作废旧代次分片，再清块/升级态', () => {
    const bridgeSrc = bridge();
    expect(bridgeSrc).toMatch(
      /case 'streamReset':[\s\S]*?clearStreamRichUpgrade\(\);[\s\S]*?resetStreamBlockRenderState\(\);[\s\S]*?invalidateSnapshotPipeline\(generation\);[\s\S]*?applyStreamReset\(p\);/,
    );
  });

  it('es2018 约束：stream 源码禁 lookbehind 等新正则特性', () => {
    const files = [
      stream(),
      streamMarkdown(),
      webSrc('chat-transcript/stream/block-split.ts'),
      webSrc('chat-transcript/transcript-capabilities.ts'),
    ];
    for (const src of files) {
      expect(src).not.toContain('(?<');
      expect(src).not.toContain('\\p{');
      expect(src).not.toContain('s})'); // dotAll flag 无出现面
    }
  });
});
