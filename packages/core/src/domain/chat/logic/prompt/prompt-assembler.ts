/**
 * 异步 hydrate + wrap 用户消息附件；LLM / 预览 / token 的唯一拼装入口。
 *
 * 按可见序共享「已出现路径」：常驻前缀 S0 → attach → workplace（历史只读兼容）；user_ops 不参与。
 * 文件 attach 非首次 → alreadyReferenced 短提示；workplace 非首次 → content 空；目录每次拼树仍计 seen。
 *
 * S0 是**两个**集合（spec G6 双读）：`seenPaths` 只收 full 档（attach 去重初值），
 * `workplaceSeenPaths` 收全量可见档（workplace 省略判定，缺省回落 `seenPaths`）。
 * 后者只在 workplace 判定里被读、从不写共享 `seen`，故 attach 抢先与跨消息抑制
 * 的运行期语义分毫未动。
 * skillAttach（`$技能名`）走 `skill:{name}` 命名空间 seen：首次读生效副本 SKILL.md 全文
 * （跨域读不经 session file_cache，直接 SkillService）；不存在 → 一行提示且不写 seen（自愈）；
 * 常驻索引不计入「已出现」，被压缩/置位重置随可见窗口自动继承。
 * 增量统一为 `<action name="userAttach|workplaceChange|…">` + JSON（行号正文；无 mtime/createdAt）。
 * `runtime.extraInfo`（来自 agent 配置 customAttach）非空时，仅对本次请求里最新一条
 * 非隐藏 user 输入消息生效——wrap 阶段在 `</user-ops>` 后注入 `<extra-info>` 纯文本块；
 * 历史 user 消息不再注入（与 dynamic 区 once 语义不同，独立实现）。
 *
 * @module domain/chat/logic/prompt/prompt-assembler
 */

import type {WorkplaceService} from "@/service/workplace/workplace.port.js";
import {expandDynamicMacros} from "@/domain/prompt/logic/expand-dynamic-macros.js";
import {attachmentScanner} from "../attachment/attachment-scanner.js";
import {promptPathSeen} from "../attachment/prompt-path-seen.js";
import {ChatMessage} from "../message/chat-message.js";
import type {ChatMessageData} from "../../model/message.js";
import {AttachBudget} from "../attachment/attach-budget.js";
import {AttachmentHydrator, type AttachmentHydratorRuntime} from "./attachment-hydrator.js";

/** 与 `domain/tool/builtin/skill-tool.ts` 注册名同字符串（方向 B 扫描用）。 */
const SKILL_TOOL_NAME = "skill";

/** {@link promptAssembler.prepare} 运行时依赖与可选初始 seen。 */
interface PrepareUserMessagesForPromptRuntime extends AttachmentHydratorRuntime {
    /**
     * 常驻前缀 path 集合 S0（已或未规范化均可）；prepare 内再规范化后写入 seen。
     * 通常来自 `assembleWorkplaceDisplay().prefixPaths`。
     *
     * v1.5.30 起**只收 `status === "full"` 的条目**（assemble 侧已收窄）——只有真正
     * 全文注入提示词的路径才有资格抑制 attach 的全文。
     */
    readonly seenPaths?: readonly string[];
    /**
     * 工作区「已展示」path 集合（通常来自 `assembleWorkplaceDisplay().visiblePaths`，
     * 含 full / header / filename 三档）。
     *
     * 只喂 workplace 的**省略判定**，且**不写入共享 `seen`**——共享 seen 的运行期语义
     * （attach 抢先、跨消息抑制）完全不动。缺省回落 {@link seenPaths}。
     */
    readonly workplaceSeenPaths?: readonly string[];
    /** 宏展开所需的当前时间（默认取 new Date()）。 */
    readonly now?: Date;
    /** 宏展开所需的 workplace 服务（用于 $filetree 实时渲染）。 */
    readonly workplace?: WorkplaceService;
    /** 回合快照的 `{{$filetree}}` 预渲染结果；传入时优先于实时渲染。 */
    readonly filetree?: string;
}

/** 用户消息附件拼装入口。 */
class PromptAssembler {
    async prepare(messages: readonly ChatMessageData[], runtime: PrepareUserMessagesForPromptRuntime): Promise<ChatMessageData[]> {
        const seen = promptPathSeen.createSet(runtime.seenPaths);
        const attachBudget = new AttachBudget();
        const workplaceSeen = promptPathSeen.createSet(runtime.workplaceSeenPaths ?? runtime.seenPaths);
        // 可见历史里 assistant 已通过 skill 工具 load 过的技能预填 seen：
        // load 的全文以 tool_result 留在可见历史，后续 `$` 引用走短提示。
        for (const message of messages) {
            if (message.role !== "assistant" || message.hidden) continue;
            for (const block of message.content.blocks) {
                if (block.type !== "tool_use" || block.name !== SKILL_TOOL_NAME) continue;
                if (block.input?.action === "load" && typeof block.input?.name === "string" && block.input.name !== "") {
                    seen.add(attachmentScanner.skillKey(block.input.name));
                }
            }
        }
        // customAttach 宏每轮展开一次，同一轮所有 user 消息复用同一份文本。
        const extraInfoRaw = runtime.extraInfo;
        const hasExtraInfo = typeof extraInfoRaw === "string" && extraInfoRaw.trim().length > 0;
        const macroContext = {now: runtime.now, workplace: runtime.workplace, filetree: runtime.filetree};
        const extraInfoResolved = hasExtraInfo ? await expandDynamicMacros(extraInfoRaw, macroContext) : undefined;
        if (extraInfoResolved !== undefined && !extraInfoResolved.ok) {
            throw extraInfoResolved.error;
        }
        const resolvedRuntime = extraInfoResolved === undefined ? runtime : {...runtime, extraInfo: extraInfoResolved.value};
        // extra info 只对最新一条非隐藏 user 输入消息生效。
        let latestUserInputIndex = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages[i]!;
            if (message.role === "user" && !message.hidden && ChatMessage.from(message).isUserInput()) {
                latestUserInputIndex = i;
                break;
            }
        }
        const hydrator = new AttachmentHydrator(resolvedRuntime, seen, workplaceSeen, attachBudget);

        const out: ChatMessageData[] = [];
        for (let i = 0; i < messages.length; i++) {
            const message = messages[i]!;
            if (message.role !== "user") {
                out.push(message);
                continue;
            }
            // tool_result 等非用户输入的 user 消息直接透传；wrap 会拍平 block 导致 tool 配对错误。
            if (!ChatMessage.from(message).isUserInput()) {
                out.push(message);
                continue;
            }
            out.push(await hydrator.hydrateMessage(message, i === latestUserInputIndex));
        }
        return out;
    }
}

export const promptAssembler = new PromptAssembler();
