/**
 * B4：Desktop Composer 正文清空时机（对齐 Mobile 晚清）。
 * - `ipcAgentRun` started:true / ok → 禁止清正文（append 失败时可保留草稿）
 * - `nm:agent/userMessageAppended` 且同 session → 清正文
 */

/** started/ok 路径是否清正文。恒 false。 */
export function shouldClearComposerBodyAfterAgentStarted(): boolean {
  return false;
}

/**
 * append 推送后是否清 Composer UI（正文 + projected）。
 * 异会话仅清 annotate store（D1），不改当前输入框。
 */
export function shouldClearComposerBodyOnUserMessageAppended(
  payloadSessionId: string,
  viewingSessionId: string,
): boolean {
  return payloadSessionId === viewingSessionId;
}
