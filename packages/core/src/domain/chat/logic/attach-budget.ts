/**
 * 附件明文体积预算与降级文案的**单源常量 / 累加器**。
 *
 * v1.5.31 起预算与降级统一收敛在 prepare 链（core 唯一来源）：主会话与子会话的
 * agent-runner 每 step 跑同一个 `prepareUserMessagesForPrompt`，预算天然同口径，
 * 提示词预览 / token 估算也共用它。此前子会话派发侧（`subagent-tool.ts`）自带的
 * 「条数 + 探测字节」双预算软闸整体退役。
 *
 * 计量口径：**原始明文 length**（不含行号前缀等渲染开销）——降级判据要稳定可解释，
 * 不受展示档位影响；image / binary / dir 不计字符（没有可注明的正文）。
 *
 * @module domain/chat/logic/attach-budget
 */

/** 单次拼装内文本附件明文的合计上限（明文当量字符）。 */
export const ATTACH_PROMPT_CHAR_BUDGET = 100_000;

/** 超预算附件的降级正文：不再送全文，引导模型用 `read` 分段取。 */
export const OVERSIZED_ATTACH_NOTE =
  "文件过长，可用 read 配合 offset/limit 分段读取";

/** image / binary 附件（filename 档）的正文占位文案——不提供正文。 */
export const BINARY_ATTACH_NOTE = "二进制文件，不提供正文";

/** 预算累加器（单次拼装一份，与 `seen` 同级作用域）。 */
export interface AttachBudget {
  /** 已计入的明文字符数。 */
  readonly used: number;
  /**
   * 尝试计入 `chars`：计入后**恰好等于**预算仍算通过（边界不降级）；
   * 超预算则不改动并返回 false，调用方据此走降级出口。
   */
  tryConsume(chars: number): boolean;
}

/** 新建一份预算累加器（上限 {@link ATTACH_PROMPT_CHAR_BUDGET}）。 */
export function createAttachBudget(
  limit: number = ATTACH_PROMPT_CHAR_BUDGET
): AttachBudget {
  let used = 0;
  return {
    get used(): number {
      return used;
    },
    tryConsume(chars: number): boolean {
      const next = used + Math.max(0, chars);
      if (next > limit) {
        return false;
      }
      used = next;
      return true;
    },
  };
}