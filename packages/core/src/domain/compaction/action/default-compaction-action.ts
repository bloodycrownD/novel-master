/**
 * Default compaction action: hide range + text/agent abstract + session summary.
 *
 * @module domain/compaction/action/default-compaction-action
 */

import { textBlocks } from "@/domain/chat/content/text-blocks.js";
import { messageBodyText } from "@/domain/prompt/message-body.js";
import { formatLocalDateTime } from "@/infra/date-format.js";
import { renderMacro } from "@/infra/prompt-template/macro-render.js";
import { formatWeekCn } from "@/infra/prompt-template/week-cn.js";
import { resolveSummaryApplicationModelId } from "@/domain/agent/resolve-application-model-id.js";
import type {
  CompactionAction,
  CompactionActionResult,
} from "../compaction-action.port.js";
import type { CompactionContext } from "../compaction-context.js";

const COMPACTION_SUMMARY_PREFIX = "[Compaction summary]\n";
const DEFAULT_AGENT_INSTRUCTION =
  "Summarize the following conversation history concisely:";

/**
 * Hides older visible messages, fills dot.abstract, and appends summary user message.
 */
export class DefaultCompactionAction implements CompactionAction {
  async execute(ctx: CompactionContext): Promise<CompactionActionResult> {
    const { session, policy } = ctx;
    const action = policy.action;

    const visible = await session.list();
    const keepLastN = action.keepLastN;

    if (visible.length <= keepLastN) {
      return { abstract: "" };
    }

    const toHide = visible.slice(0, visible.length - keepLastN);
    if (toHide.length === 0) {
      return { abstract: "" };
    }

    const fromSeq = toHide[0]!.seq;
    const toSeq = toHide[toHide.length - 1]!.seq;
    await session.hideRange(fromSeq, toSeq);

    const now = ctx.now ?? new Date();
    const dotForMacro = { worktree: ctx.worktreeDisplay };
    const root = {
      time: formatLocalDateTime(now),
      week_cn: formatWeekCn(now),
    };

    let abstractText: string;
    const abstractCfg = action.abstract;

    if (abstractCfg.type === "text") {
      abstractText = renderMacro(abstractCfg.content, {
        dot: dotForMacro,
        root,
        optionalDotFields: ["abstract"],
      });
    } else {
      const summaryDef = await ctx.resolveAgent.resolve(abstractCfg.agentId);
      const summaryInput = toHide
        .map((m) => `${m.role}: ${messageBodyText(m)}`)
        .join("\n\n");
      const instruction =
        abstractCfg.instruction ?? DEFAULT_AGENT_INSTRUCTION;
      const summaryModelId = resolveSummaryApplicationModelId({
        cliModelId: ctx.modelContext.cliModelId,
        summaryModelId: summaryDef.model,
        workspaceModelId: ctx.modelContext.workspaceModelId,
      });
      const result = await ctx.modelRequests.request(
        summaryModelId,
        `${instruction}\n\n${summaryInput}`,
        {
          stream: false,
          tools: undefined,
        },
      );
      abstractText = result.assistantText;
    }

    await session.append(
      "user",
      textBlocks(`${COMPACTION_SUMMARY_PREFIX}${abstractText}`),
    );

    return { abstract: abstractText };
  }
}
