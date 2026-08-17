/**
 * 会话技能面板（SessionDetailDrawer 内嵌视图）。
 *
 * 当前项目的合并视图（global ∪ project、同名项目副本覆盖）：
 * 域徽标 / 覆盖 / 无效标签 + 启用开关（写当前项目负清单，仅对本项目生效）。
 * 头部动作：「整理」跳设置·技能管理页、「新建」默认项目域；
 * 点行（开关区域外）跳设置·技能详情页。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EffectiveSkillDto, ProjectDto } from "@shared/ipc-types";
import {
  ipcProjectsList,
  ipcSkillsEffective,
  ipcSkillsToggle,
} from "@/ipc/client";
import { Switch } from "@/components/ui/Switch";
import { showToast } from "@/components/ui/show-toast";
import { NewSkillModal } from "@/features/skills/NewSkillModal";
import {
  dispatchOpenSettingsView,
  skillDomainLabel,
  toSkillRef,
} from "@/features/skills/skill-ui";

type SessionSkillPanelProps = {
  projectId: string;
  onClose: () => void;
};

export function SessionSkillPanel({ projectId, onClose }: SessionSkillPanelProps) {
  const [rows, setRows] = useState<EffectiveSkillDto[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [busyNames, setBusyNames] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    const res = await ipcSkillsEffective({ projectId });
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setError(undefined);
    setRows(res.data);
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 新建弹窗的项目下拉（默认当前项目）
  useEffect(() => {
    void ipcProjectsList().then((res) => {
      if (res.ok) {
        setProjects([...res.data]);
      }
    });
  }, []);

  const toggle = async (row: EffectiveSkillDto, next: boolean) => {
    setBusyNames((prev) => new Set(prev).add(row.name));
    try {
      const res = await ipcSkillsToggle({
        projectId,
        name: row.name,
        disabled: !next,
      });
      if (!res.ok) {
        showToast(res.error.message);
        return;
      }
      await reload();
    } finally {
      setBusyNames((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(row.name);
        return nextSet;
      });
    }
  };

  const openDetail = (row: EffectiveSkillDto) => {
    onClose();
    dispatchOpenSettingsView({
      view: "skillDetail",
      skillRef: toSkillRef(row.domain, row.name, projectId),
    });
  };

  const summary = useMemo(
    () => {
      const validCount = rows.filter((r) => r.valid).length;
      const enabledCount = rows.filter((r) => r.effective).length;
      return { enabledCount, validCount };
    },
    [rows],
  );

  return (
    <div className="session-skill-panel" id="session-skill-panel">
      <div className="session-skill-panel__head">
        <button
          type="button"
          className="session-skill-panel__action"
          data-session-skill-action="manage"
          onClick={() => {
            onClose();
            dispatchOpenSettingsView({ view: "skillsManage" });
          }}
        >
          整理
        </button>
        <span className="session-skill-panel__summary">
          {summary.enabledCount}/{summary.validCount} 启用
        </span>
        <button
          type="button"
          className="session-skill-panel__action session-skill-panel__action--primary"
          data-session-skill-action="create"
          onClick={() => setCreateOpen(true)}
        >
          新建
        </button>
      </div>
      {error ? <p className="session-skill-panel__error">{error}</p> : null}
      <ul className="session-skill-panel__list">
        {rows.length === 0 ? (
          <li className="session-skill-panel__empty">
            暂无技能。点击「新建」创建项目技能，或在设置·技能管理页维护全局技能。
          </li>
        ) : null}
        {rows.map((row) => (
          <li
            key={`${row.domain}:${row.name}`}
            className={`session-skill-panel__row${
              row.effective ? "" : " is-off"
            }${row.valid ? "" : " is-invalid"}`}
          >
            <button
              type="button"
              className="session-skill-panel__info"
              data-session-skill-action="open-detail"
              onClick={() => openDetail(row)}
            >
              <span className="session-skill-panel__name">{row.name}</span>
              <span className="session-skill-panel__meta">
                <span className="skill-domain-badge">
                  {skillDomainLabel(row.domain, row.overridden)}
                </span>
                {!row.valid ? (
                  <span className="skill-invalid-tag">{`无效 · ${row.invalidReason ?? "front matter 不可解析"}`}</span>
                ) : null}
                {row.description ?? ""}
              </span>
            </button>
            <Switch
              checked={!row.disabled}
              disabled={busyNames.has(row.name) || !row.valid}
              aria-label={`${row.disabled ? "启用" : "关闭"}技能 ${row.name}（仅当前项目）`}
              onChange={(next) => void toggle(row, next)}
            />
          </li>
        ))}
      </ul>
      <NewSkillModal
        open={createOpen}
        defaultDomain="project"
        defaultProjectId={projectId}
        projects={projects}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          void reload();
        }}
      />
    </div>
  );
}
