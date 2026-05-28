/**
 * Default compaction: hide old messages + LLM summary.
 *
 * @module service/compaction/impl/default-compaction.service
 */

import { textBlocks } from "@/domain/chat/content/text-blocks.js";
import type { AgentSession } from "@/domain/agent/agent-session.port.js";
import { messageBodyText } from "@/domain/prompt/message-body.js";
import type { ConfigService } from "../../config/config.port.js";
import type { ModelRequestService } from "../../provider/model-request.port.js";
import type { CompactionService } from "../compaction.port.js";
import { estimateTokens } from "../token-estimate.js";

const COMPACTION_SUMMARY_PREFIX = "[Compaction summary]\n";

export interface DefaultCompactionServiceDeps {
  readonly config: ConfigService;
  readonly modelRequests: ModelRequestService;
}

/**
 * Hides older visible messages and inserts a summary when over token threshold.
 */
export class DefaultCompactionService implements CompactionService {
  constructor(private readonly deps: DefaultCompactionServiceDeps) {}

  async maybeCompact(
    session: AgentSession,
    applicationModelId: string,
  ): Promise<void> {
    const threshold = await this.deps.config.getNumber(
      "agent.compaction.thresholdTokens",
      12000,
    );
    const keepLastN = await this.deps.config.getNumber(
      "agent.compaction.keepLastN",
      6,
    );

    const messages = await session.list();
    if (estimateTokens(messages) <= threshold) {
      return;
    }

    if (messages.length <= keepLastN) {
      return;
    }

    const toHide = messages.slice(0, messages.length - keepLastN);
    if (toHide.length === 0) {
      return;
    }

    const fromSeq = toHide[0]!.seq;
    const toSeq = toHide[toHide.length - 1]!.seq;
    await session.hideRange(fromSeq, toSeq);

    const summaryInput = toHide
      .map((m) => `${m.role}: ${messageBodyText(m)}`)
      .join("\n\n");

    const result = await this.deps.modelRequests.request(
      applicationModelId,
      `Summarize the following conversation history concisely:\n\n${summaryInput}`,
      { stream: false },
    );

    // Compaction summary: role user, text prefix [Compaction summary]\n
    await session.append(
      "user",
      textBlocks(`${COMPACTION_SUMMARY_PREFIX}${result.assistantText}`),
    );
  }
}

/**
 * No-op compaction for tests or when compaction is disabled.
 */
export class NoOpCompactionService implements CompactionService {
  async maybeCompact(): Promise<void> {
    // compaction boundary: intentionally empty
  }
}
