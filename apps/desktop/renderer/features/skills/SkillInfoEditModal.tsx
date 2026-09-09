/**
 * 编辑技能信息弹窗（重命名 + 描述编辑同一提交）。
 *
 * - 提交走 ipcSkillsUpdateInfo（core 单事务：目录迁移 + front matter 同步
 *   + 负清单迁移）；仅提交真正变更的字段。
 * - global 域内置技能名称框只读（core 侧 BUILTIN_SKILL_RENAME 双保险）；
 *   仅改描述对内置技能放行。
 * - invalid 技能入口由调用方禁用（core 侧跳过 front matter 重写双保险），
 *   本组件不处理 invalid 态。
 */
import { useEffect, useState } from "react";
import { BUILTIN_SKILL_NAMES } from "@shared/logic/skills";
import type { SkillRefDto } from "@shared/ipc-types";
import { ipcSkillsUpdateInfo } from "@/ipc/client";
import { isValidSkillNameInput, toSkillRef } from "./skill-ui";

type SkillInfoEditModalProps = {
  open: boolean;
  /** 待编辑技能（含域定位）。 */
  skillRef: SkillRefDto;
  currentName: string;
  currentDescription: string | null;
  onClose: () => void;
  /** 保存成功；参数为最新定位（可能已改名）。 */
  onSaved: (ref: SkillRefDto) => void;
};

export function SkillInfoEditModal({
  open,
  skillRef,
  currentName,
  currentDescription,
  onClose,
  onSaved,
}: SkillInfoEditModalProps) {
  const [name, setName] = useState(currentName);
  const [description, setDescription] = useState(currentDescription ?? "");
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  // 每次打开以当前值重置（技能切换/描述外部变更都跟随）
  useEffect(() => {
    if (open) {
      setName(currentName);
      setDescription(currentDescription ?? "");
      setError(undefined);
    }
  }, [open, currentName, currentDescription]);

  if (!open) {
    return null;
  }

  const builtin = skillRef.domain === "global" && BUILTIN_SKILL_NAMES.has(skillRef.name);
  const trimmedName = name.trim();
  const trimmedDesc = description.trim();
  const nameChanged = !builtin && trimmedName !== currentName;
  const descChanged = trimmedDesc !== (currentDescription ?? "");
  const canSubmit = !saving && (nameChanged || descChanged);

  const handleConfirm = async () => {
    if (!canSubmit) {
      return;
    }
    if (nameChanged && !isValidSkillNameInput(trimmedName)) {
      setError("技能名不能包含空格或斜杠，且不能以「.」开头。");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const res = await ipcSkillsUpdateInfo({
        domain: skillRef.domain,
        ...(skillRef.domain === "project" && skillRef.projectId != null
          ? { projectId: skillRef.projectId }
          : {}),
        name: skillRef.name,
        ...(nameChanged ? { newName: trimmedName } : {}),
        ...(descChanged ? { description: trimmedDesc } : {}),
      });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      onSaved(
        nameChanged
          ? toSkillRef(skillRef.domain, trimmedName, skillRef.projectId)
          : skillRef,
      );
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="text-prompt-overlay" onClick={onClose}>
      <div
        className="text-prompt-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-info-edit-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="skill-info-edit-title" className="text-prompt-modal__title">
          编辑信息
        </h3>
        <p className="text-prompt-modal__label">
          {builtin ? "技能名（内置技能不可改名）" : "技能名"}
        </p>
        <input
          className="text-prompt-modal__input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          readOnly={builtin}
          autoFocus
        />
        <p className="text-prompt-modal__label">描述（进入技能索引）</p>
        <textarea
          className="text-prompt-modal__input new-skill-modal__desc"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="模型会据此决定是否使用该技能"
        />
        {error ? <p className="new-skill-modal__error">{error}</p> : null}
        <div className="text-prompt-modal__actions">
          <button type="button" className="text-prompt-modal__btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="text-prompt-modal__btn text-prompt-modal__btn--primary"
            disabled={!canSubmit}
            onClick={() => void handleConfirm()}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
