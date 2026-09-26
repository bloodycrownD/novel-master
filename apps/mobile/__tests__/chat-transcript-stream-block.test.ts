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

describe('T-N7 webview 块提交 append-only 契约', () => {
  const stream = () =>
    webSrc('chat-transcript/webview/runtime/stream/stream.ts');
  const streamMarkdown = () =>
    webSrc('chat-transcript/webview/runtime/stream/stream-markdown.ts');
  const bridge = () => webSrc('chat-transcript/webview/runtime/bridge.ts');
  const snapshot = () =>
    webSrc('chat-transcript/webview/runtime/render/snapshot.ts');

  it('块提交 append：完成块插在尾块容器之前（insertAdjacentHTML beforebegin）', () => {
    const src = stream();
    expect(src).toContain('applyStreamBlockCommit');
    expect(src).toContain('.stream-active-tail');
    // append-only：块插到尾块容器之前，已提交块区无 innerHTML 替换路径
    expect(src).toContain('insertAdjacentHTML(');
    expect(src).toContain("'beforebegin',");
    // 块 html 缺失（超限降级）时按转义纯文本 append（同一插入点）
    expect(src).toContain('blockHtml ? blockHtml : escapeHtml(blockText)');
  });

  it('块提交后尾块重置：tailHtml 走信任边界，缺失按 tailText 降级', () => {
    const src = stream();
    expect(src).toContain('applyTrustedHtml(tailEl, tailHtml)');
    expect(src).toContain('tailEl.textContent = tailText');
    // 尾块源文本 parts 重置（350ms 升级输入）
    expect(src).toContain('tailTextParts[kind] = tailText ? [tailText] : []');
  });

  it('已完成块零重渲：增量与回退路径的渲染目标全部经尾块容器路由', () => {
    const src = stream();
    // 增量路径（appendStreamDeltaIncremental）：html 替换目标为
    // streamRenderTarget（块级模式=尾块容器，旧模式=body 兼容回滚）
    const incremental = src
      .split('export function appendStreamDeltaIncremental(')[1]
      .split('export function ')[0];
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
    expect(src).toContain('applyTrustedHtml(streamRenderTarget(');
  });

  it('图表懒加载仍只在 commit / 历史路径触发（块提交不触发）', () => {
    const bridgeSrc = bridge();
    expect(bridgeSrc).toContain("case 'streamBlockCommit':");
    expect(bridgeSrc).toContain('applyStreamBlockCommit(p)');
    expect(bridgeSrc).not.toContain('scheduleMermaidScan');
    expect(stream()).not.toContain('mermaid');
    expect(stream()).not.toContain('Mermaid');
    // streamReset / streamCommit 复位块级态（新一轮流从全量模式重新进入）
    expect(bridgeSrc).toMatch(
      /case 'streamReset':[\s\S]*?resetStreamBlockRenderState\(\);/,
    );
    expect(bridgeSrc).toMatch(
      /case 'streamCommit':[\s\S]*?resetStreamBlockRenderState\(\);/,
    );
    // 历史/commit 路径扫描挂接点保持 5 处（T-MT1 契约不回归）
    expect(snapshot().match(/scheduleMermaidScan\(\)/g)).toHaveLength(5);
  });

  it('协议契约：streamBlockCommit payload 形状（kind/html/text/tailHtml/tailText）', () => {
    const bridgeTs = rnSrc('ChatTranscriptBridge.ts');
    expect(bridgeTs).toContain("'streamBlockCommit'");
    // 完成块三元组 + 尾块二元组均在 payload 类型内
    expect(bridgeTs).toMatch(/kind: 'text' \| 'thinking';/);
    expect(bridgeTs).toContain('html?: string;');
    expect(bridgeTs).toContain('text: string;');
    expect(bridgeTs).toContain('tailHtml?: string;');
    expect(bridgeTs).toContain('tailText: string;');
    // v1 信封不变（未升版——新增消息类型向后兼容）
    expect(CHAT_TRANSCRIPT_BRIDGE_VERSION).toBe(1);
  });

  it('RN 侧 feature flag：块级渲染按 commit 协议独立开关（默认开）', () => {
    const rn = rnSrc('ChatTranscriptWebView.tsx');
    expect(rn).toContain('STREAM_BLOCK_RENDER_ENABLED = true');
    expect(rn).toContain('takeStreamBlockSplits');
    expect(rn).toContain('postStreamBlockSplits');
    // 块级化只切分不 post 的顺序约束（delta 先行，块提交随后）
    expect(rn).toMatch(
      /const blockSplits = takeStreamBlockSplits\(\);[\s\S]*?postStreamBlockSplits\(blockSplits\);/,
    );
    // abort overlay 全量物化口径：已提交块 parts + 活跃尾块
    expect(rn).toContain('streamCommittedTextPartsRef.current.join');
  });

  it('es2018 约束：stream 源码禁 lookbehind 等新正则特性', () => {
    const files = [
      stream(),
      streamMarkdown(),
      webSrc('chat-transcript/stream/block-split.ts'),
    ];
    for (const src of files) {
      expect(src).not.toContain('(?<');
      expect(src).not.toContain('\\p{');
      expect(src).not.toContain('s})'); // dotAll flag 无出现面
    }
  });

  it('显示态累积数组化：per-delta += 收敛为 parts push + 读点物化', () => {
    const src = stream();
    expect(src).toContain('streamDisplayParts[kind].push(delta)');
    expect(src).toContain('materializeStreamDisplay(kind)');
    // 一批物化一次（applyStreamBatch 收尾）
    expect(src).toMatch(
      /appendStreamDeltaCore\(seg\.kind, seg\.delta, html\);[\s\S]*?materializeStreamDisplay\('text'\);/,
    );
  });
});
