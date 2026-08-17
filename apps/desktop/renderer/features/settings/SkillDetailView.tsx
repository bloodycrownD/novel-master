/**
 * 设置 · 技能详情页（desktop）：文件列表 + read/edit 双态（复用 CodeEditor，
 * 照 PreviewPane 形态但独立视图，不耦合 WorkspaceTree / WorkspacePanelScope）。
 *
 * - SKILL.md 置顶排序且为保留入口（不可删除、不可新建同名）。
 * - 新建辅助文件：相对路径校验（必填 / 禁 `..` / 禁 SKILL.md / 域内查重）。
 * - 未保存离开（切文件 / 返回）时确认拦截。
 * - 技能被删（清单不再含）时安全踢回上一级。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ipcProjectsList, ipcSkillsList, ipcSkillsRead, ipcSkillsWrite, ipcVfsDelete } from "@/ipc/client";
import { CodeEditor } from "@/components/ui/CodeEditor";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { TextPromptModal } from "@/components/ui/TextPromptModal";
import { showToast } from "@/components/ui/show-toast";
import type { SettingsNavHandle } from "./settings-nav";
import { SettingsPanel } from "./settings-ui";

/** SKILL.md 置顶，其余按路径字典序。 */
function sortSkillFiles(files: readonly string[]): string[] {
  return [...files].sort((a, b) => {
    if (a === "SKILL.md") {
      return -1;
    }
    if (b === "SKILL.md") {
      return 1;
    }
    return a.localeCompare(b);
  });
}

const SKILL_ENTRY_FILE = "SKILL.md";

