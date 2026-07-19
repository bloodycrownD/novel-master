/**
 * PreviewPane 划词批注：浮动条 + 添加/详情改删弹层。
 */

import { useEffect, useState } from "react";
import type { AnnotateDraft } from "@novel-master/core/chat";
import { Button } from "../components/ui/Button";
import { TextPromptModal } from "../components/ui/TextPromptModal";
import {
  addChatAnnotateDraft,
  removeChatAnnotateDraft,
  updateChatAnnotateDraft,
} from "../features/chat/chat-annotate-draft";
import { randomUUID } from "../shims/node-crypto";

type FloatingBarProps = {
  readonly top: number;
  readonly left: number;
  readonly onAdd: () => void;
};

export function PreviewAnnotateFloatingBar({
  top,
  left,
  onAdd,
}: FloatingBarProps) {
  return (
    <div
      className="preview-annotate-floating"
      style={{ top, left }}
      role="toolbar"
      aria-label="批注操作"
    >
      <button
        type="button"
        className="preview-annotate-floating__btn"
        onMouseDown={(e) => {
          // 避免 mousedown 清掉选区
          e.preventDefault();
        }}
        onClick={onAdd}
      >
        添加批注
      </button>
    </div>
  );
}

type AddModalProps = {
  readonly open: boolean;
  readonly selectedText: string;
  readonly sessionId: string;
  readonly filePath: string;
  readonly onClose: () => void;
};

export function PreviewAnnotateAddModal({
  open,
  selectedText,
  sessionId,
  filePath,
  onClose,
}: AddModalProps) {
  return (
    <TextPromptModal
      open={open}
      title="添加批注"
      label={selectedText.length > 80 ? `${selectedText.slice(0, 80)}…` : selectedText}
      placeholder="输入批注说明"
      confirmLabel="添加"
      onClose={onClose}
      onConfirm={(userAnnotation) => {
        addChatAnnotateDraft(sessionId, {
          id: randomUUID(),
          path: filePath,
          originalText: selectedText,
          userAnnotation,
        });
      }}
    />
  );
}

type DetailModalProps = {
  readonly open: boolean;
  readonly draft: AnnotateDraft | null;
  readonly sessionId: string;
  readonly onClose: () => void;
};

export function PreviewAnnotateDetailModal({
  open,
  draft,
  sessionId,
  onClose,
}: DetailModalProps) {
  const [value, setValue] = useState(draft?.userAnnotation ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && draft != null) {
      setValue(draft.userAnnotation);
    }
  }, [open, draft]);

  if (!open || draft == null) {
    return null;
  }

  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && !saving;

  const handleSave = () => {
    if (!canSave) {
      return;
    }
    setSaving(true);
    try {
      updateChatAnnotateDraft(sessionId, draft.id, {
        userAnnotation: trimmed,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    removeChatAnnotateDraft(sessionId, draft.id);
    onClose();
  };

  return (
    <div className="text-prompt-overlay" onClick={onClose}>
      <div
        className="text-prompt-modal text-prompt-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-annotate-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="preview-annotate-detail-title"
          className="text-prompt-modal__title"
        >
          批注详情
        </h3>
        <p className="text-prompt-modal__label preview-annotate-detail__quote">
          {draft.originalText}
        </p>
        <textarea
          className="text-prompt-modal__textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="批注说明"
          rows={4}
          autoFocus
        />
        <div className="confirm-modal__actions">
          <Button variant="danger" disabled={saving} onClick={handleDelete}>
            删除
          </Button>
          <div className="preview-annotate-detail__spacer" />
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={handleSave}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}

type PickModalProps = {
  readonly open: boolean;
  readonly drafts: readonly AnnotateDraft[];
  readonly onPick: (draft: AnnotateDraft) => void;
  readonly onClose: () => void;
};

/** 同文多条批注时先选一条再打开详情。 */
export function PreviewAnnotatePickModal({
  open,
  drafts,
  onPick,
  onClose,
}: PickModalProps) {
  if (!open) {
    return null;
  }
  return (
    <div className="text-prompt-overlay" onClick={onClose}>
      <div
        className="text-prompt-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-annotate-pick-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="preview-annotate-pick-title"
          className="text-prompt-modal__title"
        >
          选择批注
        </h3>
        <ul className="preview-annotate-pick-list">
          {drafts.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className="preview-annotate-pick-list__item"
                onClick={() => onPick(d)}
              >
                {d.userAnnotation || "（空说明）"}
              </button>
            </li>
          ))}
        </ul>
        <div className="text-prompt-modal__actions">
          <button
            type="button"
            className="text-prompt-modal__btn"
            onClick={onClose}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
