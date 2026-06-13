import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentDefinition,
  DynamicPromptBlock,
  PersistPromptBlock,
  PersistTextPromptBlock,
} from "@novel-master/core";
import {
  ROLE_OPTIONS,
  TOOL_MODE_OPTIONS,
  blockTypeLabel,
  buildAgentDefinitionFromForm,
  createDefaultAgentEditorPrompts,
  createDefaultDynamicTextBlock,
  createDefaultPersistTextBlock,
  createDefaultWorktreeBlock,
  definitionToForm,
  formatApplicationModelId,
  formSnapshotJson,
  parseApplicationModelId,
  toolsSelectionFromDefinition,
  isDynamicBlockPersistent,
  withDynamicBlockPersistence,
  type ToolsMode,
} from "@novel-master/core/config-forms/agent";
import { ToolPolicyPicker } from "./ToolPolicyPicker";
import { Button } from "../../components/ui/Button";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { showToast } from "../../components/ui/show-toast";
import { toastSettingsError, toastSettingsSuccess } from "../../utils/settings-feedback";
import {
  ipcAgentRegistryGet,
  ipcAgentRegistryUpsert,
  ipcAgentYamlExport,
  ipcAgentYamlImport,
  ipcProviderModelsSavedList,
  ipcProvidersList,
} from "../../ipc/client";
import type { SettingsNavState } from "./settings-nav";
import {
  SettingsField,
  SettingsFormSection,
  SettingsPanel,
  SettingsSection,
} from "./settings-ui";
import { Switch } from "../../components/ui/Switch";

const DYNAMIC_MACROS = [
  { label: "$time", token: "{{$time}}" },
  { label: "$week_cn", token: "{{$week_cn}}" },
  { label: "$filetree", token: "{{$filetree}}" },
] as const;

type Nav = {
  push: (viewId: string) => void;
  navState: SettingsNavState;
};

type AddMenuTarget = "persist" | "dynamic" | null;

function insertAtCursor(
  value: string,
  insert: string,
  textarea: HTMLTextAreaElement | null,
): string {
  if (textarea == null) {
    return value + insert;
  }
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  return value.slice(0, start) + insert + value.slice(end);
}

