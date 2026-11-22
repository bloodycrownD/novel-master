/**
 * 新建技能弹窗：手进模板或从 ZIP 导入预填（技能名 + 描述 + 存储域分段 + 项目下拉）。
 *
 * 导入 = 选 zip（本产品导出格式：根即技能目录）→ 预填 name/description
 * （可改）→ 创建时 zip 内全部文件落入新技能目录，SKILL.md 的 front
 * matter 以表单最终值为准重写（表单未改则不重写）。手进创建 = 向目标
 * 域写仅含 SKILL.md 的新目录。
 * 会话技能面板（默认项目域）与设置·技能管理页（预选当前 tab 域）共用。
 */
import { useEffect, useState } from "react";
import {
    SkillZip,
    validateSkillName,
    type SkillZipPreview,
} from "@shared/logic/skills";
import type { ProjectDto, SkillDomainDto, SkillRefDto } from "@shared/ipc-types";
import { SkillFrontMatterValues } from "@shared/logic/skills";
import {
    ipcSkillsAssertCreateName,
    ipcSkillsList,
    ipcSkillsWrite,
    ipcVfsZipImportBytes,
    ipcVfsZipPick,
} from "@/ipc/client";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { coreT } from "@shared/logic/core-i18n";
import { NewSkillDoc, toSkillRef } from "./skill-ui";

