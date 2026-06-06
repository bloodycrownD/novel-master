import { useCallback, useEffect, useState } from "react";
import type { PromptPreviewSegmentDto } from "../../../shared/ipc-types";
import { ipcPromptRealPreview } from "../../ipc/client";

interface RealPromptPanelProps {
  projectId: string;
  sessionId: string;
  visible: boolean;
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
        return (
          <div key={segment.id} className="prompt-segment" data-segment-id={segment.id}>
            <button
              type="button"
              className="prompt-segment__header"
              aria-expanded={open}
              onClick={() =>
                setExpanded((prev) => ({ ...prev, [segment.id]: !open }))
              }
            >
              <span className="prompt-segment__text">
                <span className="prompt-segment__role">{segment.role}</span>
                <span className="prompt-segment__title">{segment.title}</span>
              </span>
              <span className="prompt-segment__chevron" aria-hidden="true">
                {open ? "▼" : "▶"}
              </span>
            </button>
            {open ? (
              <pre className="prompt-segment__body">
                {segment.body || "（空）"}
              </pre>
            ) : null}
          </div>
        );
      })}
      <p className="real-prompt-hint">
        在会话工作区调整纳入规则可改变预览内容。默认折叠以减轻长文本渲染压力。
      </p>
    </div>
  );
}