export function AgentEditorView({ nav }: { nav: Nav }) {
  const agentId = nav.navState.editingAgentId;
  const [name, setName] = useState("");
  const [maxSteps, setMaxSteps] = useState("20");
  const [modelEnabled, setModelEnabled] = useState(false);
  const [providerId, setProviderId] = useState("");
  const [vendorModelId, setVendorModelId] = useState("");
  const [systemEnabled, setSystemEnabled] = useState(false);
  const [systemContent, setSystemContent] = useState("");
  const [persist, setPersist] = useState<PersistPromptBlock[]>([]);
  const [dynamic, setDynamic] = useState<DynamicPromptBlock[]>([]);
  const [toolsMode, setToolsMode] = useState<ToolsMode>("default");
  const [toolsSelected, setToolsSelected] = useState<string[]>([]);
  const [providers, setProviders] = useState<Array<{ id: string; label: string }>>([]);
  const [savedModels, setSavedModels] = useState<
    Array<{ vendorModelId: string; displayName: string }>
  >([]);
  const [savedBaseline, setSavedBaseline] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmImport, setConfirmImport] = useState(false);
  const [addBlockMenu, setAddBlockMenu] = useState<{
    x: number;
    y: number;
    target: AddMenuTarget;
  } | null>(null);
  const dynamicTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [dynamicInsertIndex, setDynamicInsertIndex] = useState<number | null>(null);

  const snapshot = useMemo(
    () =>
      formSnapshotJson({
        name,
        maxSteps,
        modelEnabled,
        providerId,
        vendorModelId,
        toolsMode,
        toolsSelected,
        systemEnabled,
        systemContent,
        persist,
        dynamic,
      }),
    [
      name,
      maxSteps,
      modelEnabled,
      providerId,
      vendorModelId,
      toolsMode,
      toolsSelected,
      systemEnabled,
      systemContent,
      persist,
      dynamic,
    ],
  );

  const loadSavedModels = useCallback(async (pid: string) => {
    const res = await ipcProviderModelsSavedList({ providerId: pid });
    if (res.ok) {
      setSavedModels(
        res.data.map((m) => ({
          vendorModelId: m.vendorModelId,
          displayName: m.displayName?.trim() || m.vendorModelId,
        })),
      );
    }
  }, []);

  const loadAgent = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const [agentRes, providerRes] = await Promise.all([
        ipcAgentRegistryGet({ agentId }),
        ipcProvidersList(),
      ]);
      if (!agentRes.ok) {
        toastSettingsError(agentRes.error.message);
        return;
      }
      const def = agentRes.data as AgentDefinition;
      const promptForm = definitionToForm(def);
      setName(def.name ?? "");
      setMaxSteps(String(def.runtime?.maxSteps ?? 20));
      setSystemEnabled(promptForm.systemEnabled);
      setSystemContent(promptForm.systemContent);
      setPersist(
        promptForm.persist.length > 0
          ? [...promptForm.persist]
          : createDefaultAgentEditorPrompts().persist,
      );
      setDynamic([...promptForm.dynamic]);

      const toolsWire = toolsSelectionFromDefinition(def);
      setToolsMode(toolsWire.mode);
      setToolsSelected([...toolsWire.selected]);

      const providerRows = providerRes.ok
        ? providerRes.data.map((p) => ({
            id: p.id,
            label: p.displayName?.trim() || p.id,
          }))
        : [];
      setProviders(providerRows);

      let baselineProviderId = "";
      let baselineVendorModelId = "";
      let modelOn = false;
      if (def.model) {
        try {
          const parsed = parseApplicationModelId(def.model);
          modelOn = true;
          setModelEnabled(true);
          setProviderId(parsed.providerId);
          baselineProviderId = parsed.providerId;
          baselineVendorModelId = parsed.vendorModelId;
          setVendorModelId(parsed.vendorModelId);
          await loadSavedModels(parsed.providerId);
        } catch {
          setModelEnabled(false);
        }
      } else {
        setModelEnabled(false);
        if (providerRows.length > 0) {
          setProviderId(providerRows[0]!.id);
          await loadSavedModels(providerRows[0]!.id);
        }
      }

      setSavedBaseline(
        formSnapshotJson({
          name: def.name ?? "",
          maxSteps: String(def.runtime?.maxSteps ?? 20),
          modelEnabled: modelOn,
          providerId: baselineProviderId,
          vendorModelId: baselineVendorModelId,
          toolsMode: toolsWire.mode,
          toolsSelected: [...toolsWire.selected],
          ...promptForm,
          persist:
            promptForm.persist.length > 0
              ? [...promptForm.persist]
              : createDefaultAgentEditorPrompts().persist,
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [agentId, loadSavedModels]);

  useEffect(() => {
    void loadAgent();
  }, [loadAgent]);

  if (!agentId) {
    return <p className="settings-hint">缺少 agentId</p>;
  }

  const preferredModelId =
    modelEnabled && providerId && vendorModelId
      ? formatApplicationModelId(providerId, vendorModelId)
      : undefined;

  const save = async () => {
    const built = buildAgentDefinitionFromForm({
      name,
      maxSteps,
      modelEnabled,
      providerId,
      vendorModelId,
      toolsMode,
      toolsSelected,
      systemEnabled,
      systemContent,
      persist,
      dynamic,
    });
    if (!built.ok) {
      showToast(built.message);
      return;
    }
    setSaving(true);
    try {
      const saveRes = await ipcAgentRegistryUpsert({
        agentId,
        definition: built.definition,
      });
      if (saveRes.ok) {
        setSavedBaseline(snapshot);
        toastSettingsSuccess("已保存 Agent 配置");
      } else {
        toastSettingsError(saveRes.error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const movePersist = (index: number, dir: -1 | 1) => {
    setPersist((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      const tmp = next[target]!;
      next[target] = next[index]!;
      next[index] = tmp;
      return next;
    });
  };

  const moveDynamic = (index: number, dir: -1 | 1) => {
    setDynamic((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      const tmp = next[target]!;
      next[target] = next[index]!;
      next[index] = tmp;
      return next;
    });
  };

  const deletePersist = (index: number) => {
    if (persist.length <= 1 && dynamic.length === 0 && !systemEnabled) {
      showToast("至少保留一个 Prompt 块");
      return;
    }
    setPersist((prev) => prev.filter((_, i) => i !== index));
  };

  const deleteDynamic = (index: number) => {
    if (dynamic.length <= 1 && persist.length === 0 && !systemEnabled) {
      showToast("至少保留一个 Prompt 块");
      return;
    }
    setDynamic((prev) => prev.filter((_, i) => i !== index));
  };

  const addPersistBlock = (kind: "text" | "worktree") => {
    setPersist((prev) => {
      if (kind === "worktree" && prev.some((b) => b.type === "worktree")) {
        showToast("persist 区至多一个 worktree 块");
        return prev;
      }
      return kind === "text"
        ? [...prev, createDefaultPersistTextBlock(prev.length)]
        : [...prev, createDefaultWorktreeBlock(prev.length)];
    });
    setAddBlockMenu(null);
  };

  const addDynamicBlock = () => {
    setDynamic((prev) => [...prev, createDefaultDynamicTextBlock(prev.length)]);
    setAddBlockMenu(null);
  };

  const handleProviderChange = async (pid: string) => {
    setProviderId(pid);
    const res = await ipcProviderModelsSavedList({ providerId: pid });
    if (res.ok && res.data.length > 0) {
      setVendorModelId(res.data[0]!.vendorModelId);
      setSavedModels(
        res.data.map((m) => ({
          vendorModelId: m.vendorModelId,
          displayName: m.displayName?.trim() || m.vendorModelId,
        })),
      );
    } else {
      setVendorModelId("");
      setSavedModels([]);
    }
  };

  const dirty = savedBaseline != null && snapshot !== savedBaseline;

  const renderBlockActions = (
    index: number,
    total: number,
    onMove: (i: number, d: -1 | 1) => void,
    onDelete: (i: number) => void,
  ) => (
    <div className="config-block-card__actions">
      {index > 0 ? (
        <button type="button" className="icon-btn" onClick={() => onMove(index, -1)} aria-label="上移">
          ↑
        </button>
      ) : null}
      {index < total - 1 ? (
        <button type="button" className="icon-btn" onClick={() => onMove(index, 1)} aria-label="下移">
          ↓
        </button>
      ) : null}
      <button type="button" className="icon-btn" onClick={() => onDelete(index)} aria-label="删除">
        ×
      </button>
    </div>
  );

  return (
    <SettingsPanel>
      {loading ? <p className="settings-hint">加载中…</p> : null}
      <SettingsFormSection
        title="Agent 配置"
        desc={`\u7f16\u8f91 ${agentId}${dirty ? " · 未保存" : ""}`}
        toolbar={
          <div className="settings-yaml-links">
            <Button variant="secondary" onClick={() => setConfirmImport(true)}>
              导入 YAML
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                void ipcAgentYamlExport({ agentId }).then((r) => {
                  if (r.ok && r.data === "saved") showToast("已导出 Agent YAML");
                  else if (!r.ok) showToast(r.error.message);
                })
              }
            >
              导出 YAML
            </Button>
          </div>
        }
        footer={
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? "保存中…" : "保存"}
          </Button>
        }
      >
        <SettingsSection title="基本信息">
          <SettingsField label="名称">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </SettingsField>
        </SettingsSection>

        <SettingsSection title="模型">
          <div className="settings-row settings-row--switch">
            <span className="settings-row__label">专属模型</span>
            <Switch checked={modelEnabled} onChange={setModelEnabled} aria-label="专属模型" />
          </div>
          {!modelEnabled ? (
            <p className="settings-hint">未启用时跟随工作区当前模型（会话操作抽屉 / 我的）。</p>
          ) : (
            <>
              <SettingsField label="服务商">
                <select value={providerId} onChange={(e) => void handleProviderChange(e.target.value)}>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </SettingsField>
              <SettingsField label="模型">
                <select
                  value={vendorModelId}
                  onChange={(e) => setVendorModelId(e.target.value)}
                  disabled={!providerId}
                >
                  {savedModels.map((m) => (
                    <option key={m.vendorModelId} value={m.vendorModelId}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </SettingsField>
              <p className="settings-hint">model: {preferredModelId ?? "—"}</p>
            </>
          )}
        </SettingsSection>

        <SettingsSection title="运行时">
          <SettingsField label="最大步数 maxSteps">
            <input type="number" min={1} value={maxSteps} onChange={(e) => setMaxSteps(e.target.value)} />
          </SettingsField>
        </SettingsSection>

        <SettingsSection title="工具策略">
          <SettingsField label="模式">
            <select value={toolsMode} onChange={(e) => setToolsMode(e.target.value as ToolsMode)}>
              {TOOL_MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SettingsField>
          {toolsMode !== "default" ? (
            <SettingsField label={toolsMode === "allow" ? "白名单工具" : "黑名单工具"}>
              <ToolPolicyPicker selected={toolsSelected} onChange={setToolsSelected} />
            </SettingsField>
          ) : (
            <p className="settings-hint">
              未配置时使用全部内置工具（7 个）：read、write、edit、fs、glob、grep、chat_grep。
            </p>
          )}
        </SettingsSection>

        <SettingsSection title="Prompt 布局（WYSIWYG）">
          <p className="settings-hint">
            纵向顺序与 LLM 组装一致：System → Persist → 会话历史 → Dynamic。
          </p>

          <div className="config-block-card config-block-card--prompt">
            <div className="config-block-card__header">
              <span className="config-block-card__badge">System</span>
              <span className="config-block-card__meta">API system 字段</span>
              <Switch
                checked={systemEnabled}
                onChange={setSystemEnabled}
                aria-label="启用 System"
              />
            </div>
            {systemEnabled ? (
              <SettingsField label="System 内容">
                <textarea
                  rows={4}
                  value={systemContent}
                  onChange={(e) => setSystemContent(e.target.value)}
                  placeholder="写入 LLM system 字段的单段提示…"
                />
              </SettingsField>
            ) : (
              <p className="config-block-card__hint">关闭时不写入 prompts.system。</p>
            )}
          </div>

          <div className="config-block-card__section-head">
            <span className="config-block-card__section-label">Persist 块</span>
            <button
              type="button"
              className="settings-link-btn"
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setAddBlockMenu({
                  x: Math.max(8, rect.right - 140),
                  y: Math.max(8, rect.bottom + 4),
                  target: "persist",
                });
              }}
            >
              添加
            </button>
          </div>
          <div className="config-block-list">
            {persist.map((block, index) => (
              <div key={`persist-${index}`} className="config-block-card config-block-card--prompt">
                <div className="config-block-card__header">
                  <span className="config-block-card__badge">{blockTypeLabel(block.type)}</span>
                  <span className="config-block-card__meta">{block.name}</span>
                  {renderBlockActions(index, persist.length, movePersist, deletePersist)}
                </div>
                <div className="config-block-card__body">
                  <SettingsField label="名称">
                    <input
                      value={block.name}
                      onChange={(e) =>
                        setPersist((prev) =>
                          prev.map((b, i) =>
                            i === index ? { ...b, name: e.target.value } : b,
                          ),
                        )
                      }
                    />
                  </SettingsField>
                  {block.type === "text" ? (
                    <>
                      <SettingsField label="角色">
                        <select
                          value={block.role}
                          onChange={(e) =>
                            setPersist((prev) =>
                              prev.map((b, i) =>
                                i === index && b.type === "text"
                                  ? { ...b, role: e.target.value as PersistTextPromptBlock["role"] }
                                  : b,
                              ),
                            )
                          }
                        >
                          {ROLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </SettingsField>
                      <p className="config-block-card__hint">persist 区禁止宏与 lifecycle。</p>
                      <SettingsField label="内容">
                        <textarea
                          rows={4}
                          value={block.content}
                          onChange={(e) =>
                            setPersist((prev) =>
                              prev.map((b, i) =>
                                i === index && b.type === "text"
                                  ? { ...b, content: e.target.value }
                                  : b,
                              ),
                            )
                          }
                        />
                      </SettingsField>
                    </>
                  ) : (
                    <p className="config-block-card__hint">
                      worktree 块注入 materialize 后的会话树 display（非宏）。
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="config-block-card config-block-card--prompt config-block-card--readonly">
            <div className="config-block-card__header">
              <span className="config-block-card__badge">Chat</span>
              <span className="config-block-card__meta">会话历史</span>
            </div>
            <p className="config-block-card__hint">
              运行时注入当前会话可见消息，不可配置、不可排序。
            </p>
          </div>

          <div className="config-block-card__section-head">
            <span className="config-block-card__section-label">Dynamic 块</span>
            <button
              type="button"
              className="settings-link-btn"
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setAddBlockMenu({
                  x: Math.max(8, rect.right - 140),
                  y: Math.max(8, rect.bottom + 4),
                  target: "dynamic",
                });
              }}
            >
              添加
            </button>
          </div>
          <div className="config-block-list">
            {dynamic.map((block, index) => (
              <div key={`dynamic-${index}`} className="config-block-card config-block-card--prompt">
                <div className="config-block-card__header">
                  <span className="config-block-card__badge">{blockTypeLabel(block.type)}</span>
                  <span className="config-block-card__meta">{block.name}</span>
                  {renderBlockActions(index, dynamic.length, moveDynamic, deleteDynamic)}
                </div>
                <div className="config-block-card__body">
                  <SettingsField label="名称">
                    <input
                      value={block.name}
                      onChange={(e) =>
                        setDynamic((prev) =>
                          prev.map((b, i) => (i === index ? { ...b, name: e.target.value } : b)),
                        )
                      }
                    />
                  </SettingsField>
                  <SettingsField label="角色">
                    <select
                      value={block.role}
                      onChange={(e) =>
                        setDynamic((prev) =>
                          prev.map((b, i) =>
                            i === index
                              ? { ...b, role: e.target.value as DynamicPromptBlock["role"] }
                              : b,
                          ),
                        )
                      }
                    >
                      {ROLE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </SettingsField>
                  <div className="config-block-card__switch-row">
                    <span className="config-block-card__switch-label">常驻</span>
                    <Switch
                      checked={isDynamicBlockPersistent(block)}
                      onChange={(persistent) =>
                        setDynamic((prev) =>
                          prev.map((b, i) =>
                            i === index ? withDynamicBlockPersistence(b, persistent) : b,
                          ),
                        )
                      }
                      aria-label="常驻"
                    />
                  </div>
                  {!isDynamicBlockPersistent(block) ? (
                    <p className="config-block-card__hint config-block-card__hint--subtle config-block-card__switch-hint">
                      lifecycle: once — 仅首轮 agent step 带入。
                    </p>
                  ) : null}
                  <SettingsField label="内容">
                    <textarea
                      ref={dynamicInsertIndex === index ? dynamicTextareaRef : undefined}
                      rows={4}
                      value={block.content}
                      onFocus={() => setDynamicInsertIndex(index)}
                      onChange={(e) =>
                        setDynamic((prev) =>
                          prev.map((b, i) =>
                            i === index ? { ...b, content: e.target.value } : b,
                          ),
                        )
                      }
                    />
                  </SettingsField>
                  <div className="config-dep-chips">
                    <span className="config-block-card__hint">宏：</span>
                    {DYNAMIC_MACROS.map((macro) => (
                      <button
                        key={macro.token}
                        type="button"
                        className="config-dep-chip"
                        onClick={() => {
                          setDynamicInsertIndex(index);
                          setDynamic((prev) =>
                            prev.map((b, i) =>
                              i === index
                                ? {
                                    ...b,
                                    content: insertAtCursor(
                                      b.content,
                                      macro.token,
                                      dynamicInsertIndex === index
                                        ? dynamicTextareaRef.current
                                        : null,
                                    ),
                                  }
                                : b,
                            ),
                          );
                        }}
                      >
                        {macro.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SettingsSection>
      </SettingsFormSection>
      <ContextMenu
        open={addBlockMenu != null}
        x={addBlockMenu?.x ?? 0}
        y={addBlockMenu?.y ?? 0}
        items={
          addBlockMenu?.target === "dynamic"
            ? [{ label: "文本块", action: "dynamic-text" }]
            : [
                { label: "文本块", action: "persist-text" },
                { label: "Worktree 块", action: "persist-worktree" },
              ]
        }
        onSelect={(action) => {
          if (action === "persist-text") addPersistBlock("text");
          else if (action === "persist-worktree") addPersistBlock("worktree");
          else if (action === "dynamic-text") addDynamicBlock();
        }}
        onClose={() => setAddBlockMenu(null)}
      />
      <ConfirmModal
        open={confirmImport}
        title="导入 YAML"
        message="将覆盖当前 Agent 配置，是否继续？"
        onConfirm={() => {
          setConfirmImport(false);
          void ipcAgentYamlImport({ agentId }).then((r) => {
            if (r.ok && r.data === "imported") {
              void loadAgent();
              showToast("已导入 Agent YAML");
            } else if (!r.ok) {
              showToast(r.error.message);
            }
          });
        }}
        onCancel={() => setConfirmImport(false)}
      />
    </SettingsPanel>
  );
}
