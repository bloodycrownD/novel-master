/**
 * 工具结果引用块的 view-time **极简兜底** hydrate（v1.5.30 unref 回迁版）。
 *
 * 背景：v1.5.29 曾把 read / skill 的 tool_result 改写成引用形态——
 * `content` 置占位空串、正文改存 `contentRef`（`(entryId, version)` +
 * contentHash + 分页派生参数），拼提示词前再按引用重放冻结 formatter 还原
 * wire 全文。本迭代把整个引用化机制**回迁**掉：写侧恒产全文
 * （`buildToolResultBlock` 成功分支直出 `formatToolOutputForLlm`），
 * 新消息不再有任何 `contentRef`。
 *
 * 但 v1.5.29 装机窗口写入的**存量行**还在库里：它们的 `content` 是空串，
 * 引用块的白名单解析（`parse-message-content.ts`）本版按纪律保留，于是这些行
 * 仍会被 parse 出来走到这里。若不管，prepare 后就是一批空 `tool_result`
 * 直接发给 LLM——这正是引用化当初要杜绝的事故。故本模块退化为**兜底**：
 * 按 `(entryId, version)` 取到明文，就地填一份 `{path, content}` 的 JSON 字符串
 * 回内存态 `content`；取不到就填错误占位 JSON（含 path 与原因）并
 * `console.warn`。**全程只改内存态，不写回 `content_json`**——落库回填是 B 线
 * 回迁任务（`message-ref-unref`）的职责，不在本模块。
 *
 * 与 v1.5.29 实现的取舍差异（有意为之，不是退化）：
 * - **不做 wire 重放**。旧实现复刻三个纯函数（read / skill read / skill load
 *   的截断管线）逐字节还原 wire；现在填的是 revision 明文 JSON 包，**与
 *   legacy wire 不等值**（无行号前缀、无 `Output truncated.` 提示、分页切片
 *   信息丢失）。这是可接受的——LLM 见到格式偏差会自行换算或重试，仓内也没有
 *   任何消费方在解析 wire 的行号格式（搜索只匹配 text 块、UI 卡片读 summary、
 *   token 计数只要全文）。
 * - **不再 fail-fast**。旧实现的四码（REPO_MISSING / REVISION_MISSING /
 *   CONTENT_DELETED / HASH_MISMATCH）会抛 `ReadResultHydrateError` 中断整个
 *   装配；现在一律降级为占位 JSON + warn。唯一保留的信号是 warn——其中
 *   **REPO_MISSING（revision 仓库未注入）刻意保留 warn**：那不是数据问题而是
 *   **装配缺口**（三端 runtime 忘了注入 `revisionRepo`），必须可观测。
 * - **hash 不匹配不算坏行**。`ref.contentHash` 与 revision 行的 `content_hash`
 *   不一致时，只要能取到明文就照常回填并 warn：内容寻址 hash 在本仓其余读
 *   路径上都不当强校验用，兜底路径更不该因它把整批装配打断。
 * - `files` 等派生字段（skill load 附属文件清单）、分页派生字段全部弃置：
 *   存量 ref 里虽然解析得出来，兜底路径没有消费方。
 *
 * 窄化口径统一为 `contentRef.kind === "skill"`，其余一律按 read 走——存量行
 * 无 `kind` 键，零迁移。legacy 块（无 contentRef）零处理。
 *
 * **顺序红线**：本函数必须早于 `normalizeOrphanToolResultsForLlm` 调用——
 * 未 hydrate 的空 content 会被孤儿拍平拍成 `[tool_result id=…]` 占位文本，
 * 那就再也补不回来了。接线点在
 * `prepare-user-messages-for-prompt.ts` 尾部（不要动那个顺序注释）。
 *
 * 退役计划：v1.5.29 存量行被 B 线回迁完成后，本文件连同 `contentRef` 三类型、
 * parse 白名单、desktop 占位分支一起删（见 spec「后续清理轮」）。
 *
 * @module domain/chat/logic/hydrate-tool-results-for-prompt
 */