export function SkillDetailView({ nav }: { nav: SettingsNavHandle }) {
  const ref = nav.navState.viewingSkillRef;
  const [files, setFiles] = useState<string[]>([]);
  const [projectName, setProjectName] = useState<string | undefined>();
  const [selected, setSelected] = useState<string>(SKILL_ENTRY_FILE);
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);
  const [createFileOpen, setCreateFileOpen] = useState(false);
  const [deleteFileConfirm, setDeleteFileConfirm] = useState<string | null>(
    null,
  );
  const [leaveConfirm, setLeaveConfirm] = useState<null | (() => void)>(null);

  const domain = ref?.domain ?? "global";
  const listRequest =
    domain === "global"
      ? { domain: "global" as const }
      : { domain: "project" as const, projectId: ref?.projectId };

  const reloadFiles = useCallback(async () => {
    if (ref == null) {
      return;
    }
    const res = await ipcSkillsList(listRequest);
    if (!res.ok) {
      showToast(res.error.message);
      return;
    }
    const entry = res.data.find((s) => s.name === ref.name);
    if (entry == null) {
      // 技能已被删除（或正被覆盖复制途中）→ 安全踢回
      setMissing(true);
      return;
    }
    setFiles(sortSkillFiles(entry.files));
  }, [ref, listRequest]);

  const loadFile = useCallback(
    async (path: string) => {
      if (ref == null) {
        return;
      }
      setLoading(true);
      try {
        const res = await ipcSkillsRead({
          domain: ref.domain,
          ...(ref.domain === "project" ? { projectId: ref.projectId } : {}),
          name: ref.name,
          path,
        });
        if (!res.ok) {
          showToast(res.error.message);
          return;
        }
        setContent(res.data.content);
        setSavedContent(res.data.content);
      } finally {
        setLoading(false);
      }
    },
    [ref],
  );

  useEffect(() => {
    if (ref == null) {
      return;
    }
    setSelected(SKILL_ENTRY_FILE);
    setMode("read");
    setMissing(false);
    void reloadFiles();
    if (ref.domain === "project") {
      void ipcProjectsList().then((res) => {
        if (res.ok) {
          const project = res.data.find((p) => p.id === ref.projectId);
          setProjectName(project?.name);
        }
      });
    } else {
      setProjectName(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随 ref 变化重载
  }, [ref?.domain, ref?.projectId, ref?.name]);

  useEffect(() => {
    if (ref != null && !missing) {
      void loadFile(selected);
      setMode("read");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 选中文件变化时重载
  }, [selected, missing]);

  const isDirty = content !== savedContent;

  /** dirty 时先弹确认再执行动作。 */
  const guarded = (action: () => void) => {
    if (isDirty && mode === "edit") {
      setLeaveConfirm(() => action);
      return;
    }
    action();
  };

  const save = useCallback(async () => {
    if (ref == null || !isDirty) {
      return;
    }
    setSaving(true);
    try {
      const res = await ipcSkillsWrite({
        domain: ref.domain,
        ...(ref.domain === "project" ? { projectId: ref.projectId } : {}),
        name: ref.name,
        path: selected,
        content,
      });
      if (!res.ok) {
        showToast(`保存失败：${res.error.message}`);
        return;
      }
      setSavedContent(content);
      showToast("已保存技能文件");
    } finally {
      setSaving(false);
    }
  }, [ref, isDirty, selected, content]);

  const createFile = async (rawPath: string) => {
    const path = rawPath.trim().replace(/^\/+/, "");
    if (path.length === 0) {
      showToast("请输入相对路径。");
      return;
    }
    if (path.includes("..")) {
      showToast("路径不能包含「..」。");
      return;
    }
    if (path === SKILL_ENTRY_FILE) {
      showToast("SKILL.md 是保留入口文件，不可新建同名文件。");
      return;
    }
    if (files.includes(path)) {
      showToast("该文件已存在。");
      return;
    }
    const res = await ipcSkillsWrite({
      domain,
      ...(domain === "project" ? { projectId: ref?.projectId } : {}),
      name: ref?.name ?? "",
      path,
      content: "",
    });
    if (!res.ok) {
      showToast(res.error.message);
      return;
    }
    await reloadFiles();
    setSelected(path);
    setMode("edit");
  };

  const deleteFile = async (path: string) => {
    // SKILL.md 为保留入口，列表行不提供删除；此处仅兜底
    if (path === SKILL_ENTRY_FILE) {
      showToast("SKILL.md 是保留入口文件，不可删除。");
      return;
    }
    // 技能文件 = VFS 文件（逻辑路径 /meta/skills/{name}/{rel}，两域 scope 均可定位）；
    // core SkillService 暂无单文件删除端口，这里复用 VFS delete（与技能写入同存储）。
    const res = await ipcVfsDelete({
      workspaceScope: domain === "global" ? "global" : "session",
      ...(domain === "project" ? { projectId: ref?.projectId } : {}),
      path: `/meta/skills/${ref?.name ?? ""}/${path}`,
    });
    if (!res.ok) {
      showToast(res.error.message);
      return;
    }
    await reloadFiles();
    if (selected === path) {
      setSelected(SKILL_ENTRY_FILE);
    }
    showToast("已删除辅助文件");
  };

  const visiblePath = useMemo(
    () => `/meta/skills/${ref?.name ?? ""}/${selected}`,
    [ref?.name, selected],
  );

  if (ref == null) {
    return (
      <SettingsPanel>
        <p className="settings-error">未指定技能。</p>
      </SettingsPanel>
    );
  }

  if (missing) {
    return (
      <SettingsPanel>
        <p className="settings-error">技能不存在或已删除。</p>
        <Button variant="primary" onClick={() => nav.pop()}>
          返回技能管理
        </Button>
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel>
      <div className="skill-detail__head">
        <span className="skill-detail__name">{ref.name}</span>
        <span className="skill-domain-badge">
          {domain === "project"
            ? `项目域 · ${projectName ?? ref.projectId ?? ""}`
            : "全局域 · 所有项目生效"}
        </span>
      </div>
      <div className="skill-detail__body">
        <aside className="skill-detail__files">
          <div className="skill-detail__files-head">
            <span>文件</span>
            <button
              type="button"
              className="skill-detail__file-add"
              aria-label="新建辅助文件"
              onClick={() => setCreateFileOpen(true)}
            >
              ＋
            </button>
          </div>
          {files.map((path) => (
            <div
              key={path}
              className={`skill-detail__file-row${
                path === selected ? " is-active" : ""
              }`}
            >
              <button
                type="button"
                className="skill-detail__file-open"
                onClick={() => guarded(() => setSelected(path))}
              >
                <span aria-hidden>{path === SKILL_ENTRY_FILE ? "⚡" : "📄"}</span>
                <span>{path}</span>
                {path === SKILL_ENTRY_FILE ? (
                  <span className="skill-detail__entry-tag">入口文件</span>
                ) : null}
              </button>
              {path !== SKILL_ENTRY_FILE ? (
                <button
                  type="button"
                  className="skill-detail__file-delete"
                  aria-label={`删除 ${path}`}
                  onClick={() => setDeleteFileConfirm(path)}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </aside>
        <div className="skill-detail__editor">
          <div className="skill-detail__editor-head">
            <span className="skill-detail__path-chip" title={visiblePath}>
              {visiblePath}
            </span>
            <SegmentedControl
              aria-label="技能文件模式"
              value={mode}
              options={[
                { value: "read", label: "查看" },
                { value: "edit", label: "编辑" },
              ]}
              onChange={setMode}
            />
            {mode === "edit" ? (
              <Button
                variant="primary"
                disabled={!isDirty || saving}
                onClick={() => void save()}
              >
                {saving ? "保存中…" : "保存"}
              </Button>
            ) : null}
            <Button onClick={() => guarded(() => nav.pop())}>返回</Button>
          </div>
          {loading ? (
            <p className="skill-detail__empty">加载中…</p>
          ) : mode === "read" ? (
            <pre className="skill-detail__content">{content || "（空文件）"}</pre>
          ) : (
            <>
              <CodeEditor
                id="skill-editor"
                aria-label="技能文件编辑"
                value={content}
                languagePath={selected}
                onChange={setContent}
                onSave={() => void save()}
              />
              <div className="skill-detail__status">
                <span>{isDirty ? "未保存（Ctrl+S 保存）" : "已保存"}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <TextPromptModal
        open={createFileOpen}
        title="新建辅助文件"
        label="相对路径（支持子目录，如 references/x.md）"
        placeholder="references/x.md"
        confirmLabel="创建并编辑"
        onClose={() => setCreateFileOpen(false)}
        onConfirm={createFile}
      />

      <ConfirmModal
        open={deleteFileConfirm != null}
        title="删除辅助文件"
        message={`删除「${deleteFileConfirm ?? ""}」？`}
        danger
        onConfirm={() => {
          const path = deleteFileConfirm;
          setDeleteFileConfirm(null);
          if (path != null) {
            void deleteFile(path);
          }
        }}
        onCancel={() => setDeleteFileConfirm(null)}
      />

      <ConfirmModal
        open={leaveConfirm != null}
        title="未保存的更改"
        message="当前技能文件有未保存的更改，离开将丢弃。是否继续？"
        danger
        onConfirm={() => {
          const action = leaveConfirm;
          setLeaveConfirm(null);
          action?.();
        }}
        onCancel={() => setLeaveConfirm(null)}
      />
    </SettingsPanel>
  );
}
