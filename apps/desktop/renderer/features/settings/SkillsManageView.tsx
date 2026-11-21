/**
 * 设置 · 技能管理页：双 tab（全局默认在前 / 项目按所有项目分组在后）。
 *
 * - 全局 tab「被项目副本覆盖」标签按「任意项目存在同名副本」判定（SPEC D5），
 *   说明文案注明该全局版仅对无副本的项目生效。
 * - 批量模式复用 ManageHeader + useBatchSelection；切换 tab 自动退出批量。
 * - ⋮ 菜单：编辑 / 编辑信息 / 导出 ZIP / 删除（删除文案区分影响范围；
 *   编辑信息对 invalid 技能禁用：先修复 SKILL.md 再改信息）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { coreT } from "@shared/logic/core-i18n";
import type {
  ProjectDto,
  SkillListItemDto,
  SkillRefDto,
} from "@shared/ipc-types";
import {
  ipcProjectsList,
  ipcSkillsDelete,
  ipcSkillsList,
  ipcVfsZipExport,
} from "@/ipc/client";
import { ManageHeader } from "@/components/batch/ManageHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { showToast } from "@/components/ui/show-toast";
import { useBatchSelection } from "@/hooks/useBatchSelection";
import type { SettingsNavHandle } from "./settings-nav";
import {
  SettingsListEmpty,
  SettingsListItem,
  SettingsListSection,
  SettingsPanel,
} from "./settings-ui";
import { NewSkillModal } from "@/features/skills/NewSkillModal";
import { SkillInfoEditModal } from "@/features/skills/SkillInfoEditModal";
import { skillDomainLabel } from "@/features/skills/skill-ui";

type SkillTab = "global" | "project";

type ProjectGroup = {
  readonly project: ProjectDto;
  readonly rows: readonly SkillListItemDto[];
};

export function SkillsManageView({ nav }: { nav: SettingsNavHandle }) {
  const [tab, setTab] = useState<SkillTab>("global");
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [globalRows, setGlobalRows] = useState<SkillListItemDto[]>([]);
  const [projectGroups, setProjectGroups] = useState<ProjectGroup[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const batch = useBatchSelection();

  const [menu, setMenu] = useState<{
    ref: SkillRefDto;
    label: string;
    x: number;
    y: number;
    valid: boolean;
    description: string | null;
  } | null>(null);
  const [infoEdit, setInfoEdit] = useState<{
    ref: SkillRefDto;
    name: string;
    description: string | null;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    refs: SkillRefDto[];
    label: string;
    scopeLabel: string;
  } | null>(null);

  const reload = useCallback(async () => {
    const projectsRes = await ipcProjectsList();
    if (!projectsRes.ok) {
      setError(projectsRes.error.message);
      return;
    }
    const projectList = [...projectsRes.data];
    const [globalRes, ...projectResults] = await Promise.all([
      ipcSkillsList({ domain: "global" }),
      ...projectList.map((p) =>
        ipcSkillsList({ domain: "project", projectId: p.id }),
      ),
    ]);
    if (!globalRes.ok) {
      setError(globalRes.error.message);
      return;
    }
    const groups: ProjectGroup[] = [];
    for (let i = 0; i < projectList.length; i += 1) {
      const res = projectResults[i]!;
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      groups.push({ project: projectList[i]!, rows: res.data });
    }
    setError(undefined);
    setProjects(projectList);
    setGlobalRows([...globalRes.data]);
    setProjectGroups(groups);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** D5：任意项目存在同名副本 → 全局 tab 标「被项目副本覆盖」。 */
  const overriddenGlobalNames = useMemo(() => {
    const names = new Set<string>();
    for (const group of projectGroups) {
      for (const row of group.rows) {
        names.add(row.name);
      }
    }
    return names;
  }, [projectGroups]);

  const switchTab = (next: SkillTab) => {
    setTab(next);
    batch.exit();
  };

  const openDetail = (ref: SkillRefDto) => {
    nav.navState.viewingSkillRef = ref;
    nav.push("skillDetail");
  };

  const menuItems = useMemo((): ContextMenuItem[] => {
    if (menu == null) {
      return [];
    }
    const items: ContextMenuItem[] = [
      { label: coreT({key: "ui.common.edit"}), action: "edit" },
      {
        label: coreT({key: "ui.skills.edit_info"}),
        action: "edit-info",
        // invalid（front matter 不可解析）时禁用：改名链路会跳过 front
        // matter 重写，先修复 SKILL.md 再改信息
        disabled: !menu.valid,
      },
      { label: coreT({key: "ui.skills.export_zip"}), action: "export-zip" },
      { label: coreT({key: "ui.common.delete"}), action: "delete", danger: true },
    ];
    return items;
  }, [menu]);

  const handleMenuSelect = (action: string) => {
    const current = menu;
    setMenu(null);
    if (current == null) {
      return;
    }
    if (action === "edit") {
      openDetail(current.ref);
      return;
    }
    if (action === "edit-info") {
      setInfoEdit({
        ref: current.ref,
        name: current.label,
        description: current.description,
      });
      return;
    }
    if (action === "export-zip") {
      void (async () => {
        const res = await ipcVfsZipExport({
          workspaceScope:
            current.ref.domain === "global" ? "global-meta" : "project-meta",
          ...(current.ref.domain === "project"
            ? { projectId: current.ref.projectId }
            : {}),
          directoryPath: `/meta/skills/${current.ref.name}`,
          fileName: `${current.ref.name}.zip`,
        });
        if (res.ok && res.data === "saved") {
          showToast(coreT({key: "ui.skills.exported_zip", params: {name: current.ref.name}}));
        } else if (!res.ok) {
          showToast(res.error.message);
        }
      })();
      return;
    }
    if (action === "delete") {
      const scopeLabel = current.ref.domain === "global" ? coreT({key: "ui.skills.global_delete_warn"}) : coreT({key: "ui.skills.project_delete_warn"});
      setDeleteConfirm({
        refs: [current.ref],
        label: current.label,
        scopeLabel,
      });
    }
  };

  const handleBatchDelete = () => {
    // 批量 key → SkillRef（原 parseSkillKey 内联）：`global/{name}` 或 `project/{projectId}/{name}`
    const refs = [...batch.selectedIds]
      .map((key): SkillRefDto | undefined => {
        const parts = key.split("/");
        if (parts[0] === "global" && parts.length === 2 && parts[1]) {
          return { domain: "global", name: parts[1]! };
        }
        if (parts[0] === "project" && parts.length === 3 && parts[1] && parts[2]) {
          return { domain: "project", projectId: parts[1], name: parts[2]! };
        }
        return undefined;
      })
      .filter((ref): ref is SkillRefDto => ref != null);
    if (refs.length === 0) {
      return;
    }
    const allGlobal = refs.every((r) => r.domain === "global");
    setDeleteConfirm({
      refs,
      label: coreT({key: "ui.skills.selected_skills_label", params: {count: refs.length}}),
      scopeLabel: allGlobal
        ? coreT({key: "ui.skills.batch_delete_warn_global"})
        : coreT({key: "ui.skills.batch_delete_warn_project"}),
    });
  };

  const renderRow = (row: SkillListItemDto, ref: SkillRefDto) => {
    // 列表 key（原 skillKey 内联）：`global/{name}` 或 `project/{projectId}/{name}`
    const key = ref.domain === "global" ? `global/${ref.name}` : `project/${ref.projectId ?? ""}/${ref.name}`;
    return (
      <SettingsListItem
        key={key}
        title={row.name}
        meta={
          <>
            <span className="skill-domain-badge">{skillDomainLabel(ref.domain, false)}</span>
            {ref.domain === "global" && overriddenGlobalNames.has(row.name) ? (
              <span
                className="skill-override-tag"
                title={coreT({key: "ui.skills.global_shadow_note"})}
              >
                {coreT({key: "ui.skills.overridden_tag"})}
              </span>
            ) : null}
            {!row.valid ? (
              <span className="skill-invalid-tag">{coreT({key: "ui.skills.invalid_tag", params: {reason: row.invalidReason ?? coreT({key: "ui.skills.invalid_default_reason"})}})}</span>
            ) : null}
            <span>{row.description ?? "—"}</span>
          </>
        }
        batchMode={batch.active}
        selected={batch.isSelected(key)}
        onToggleSelect={() => batch.toggle(key)}
        onClick={() => openDetail(ref)}
        onMenu={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setMenu({
            ref,
            label: row.name,
            x: Math.max(8, rect.left),
            y: Math.max(8, rect.bottom + 4),
            valid: row.valid,
            description: row.description,
          });
        }}
      />
    );
  };

  return (
    <SettingsPanel>
      <div className="skills-manage__tabs">
        <SegmentedControl
          aria-label={coreT({key: "ui.skills.domain_section"})}
          value={tab}
          options={[
            { value: "global", label: coreT({key: "ui.skills.global_tab"}) },
            { value: "project", label: coreT({key: "ui.skills.project_tab"}) },
          ]}
          onChange={(next) => switchTab(next as SkillTab)}
        />
      </div>
      <ManageHeader
        title={tab === "global" ? coreT({key: "ui.skills.global_tab"}) : coreT({key: "ui.skills.project_tab"})}
        batchMode={batch.active}
        selectedCount={batch.selectedCount}
        onEnterBatch={batch.enter}
        onCancelBatch={batch.exit}
        onDelete={handleBatchDelete}
        hint={
          tab === "global"
            ? coreT({key: "ui.skills.global_hint"})
            : coreT({key: "ui.skills.project_hint"})
        }
        normalActions={
          <button
            type="button"
            className="list-manage-header__btn list-manage-header__btn--primary"
            onClick={() => setCreateOpen(true)}
          >
            {coreT({key: "ui.common.new"})}
          </button>
        }
      />
      {error ? <p className="settings-error">{error}</p> : null}
      {tab === "global" ? (
        <SettingsListSection>
          {globalRows.length === 0 ? (
            <SettingsListEmpty>{coreT({key: "ui.skills.empty_global"})}</SettingsListEmpty>
          ) : null}
          {globalRows.map((row) =>
            renderRow(row, { domain: "global", name: row.name }),
          )}
        </SettingsListSection>
      ) : (
        <>
          {projects.length === 0 ? (
            <SettingsListSection>
              <SettingsListEmpty>{coreT({key: "ui.skills.empty_projects_desktop"})}</SettingsListEmpty>
            </SettingsListSection>
          ) : null}
          {projectGroups.map((group) => (
            <SettingsListSection
              key={group.project.id}
              header={
                <span className="skills-manage__group-title">
                  {group.project.name}
                </span>
              }
            >
              {group.rows.length === 0 ? (
                <SettingsListEmpty>{coreT({key: "ui.skills.empty_project_desktop"})}</SettingsListEmpty>
              ) : null}
              {group.rows.map((row) =>
                renderRow(row, {
                  domain: "project",
                  projectId: group.project.id,
                  name: row.name,
                }),
              )}
            </SettingsListSection>
          ))}
        </>
      )}

      <ContextMenu
        open={menu != null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menuItems}
        onSelect={handleMenuSelect}
        onClose={() => setMenu(null)}
      />

      <ConfirmModal
        open={deleteConfirm != null}
        title={coreT({key: "ui.skills.delete_title"})}
        message={coreT({key: "ui.skills.delete_confirm_named", params: {name: deleteConfirm?.label ?? "", scope: deleteConfirm?.scopeLabel ?? ""}})}
        danger
        onConfirm={() => {
          const target = deleteConfirm;
          setDeleteConfirm(null);
          if (!target) {
            return;
          }
          void (async () => {
            for (const ref of target.refs) {
              const res = await ipcSkillsDelete(ref);
              if (!res.ok) {
                showToast(res.error.message);
                break;
              }
            }
            batch.exit();
            showToast(coreT({key: "ui.skills.deleted_done"}));
            await reload();
          })();
        }}
        onCancel={() => setDeleteConfirm(null)}
      />

      <NewSkillModal
        open={createOpen}
        defaultDomain={tab}
        projects={projects}
        onClose={() => setCreateOpen(false)}
        onCreated={(ref) => {
          void reload().then(() => openDetail(ref));
        }}
      />

      <SkillInfoEditModal
        open={infoEdit != null}
        skillRef={infoEdit?.ref ?? { domain: "global", name: "" }}
        currentName={infoEdit?.name ?? ""}
        currentDescription={infoEdit?.description ?? null}
        onClose={() => setInfoEdit(null)}
        onSaved={(ref) => {
          // 详情栈顶若正在看同一技能，同步 viewingSkillRef 防「技能消失踢回」
          if (nav.navState.viewingSkillRef?.name === infoEdit?.ref.name) {
            nav.navState.viewingSkillRef = ref;
          }
          showToast(coreT({key: "ui.skills.info_saved"}));
          void reload();
        }}
      />
    </SettingsPanel>
  );
}
