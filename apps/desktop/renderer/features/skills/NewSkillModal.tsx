/**
 * 新建技能弹窗：技能名 + 描述 + 存储域分段（全局/项目）+ 项目下拉。
 *
 * 创建即写仅含 SKILL.md 的技能目录（front matter 自动填 name/description），
 * 成功后回调 `onCreated`（调用方负责直达技能详情页）。
 * 会话技能面板（默认项目域）与设置·技能管理页（预选当前 tab 域）共用。
 */
import { useEffect, useState } from "react";
import type { ProjectDto, SkillDomainDto, SkillRefDto } from "@shared/ipc-types";
import { ipcSkillsList, ipcSkillsWrite } from "@/ipc/client";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { buildNewSkillDoc, isValidSkillNameInput, toSkillRef } from "./skill-ui";

type NewSkillModalProps = {
  open: boolean;
  /** 打开时预选的域；会话面板传 'project'，管理页随当前 tab。 */
  defaultDomain?: SkillDomainDto;
  /** 域为项目时的默认项目。 */
  defaultProjectId?: string;
  projects: readonly ProjectDto[];
  onClose: () => void;
  onCreated: (ref: SkillRefDto) => void;
};

export function NewSkillModal({
  open,
  defaultDomain = "project",
  defaultProjectId,
  projects,
  onClose,
  onCreated,
}: NewSkillModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [domain, setDomain] = useState<SkillDomainDto>(defaultDomain);
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? "");
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setDomain(defaultDomain);
      setProjectId(defaultProjectId ?? projects[0]?.id ?? "");
      setError(undefined);
    }
  }, [open, defaultDomain, defaultProjectId, projects]);

  if (!open) {
    return null;
  }

  const trimmedName = name.trim();
  const trimmedDesc = description.trim();
  const canSubmit =
    !saving && trimmedName.length > 0 && trimmedDesc.length > 0;

  const handleConfirm = async () => {
    if (!canSubmit) {
      return;
    }
    if (!isValidSkillNameInput(trimmedName)) {
      setError("技能名不能包含空格或斜杠，且不能以「.」开头。");
      return;
    }
    if (domain === "project" && !projectId) {
      setError("请选择所属项目。");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      // 域内查重（后端也会拒，但这里先给出行级报错）
      const listRes = await ipcSkillsList(
        domain === "global"
          ? { domain }
          : { domain, projectId },
      );
      if (listRes.ok) {
        if (listRes.data.some((s) => s.name === trimmedName)) {
          setError(
            domain === "global"
              ? "全局域已存在同名技能。"
              : "该项目已存在同名技能。",
          );
          return;
        }
      }
      const res = await ipcSkillsWrite({
        domain,
        ...(domain === "project" ? { projectId } : {}),
        name: trimmedName,
        content: buildNewSkillDoc(trimmedName, trimmedDesc),
      });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      onCreated(toSkillRef(domain, trimmedName, projectId));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="text-prompt-overlay" onClick={onClose}>
      <div
        className="text-prompt-modal text-prompt-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-skill-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="new-skill-title" className="text-prompt-modal__title">
          新建技能
        </h3>
        <p className="text-prompt-modal__label">技能名（创建后不可改）</p>
        <input
          className="text-prompt-modal__input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如 lore-style-guide"
          autoFocus
        />
        <p className="text-prompt-modal__label">描述（进入技能索引，必填）</p>
        <textarea
          className="text-prompt-modal__input new-skill-modal__desc"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="模型会据此决定是否使用该技能"
        />
        <p className="text-prompt-modal__label">存储域</p>
        <SegmentedControl
          aria-label="存储域"
          value={domain}
          options={[
            { value: "global", label: "全局（所有项目）" },
            { value: "project", label: "项目" },
          ]}
          onChange={(next) => setDomain(next as SkillDomainDto)}
        />
        {domain === "project" ? (
          <>
            <p className="text-prompt-modal__label">所属项目</p>
            <select
              className="text-prompt-modal__input"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {projects.length === 0 ? <option value="">（暂无项目）</option> : null}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
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
            {saving ? "创建中…" : "创建并编辑"}
          </button>
        </div>
      </div>
    </div>
  );
}
