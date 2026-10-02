/**
 * 提示词「轮详情」的正文传递（模块级单例）。
 *
 * 轮 body 可达数百 KB（一轮里塞满 assistant 文本 + thinking + 工具结果），
 * 放进 React Navigation 路由参数会撑爆 "Non-serializable / huge params" 通道，
 * 因此正文不走路由：PromptTurnCard 在 navigate 前写入，
 * PromptTurnDetailScreen 挂载时读走（读后即清，防串台）。
 *
 * 形状照 components/agent/prompt-editor-callback.ts（同一范式：回调/载荷
 * 不走路由，标题这类可序列化的短文本仍走 params）。
 */

export type PromptTurnDetail = {
  /** 轮标题（首行摘要），供详情页 header 覆盖用。 */
  readonly title: string;
  /** 轮正文：各段按序拼接，段前带角色前缀行。 */
  readonly body: string;
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