import type { ContentBlock, ToolResultBlock } from "../model/content-block.js";
import type { ChatMessage } from "../model/message.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";

/** 兜底 hydrate 后缀：给 `[hydrate-tool-results-for-prompt]` warn 用。 */
const LOG_PREFIX = "[hydrate-tool-results-for-prompt]";

/**
 * 单次 {@link hydrateToolResultsForPrompt} 调用的明文去重缓存（调用内 Map）。
 *
 * 键 `${entryId}:${version}` → 已取到的 revision 明文。同一次装配里多个块
 * 引用同一 `(entryId, version)`（长文件分段 read 多次引用同一版是常态）时只
 * 查一次、只解一次 blob。
 *
 * 刻意**不做跨调用持久缓存**：缓存范围严格限定在「一次 prepare 装配内」，
 * 只省同批消息的重复解码。跨调用持久化会让已被 GC / mark-deleted 的 revision
 * 明文继续被发出去，掩盖真实状态。
 */
interface HydrateMemo {
  readonly plainByRefKey: Map<string, string | null>;
}

/** 存量引用块的定位标签（错误占位与 warn 文案用，兼作人工排查线索）。 */
function describeRef(block: ToolResultBlock): string {
  const ref = block.contentRef!;
  return ref.kind === "skill"
    ? `skill ${ref.action} 引用 ${ref.path} (entryId=${ref.entryId}, version=${ref.version})`
    : `read 引用 ${ref.path} (entryId=${ref.entryId}, version=${ref.version})`;
}

/**
 * 错误占位 JSON：让 LLM 拿到的是「这里本该有正文但取不到 + 为什么」的结构化
 * 说明，而不是空串或一段凭空捏的提示。`content` 仍是合法 JSON 字符串。
 */
function errorPlaceholderJson(
  path: string,
  reason: string
): string {
  return JSON.stringify({ path, error: reason });
}

