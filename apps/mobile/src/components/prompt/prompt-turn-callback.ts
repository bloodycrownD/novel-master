/**
 * 提示词「轮详情」的正文传递（模块级单例）。
 *
 * 轮/叶子正文可达数百 KB（一轮里塞满 assistant 文本 + thinking + 工具结果），
 * 放进 React Navigation 路由参数会撑爆 "Non-serializable / huge params" 通道，
 * 因此正文不走路由：卡片在 navigate 前写入，
 * PromptTurnDetailScreen 挂载时读走（读后即清，防串台）。
 *
 * 形状照 components/agent/prompt-editor-callback.ts（同一范式：回调/载荷
 * 不走路由，标题这类可序列化的短文本仍走 params）。
 */

export type PromptTurnDetail = {
  /** 轮标题（首行摘要），供详情页 header 覆盖用。 */
  readonly title: string;
  /** 正文：整轮为各段按序拼接的轮 body；叶子级为该卡片的 body。 */
  readonly body: string;
  /**
   * 叶子级全屏时带上（文本卡 id / 工具组格的派生 id）；整轮全屏不带。
   * 详情页据此拼稳定伪 path（`turn-<turnId>-leaf-<leafId>`），
   * 让 WebView 在不同叶子之间切换时重挂载而不是复用上一份文档。
   */
  readonly leafId?: string;
};

let detail: PromptTurnDetail | null = null;

/** navigate 前写入当次载荷（每次打开详情都覆盖新载荷）。 */
export function setPromptTurnDetail(next: PromptTurnDetail) {
  detail = next;
}

/** 挂载时读取并清空：take 语义避免残留旧正文（未消费即离开则丢弃）。 */
export function takePromptTurnDetail(): PromptTurnDetail | null {
  const taken = detail;
  detail = null;
  return taken;
}