/** 导入态：zip 字节（创建时落盘）+ 预检结果（预填与 front matter 重写判定）。 */
type ImportedSkill = {
    readonly bytes: Uint8Array;
    readonly preview: SkillZipPreview;
};

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
    const [importing, setImporting] = useState(false);
    const [imported, setImported] = useState<ImportedSkill | null>(null);

    useEffect(() => {
        if (open) {
            setName("");
            setDescription("");
            setDomain(defaultDomain);
            setProjectId(defaultProjectId ?? projects[0]?.id ?? "");
            setError(undefined);
            setImported(null);
        }
    }, [open, defaultDomain, defaultProjectId, projects]);

    if (!open) {
        return null;
    }

    const trimmedName = name.trim();
    const trimmedDesc = description.trim();
    const canSubmit = !saving && trimmedName.length > 0 && trimmedDesc.length > 0;

    /** 选 zip → 预检 → 预填 name/description（可改）；取消选择不动表单。 */
    const handleImport = async () => {
        if (importing) {
            return;
        }
        setImporting(true);
        setError(undefined);
        try {
            const pickRes = await ipcVfsZipPick();
            if (!pickRes.ok) {
                setError(pickRes.error.message);
                return;
            }
            if (pickRes.data == null) {
                return;
            }
            const previewResult = SkillZip.preview(pickRes.data);
            if (!previewResult.ok) {
                setError(previewResult.error.message);
                return;
            }
            const preview = previewResult.value;
            if (preview.skillMd == null) {
                setError(coreT({key: "ui.skills.zip_root_missing"}));
                return;
            }
            setImported({ bytes: pickRes.data, preview });
            setName(preview.name ?? "");
            setDescription(preview.description ?? "");
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setImporting(false);
        }
    };

    const handleConfirm = async () => {
        if (!canSubmit) {
            return;
        }
        // 技能名输入校验：消费 core validateSkillName（与 SkillInfoEditModal 同源，
        // 空白/斜杠/「.」开头/保留名全口径 per-case reason，coreT 直出文案）。
        const nameIssue = validateSkillName(trimmedName);
        if (nameIssue != null) {
            setError(nameIssue);
            return;
        }
        if (domain === "project" && !projectId) {
            setError(coreT({key: "ui.skills.project_required"}));
            return;
        }
        setSaving(true);
        setError(undefined);
        try {
            // 域内查重（后端也会拒，但这里先给出行级报错）
            const listRes = await ipcSkillsList( domain === "global" ? { domain } : { domain, projectId } );
            if (listRes.ok) {
                if (listRes.data.some((s) => s.name === trimmedName)) {
                    setError(coreT({key: "ui.skills.domain_name_conflict", params: {name: trimmedName}}));
                    return;
                }
            }
            if (imported != null) {
                // ZIP 是第二条新建通道（不经 writeSkillFile 的 D2② 门）：落盘前
                // 先过保留名校验，拒绝时不落盘（CR D-1）。
                const assertRes = await ipcSkillsAssertCreateName({
                    domain,
                    ...(domain === "project" ? { projectId } : {}),
                    name: trimmedName,
                });
                if (!assertRes.ok) {
                    setError(assertRes.error.message);
                    return;
                }
                // 导入创建：zip 内全部文件落入新技能目录（目录新建为空，无覆盖风险），
                // 表单值与 zip 元数据不一致时重写 SKILL.md front matter（保留正文）。
                // 技能已重定位到独立 meta 域，导入走 meta 域 workspaceScope。
                const importRes = await ipcVfsZipImportBytes({
                    workspaceScope:
                        domain === "global" ? "global-meta" : "project-meta",
                    ...(domain === "project" ? { projectId } : {}),
                    bytes: imported.bytes,
                    confirmed: true,
                    directoryPath: `/meta/skills/${trimmedName}`,
                });
                if (!importRes.ok) {
                    setError(importRes.error.message);
                    return;
                }
                if (
                    imported.preview.name !== trimmedName ||
                    imported.preview.description !== trimmedDesc
                ) {
                    // 重写目标是刚导入落盘的 SKILL.md（已存在文件）：写入统一
                    // last-write-wins，直接覆盖即可（旧版本校验链路已随 last-write-wins 一并清理）。
                    const rewriteRes = await ipcSkillsWrite({
                        domain,
                        ...(domain === "project" ? { projectId } : {}),
                        name: trimmedName,
                        content: SkillFrontMatterValues.rewrite(imported.preview.skillMd!, {
                            name: trimmedName,
                            description: trimmedDesc,
                        }),
                    });
                    if (!rewriteRes.ok) {
                        setError(rewriteRes.error.message);
                        return;
                    }
                }
            } else {
                const res = await ipcSkillsWrite({
                    domain,
                    ...(domain === "project" ? { projectId } : {}),
                    name: trimmedName,
                    content: NewSkillDoc.build(trimmedName, trimmedDesc),
                });
                if (!res.ok) {
                    setError(res.error.message);
                    return;
                }
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
                    {coreT({key: "ui.skills.new_title"})}
                </h3>
                {imported != null ? (
                    <div className="new-skill-modal__import-row">
                        <span className="new-skill-modal__import-info">{coreT({key: "ui.skills.zip_imported_info", params: {count: imported.preview.fileCount}})}</span>
                        <button
                            type="button"
                            className="new-skill-modal__import-clear"
                            onClick={() => setImported(null)}
                        >
                            {coreT({key: "ui.common.remove"})}
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        className="new-skill-modal__import-btn"
                        disabled={importing}
                        onClick={() => void handleImport()}
                    >
                        {importing ? coreT({key: "ui.skills.reading_zip"}) : coreT({key: "ui.skills.importing_zip"})}
                    </button>
                )}
                <p className="text-prompt-modal__label">{coreT({key: "ui.skills.name_label_manage_hint"})}</p>
                <input
                    className="text-prompt-modal__input"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={coreT({key: "ui.skills.name_example_desktop"})}
                    autoFocus
                />
                <p className="text-prompt-modal__label">{coreT({key: "ui.skills.desc_required_label"})}</p>
                <textarea
                    className="text-prompt-modal__input new-skill-modal__desc"
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={coreT({key: "ui.skills.desc_hint_desktop"})}
                />
                <p className="text-prompt-modal__label">{coreT({key: "ui.skills.domain_label"})}</p>
                <SegmentedControl
                    aria-label={coreT({key: "ui.skills.domain_label"})}
                    value={domain}
                    options={[
                        { value: "global", label: coreT({key: "ui.skills.domain_global"}) },
                        { value: "project", label: coreT({key: "ui.skills.domain_project"}) },
                    ]}
                    onChange={(next) => setDomain(next as SkillDomainDto)}
                />
                {domain === "project" ? (
                    <>
                        <p className="text-prompt-modal__label">{coreT({key: "ui.skills.project_label"})}</p>
                        <select
                            className="text-prompt-modal__input"
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                        >
                            {projects.length === 0 ? <option value="">{coreT({key: "ui.skills.no_projects_option"})}</option> : null}
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
                        {coreT({key: "ui.common.cancel"})}
                    </button>
                    <button
                        type="button"
                        className="text-prompt-modal__btn text-prompt-modal__btn--primary"
                        disabled={!canSubmit}
                        onClick={() => void handleConfirm()}
                    >
                        {saving ? coreT({key: "ui.common.creating"}) : coreT({key: "ui.skills.create_and_edit"})}
                    </button>
                </div>
            </div>
        </div>
    );
}