/** 单个引用块的兜底 hydrate：查 revision 明文 → 填 `{path, content}` JSON 包。 */
async function hydrateReadResultBlock(
  block: ToolResultBlock,
  revisionRepo: VfsRevisionRepository | undefined,
  memo: HydrateMemo
): Promise<ToolResultBlock> {
  const ref = block.contentRef!;
  const label = describeRef(block);
  const refPath = ref.path;

  if (revisionRepo == null) {
    // 装配缺口（不是数据问题）：三端 runtime 应注入 revisionRepo。占位 +
    // warn，让问题在日志里显形而不是静默发占位正文。
    const reason =
      "runtime 未注入 revisionRepo（装配缺口）：v1.5.29 存量 contentRef 行无法取回明文";
    console.warn(`${LOG_PREFIX} ${label} ${reason}`);
    return { ...block, content: errorPlaceholderJson(refPath, reason) };
  }

  // 明文缓存键用 `(entryId, version)`：明文由 revision 行自己解
  // （行上的 content_hash → contentStore.get），与 ref 里记的 contentHash
  // 无关，故不进键。null 表示「查过但取不到」，同样缓存以免同批重复探测。
  const plainKey = `${ref.entryId}:${ref.version}`;
  let plain = memo.plainByRefKey.get(plainKey);
  if (plain === undefined) {
    // 元数据先行：status=deleted / 行缺失都靠它判，不解 blob。hash 只用来
    // warn（能取到就照常回填），不当强校验。
    let reason: string | null = null;
    try {
      const meta = await revisionRepo.findMetaByEntryAndVersion(
        ref.entryId,
        ref.version
      );
      if (meta == null) {
        reason = `revision 行缺失（entryId=${ref.entryId}, version=${ref.version}）：引用悬空，ref_count 保活链已被破坏或引用键被篡改`;
      } else if (meta.status === "deleted") {
        reason = `revision 已删除（entryId=${ref.entryId}, version=${ref.version}, status=deleted）：明文不可再生`;
      } else {
        const revision = await revisionRepo.findByEntryAndVersion(
          ref.entryId,
          ref.version
        );
        if (revision == null) {
          // 元数据命中后行被并发删 / GC 的兜底（与「revision 行缺失」同语义）。
          reason = `revision 行缺失（entryId=${ref.entryId}, version=${ref.version}）：元数据命中后行被并发删除或 GC`;
        } else if (revision.content == null) {
          // port 层兜底：实现若在 active 行上给不出明文（blob 缺失）同样归此。
          reason = `revision 明文不可取（entryId=${ref.entryId}, version=${ref.version}, status=${revision.status}）：blob 缺失或已清理`;
        } else {
          plain = revision.content;
          if (
            typeof ref.contentHash === "string" &&
            ref.contentHash !== "" &&
            meta.contentHash != null &&
            meta.contentHash !== ref.contentHash
          ) {
            // hash 不匹配不算坏行：能取到明文就回填，只留一条 warn 线索
            // （版本错位 / 引用键错配的可观测信号，不阻断装配）。
            console.warn(
              `${LOG_PREFIX} ${label} contentHash 与 revision 行不一致（期望=${ref.contentHash}，实际=${meta.contentHash}）：已按取到的明文回填`
            );
          }
        }
      }
    } catch (error) {
      // 仓库读取本身出错（DB 故障等）同样降级为占位 + warn：兜底路径的
      // 契约是「永不中断装配」。
      reason = `读取 revision 失败：${error instanceof Error ? error.message : String(error)}`;
    }
    if (reason != null) {
      console.warn(`${LOG_PREFIX} ${label} ${reason}`);
    }
    memo.plainByRefKey.set(plainKey, plain ?? null);
  }

  if (plain == null) {
    // 占位文案自包含：memo 命中 null 时本块不会走到上面的 warn（warn 可能
    // 属同批另一消息/另一 path 的首次探测），故不引用「上方 warn」。
    return {
      ...block,
      content: errorPlaceholderJson(
        refPath,
        `(entryId=${ref.entryId}, version=${ref.version}) 的明文取不回：该 revision 的正文在本次装配中不可用`
      ),
    };
  }

  // view-time：只填回内存态 content，contentRef 原样保留（块身份不变，
  // 不写回 content_json）。`kind: "skill"` 同款形态——files 等派生字段弃置。
  return {
    ...block,
    content: JSON.stringify({ path: refPath, content: plain }),
  };
}

function messageHasReadResultRef(message: ChatMessage): boolean {
  return message.content.blocks.some(
    (b) => b.type === "tool_result" && b.contentRef != null
  );
}

/**
 * 对消息数组里的存量引用块（tool_result + contentRef）做 view-time 兜底
 * hydrate：按 `(entryId, version)` 取 revision 明文，填回 `{path, content}`
 * 的 JSON 字符串（内存新对象，不变异入参、不写回 content_json）。
 *
 * 无引用块的消息原引用返回（legacy 零处理）；存在引用块但 `revisionRepo`
 * 未注入（装配缺口）或明文取不到时，填错误占位 JSON 并 `console.warn`——
 * 本函数**永不抛错**（v1.5.29 的 `ReadResultHydrateError` fail-fast 已退役）。
 *
 * 调用方必须在本函数返回后再做孤儿 tool_result 拍平，见文件头「顺序红线」。
 */
export async function hydrateToolResultsForPrompt(
  messages: readonly ChatMessage[],
  revisionRepo?: VfsRevisionRepository
): Promise<ChatMessage[]> {
  if (!messages.some(messageHasReadResultRef)) {
    return [...messages];
  }
  const memo: HydrateMemo = { plainByRefKey: new Map() };
  const out: ChatMessage[] = [];
  for (const message of messages) {
    if (!messageHasReadResultRef(message)) {
      out.push(message);
      continue;
    }
    const blocks: ContentBlock[] = [];
    for (const block of message.content.blocks) {
      blocks.push(
        block.type === "tool_result" && block.contentRef != null
          ? await hydrateReadResultBlock(block, revisionRepo, memo)
          : block
      );
    }
    out.push({ ...message, content: { blocks } });
  }
  return out;
}