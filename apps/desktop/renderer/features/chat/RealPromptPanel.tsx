import { useCallback, useEffect, useState } from "react";
import type { PromptPreviewSegmentDto } from "@shared/ipc-types";
import { PROMPT_REGION_LABELS } from "@shared/logic/config-forms-agent";
import { ipcPromptRealPreview } from "@/ipc/client";

interface RealPromptPanelProps {
  projectId: string;
  sessionId: string;
  visible: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  system: PROMPT_REGION_LABELS.system,
  user: "用户",
  assistant: "助手",
  tool: "工具结果",
  tool_call: "工具调用",
};

function segmentTitleLabel(title: string): string {
  if (title === "system") {
    return PROMPT_REGION_LABELS.system;
  }
  return title;
}

function previewLine(body: string): string {
  const line = body.replace(/\r\n/g, "\n").split("\n")[0]?.trim() ?? "";
  if (line.length === 0) {
    return "空内容";
  }
  if (line.length <= 72) {
    return line;
  }
  return `${line.slice(0, 69)}…`;
}

function collapsedHint(body: string): string {
  const charCount = body.length;
  const hint = charCount === 0 ? "空内容" : previewLine(body);
  const countSuffix = charCount > 0 ? ` · ${charCount} 字` : "";
  return `${hint}${countSuffix}`;
}

export function RealPromptPanel({
  projectId,
  sessionId,
  visible,
}: RealPromptPanelProps) {
  const [segments, setSegments] = useState<PromptPreviewSegmentDto[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const result = await ipcPromptRealPreview({ projectId, sessionId });
    if (result.ok) {
      setSegments(result.data);
    }
  }, [projectId, sessionId]);

  useEffect(() => {
    if (visible) {
      void load();
    }
  }, [visible, load]);

  if (!visible) {
    return null;
  }

  return (
    <div className="real-prompt-list" id="real-prompt-list">
      {segments.map((segment) => {
        const open = expanded[segment.id] ?? false;
        const roleLabel = ROLE_LABELS[segment.role] ?? segment.role;
        return (
          <div
            key={segment.id}
            className={`prompt-segment${open ? " is-expanded" : ""}`}
            data-segment-id={segment.id}
          >
            <button
              type="button"
              className="prompt-segment__header"
              aria-expanded={open}
              onClick={() =>
                setExpanded((prev) => ({ ...prev, [segment.id]: !open }))
              }
            >
              <span className="prompt-segment__text">
                <span className="prompt-segment__role">{roleLabel}</span>
                <span className="prompt-segment__title">
                  {segmentTitleLabel(segment.title)}
                </span>
                <span className="prompt-segment__preview">
                  {collapsedHint(segment.body)}
                </span>
              </span>
              <span className="prompt-segment__chevron" aria-hidden="true">
                {open ? "▼" : "▶"}
              </span>
            </button>
            <pre className="prompt-segment__body">{segment.body || "（空）"}</pre>
          </div>
        );
      })}
      <p className="real-prompt-hint">
        在会话工作区调整纳入规则可改变预览内容。默认折叠以减轻长文本渲染压力。
      </p>
    </div>
  );
}
