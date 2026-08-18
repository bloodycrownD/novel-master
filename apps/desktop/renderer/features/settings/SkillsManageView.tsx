/**
 * 设置 · 技能管理页：双 tab（全局默认在前 / 项目按所有项目分组在后）。
 *
 * - 全局 tab「被项目副本覆盖」标签按「任意项目存在同名副本」判定（SPEC D5），
 *   说明文案注明该全局版仅对无副本的项目生效。
 * - 批量模式复用 ManageHeader + useBatchSelection；切换 tab 自动退出批量。
 * - ⋮ 菜单：编辑 / 删除（文案区分影响范围）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ProjectDto,
  SkillListItemDto,
  SkillRefDto,
} from "@shared/ipc-types";
import {
  ipcProjectsList,
  ipcSkillsDelete,
  ipcSkillsList,
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
import {
  parseSkillKey,
  skillDomainLabel,
  skillKey,
} from "@/features/skills/skill-ui";

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
      { label: "编辑", action: "edit" },
      { label: "删除", action: "delete", danger: true },
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
    if (action === "delete") {
      const scopeLabel =
        current.ref.domain === "global"
          ? "该技能影响所有项目，删除后全部会话不再注入。"
          : "该技能仅所属项目生效，删除后其他项目不受影响。";
      setDeleteConfirm({
        refs: [current.ref],
        label: current.label,
        scopeLabel,
      });
    }
  };

  const handleBatchDelete = () => {
    const refs = [...batch.selectedIds]
      .map((key) => parseSkillKey(key))
      .filter((ref): ref is SkillRefDto => ref != null);
    if (refs.length === 0) {
      return;
    }
    const allGlobal = refs.every((r) => r.domain === "global");
    setDeleteConfirm({
      refs,
      label: `选中的 ${refs.length} 个技能`,
      scopeLabel: allGlobal
        ? "其中的全局技能影响所有项目，删除后全部会话不再注入。"
        : "项目技能仅所属项目生效，删除后其他项目不受影响。",
    });
  };

  const renderRow = (row: SkillListItemDto, ref: SkillRefDto) => {
    const key = skillKey(ref);
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
                title="该全局版仅对没有同名副本的项目生效；有副本的项目使用项目版。"
              >
                被项目副本覆盖
              </span>
            ) : null}
            {!row.valid ? (
              <span className="skill-invalid-tag">{`无效 · ${row.invalidReason ?? "front matter 不可解析"}`}</span>
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
          });
        }}
      />
    );
  };

  return (
    <SettingsPanel>
      <div className="skills-manage__tabs">
        <SegmentedControl
          aria-label="技能域"
          value={tab}
          options={[
            { value: "global", label: "全局技能" },
            { value: "project", label: "项目技能" },
          ]}
          onChange={(next) => switchTab(next as SkillTab)}
        />
      </div>
      <ManageHeader
        title={tab === "global" ? "全局技能" : "项目技能"}
        batchMode={batch.active}
        selectedCount={batch.selectedCount}
        onEnterBatch={batch.enter}
        onCancelBatch={batch.exit}
        onDelete={handleBatchDelete}
        hint={
          tab === "global"
            ? "全局技能对所有项目生效；同名项目副本会覆盖全局版（仅对无副本的项目生效）。"
            : "项目技能仅所属项目生效；按所有项目分组展示。"
        }
        normalActions={
          <button
            type="button"
            className="list-manage-header__btn list-manage-header__btn--primary"
            onClick={() => setCreateOpen(true)}
          >
            新建
          </button>
        }
      />
      {error ? <p className="settings-error">{error}</p> : null}
      {tab === "global" ? (
        <SettingsListSection>
          {globalRows.length === 0 ? (
            <SettingsListEmpty>暂无全局技能，点击上方「新建」创建。</SettingsListEmpty>
          ) : null}
          {globalRows.map((row) =>
            renderRow(row, { domain: "global", name: row.name }),
          )}
        </SettingsListSection>
      ) : (
        <>
          {projects.length === 0 ? (
            <SettingsListSection>
              <SettingsListEmpty>暂无项目，先在主导航创建项目。</SettingsListEmpty>
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
                <SettingsListEmpty>该项目暂无技能。</SettingsListEmpty>
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
        title="删除技能"
        message={`删除「${deleteConfirm?.label ?? ""}」？${deleteConfirm?.scopeLabel ?? ""}`}
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
            showToast("已删除技能");
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
    </SettingsPanel>
  );
}
