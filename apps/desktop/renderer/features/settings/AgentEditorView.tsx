import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentDefinition, PromptBlock, PromptBlockRole } from "@novel-master/core";
import {
  ROLE_OPTIONS,
  TOOL_MODE_OPTIONS,
  blockTypeLabel,
  buildAgentDefinitionFromForm,
  createDefaultChatBlock,
  createDefaultTextBlock,
  formatApplicationModelId,
  formSnapshotJson,
  parseApplicationModelId,
  stripRemovedPromptBlocks,
  toolsSelectionFromDefinition,
  type ToolsMode,
} from "@novel-master/config-forms/agent";
import { ToolPolicyPicker } from "./ToolPolicyPicker";
import { Button } from "../../components/ui/Button";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { Switch } from "../../components/ui/Switch";
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

type Nav = {
  push: (viewId: string) => void;
  navState: SettingsNavState;
};

export function AgentEditorView({ nav }: { nav: Nav }) {
  const agentId = nav.navState.editingAgentId;
  const [name, setName] = useState("");
  const [maxSteps, setMaxSteps] = useState("20");
  const [modelEnabled, setModelEnabled] = useState(false);
  const [providerId, setProviderId] = useState("");
  const [vendorModelId, setVendorModelId] = useState("");
  const [prompts, setPrompts] = useState<PromptBlock[]>([]);
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
  const [addBlockMenu, setAddBlockMenu] = useState(false);

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
        prompts,
      }),
    [name, maxSteps, modelEnabled, providerId, vendorModelId, toolsMode, toolsSelected, prompts],
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
      setName(def.name ?? "");
      setMaxSteps(String(def.runtime?.maxSteps ?? 20));
      const { prompts: loadedPrompts, removed } = stripRemovedPromptBlocks(def.prompts ?? []);
      if (loadedPrompts.length === 0) {
        setPrompts([createDefaultTextBlock(0)]);
      } else {
        setPrompts(loadedPrompts);
      }
      if (removed > 0) {
        showToast("已移除已废弃的摘要块（abstract）");
      }
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
          prompts: loadedPrompts.length > 0 ? loadedPrompts : [createDefaultTextBlock(0)],
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
      prompts,
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

  const updateBlock = (index: number, patch: Partial<PromptBlock>) => {
    setPrompts((prev) =>
      prev.map((block, i) => (i === index ? ({ ...block, ...patch } as PromptBlock) : block)),
    );
  };

  const moveBlock = (index: number, dir: -1 | 1) => {
    setPrompts((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      const tmp = next[target]!;
      next[target] = next[index]!;
      next[index] = tmp;
      return next;
    });
  };

  const deleteBlock = (index: number) => {
    if (prompts.length <= 1) {
      showToast("至少保留一个 Prompt 块");
      return;
    }
    setPrompts((prev) => prev.filter((_, i) => i !== index));
  };

  const addBlock = (kind: "text" | "chat") => {
    setPrompts((prev) =>
      kind === "text"
        ? [...prev, createDefaultTextBlock(prev.length)]
        : [...prev, createDefaultChatBlock()],
    );
    setAddBlockMenu(false);
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

        <SettingsSection title="Prompt 块">
          <div className="config-block-card__section-head">
            <span className="config-block-card__section-label">块列表</span>
            <button type="button" className="settings-link-btn" onClick={() => setAddBlockMenu((v) => !v)}>
              添加
            </button>
          </div>
          {addBlockMenu ? (
            <div className="config-inline-actions">
              <Button variant="secondary" onClick={() => addBlock("text")}>
                文本块
              </Button>
              <Button variant="secondary" onClick={() => addBlock("chat")}>
                会话块
              </Button>
            </div>
          ) : null}
          <div className="config-block-list">
            {prompts.map((block, index) => (
              <div key={`prompt-${index}`} className="config-block-card config-block-card--prompt">
                <div className="config-block-card__header">
                  <span className="config-block-card__badge">{blockTypeLabel(block.type)}</span>
                  <span className="config-block-card__meta">{block.name}</span>
                  <div className="config-block-card__actions">
                    {index > 0 ? (
                      <button type="button" className="icon-btn" onClick={() => moveBlock(index, -1)} aria-label="上移">
                        ↑
                      </button>
                    ) : null}
                    {index < prompts.length - 1 ? (
                      <button type="button" className="icon-btn" onClick={() => moveBlock(index, 1)} aria-label="下移">
                        ↓
                      </button>
                    ) : null}
                    <button type="button" className="icon-btn" onClick={() => deleteBlock(index)} aria-label="删除">
                      ×
                    </button>
                  </div>
                </div>
                <div className="config-block-card__body">
                  <SettingsField label="名称">
                    <input value={block.name} onChange={(e) => updateBlock(index, { name: e.target.value })} />
                  </SettingsField>
                  {block.type === "text" ? (
                    <>
                      <SettingsField label="角色">
                        <select
                          value={block.role}
                          onChange={(e) =>
                            updateBlock(index, {
                              type: "text",
                              role: e.target.value as PromptBlockRole,
                            })
                          }
                        >
                          {ROLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </SettingsField>
                      <p className="config-block-card__hint">
                        仅 system 文本块会合并进 LLM system；会话历史请用 chat 块。
                      </p>
                      <SettingsField label="内容">
                        <textarea
                          rows={4}
                          value={block.content}
                          onChange={(e) => updateBlock(index, { type: "text", content: e.target.value })}
                        />
                      </SettingsField>
                    </>
                  ) : (
                    <p className="config-block-card__hint">
                      chat 块将会话消息注入模型上下文，通常放在 prompt 列表末尾。
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </SettingsSection>
      </SettingsFormSection>
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