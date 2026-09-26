/**
 * chat-transcript webview 能力协商标识（单一事实来源，双端共用，B-2）。
 *
 * 口径：webview 在 ready 上报 `capabilities` 数组，RN 侧据此启用对应渲染
 * 路径（默认用能力声明而非版本号字符串，版本号仅作辅助信息）。未声明的
 * 能力一律按「不支持」处理——旧 dist 缺块级渲染能力时 RN 退回全量
 * streamDelta，不再静默丢弃 streamBlockCommit 导致「流中只剩尾块」。
 *
 * 约束：纯常量 + 纯函数零依赖（RN 侧与 webview 侧同时 import，禁止 DOM /
 * Preact / @web 别名依赖），es2018 安全。
 */

/** 块级渲染能力：webview 支持 streamBlockCommit（完成块 append + 尾块重置）。 */
export const TRANSCRIPT_CAPABILITY_STREAM_BLOCK_COMMIT = 'streamBlockCommit';

/** 当前 webview 实现声明的能力清单（ready 上报的真实来源）。 */
export const TRANSCRIPT_CAPABILITIES: readonly string[] = [
  TRANSCRIPT_CAPABILITY_STREAM_BLOCK_COMMIT,
];

/**
 * 能力清单判定：缺省 / 非数组 / 未命中一律视为未声明。
 * 用显式循环而非 Array.prototype.includes，避免老 WebView 内核差异。
 */
export function transcriptCapabilitiesInclude(
  capabilities: readonly string[] | undefined | null,
  target: string,
): boolean {
  if (!capabilities) {
    return false;
  }
  for (let i = 0; i < capabilities.length; i++) {
    if (capabilities[i] === target) {
      return true;
    }
  }
  return false;
}
