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
  toolsFromDefinition,
  type ToolsMode,
} from "@novel-master/config-forms/agent";
import { Button } from "../../components/ui/Button";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { Switch } from "../../components/ui/Switch";
import { showToast } from "../../components/ui/show-toast";
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
  SettingsStatus,
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
  const [toolsList, setToolsList] = useState("");
  const [providers, setProviders] = useState<Array<{ id: string; label: string }>>([]);
  const [savedModels, setSavedModels] = useState<
    Array<{ vendorModelId: string; displayName: string }>
  >([]);
  const [savedBaseline, setSavedBaseline] = useState<string | null>(null);
  const [status, setStatus] = useState<string | undefined>();
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
        toolsList,
        prompts,
      }),
    [name, maxSteps, modelEnabled, providerId, vendorModelId, toolsMode, toolsList, prompts],
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
        setStatus(agentRes.error.message);
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
        showToast("\u5df2\u79fb\u9664\u5df2\u5e9f\u5f03\u7684\u6458\u8981\u5757\uff08abstract\uff09");
      }
      const toolsWire = toolsFromDefinition(def);
      setToolsMode(toolsWire.mode);
      setToolsList(toolsWire.listText);

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
          toolsList: toolsWire.listText,
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
    return <p className="settings-hint">\u7f3a\u5c11 agentId</p>;
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
      toolsList,
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
        setStatus("\u5df2\u4fdd\u5b58");
        showToast("\u5df2\u4fdd\u5b58 Agent \u914d\u7f6e");
      } else {
        setStatus(saveRes.error.message);
        showToast(saveRes.error.message);
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
      showToast("\u81f3\u5c11\u4fdd\u7559\u4e00\u4e2a Prompt \u5757");
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
      {loading ? <p className="settings-hint">\u52a0\u8f7d\u4e2d\u2026</p> : null}
      <SettingsFormSection
        title="Agent \u914d\u7f6e"
        desc={`\u7f16\u8f91 ${agentId}${dirty ? " \u00b7 \u672a\u4fdd\u5b58" : ""}`}
        footer={
          <div className="settings-form-actions settings-form-actions--solo">
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? "\u4fdd\u5b58\u4e2d\u2026" : "\u4fdd\u5b58"}
            </Button>
            <div className="settings-yaml-links">
              <button type="button" className="settings-link-btn" onClick={() => setConfirmImport(true)}>
                \u5bfc\u5165 YAML
              </button>
              <button
                type="button"
                className="settings-link-btn"
                onClick={() =>
                  void ipcAgentYamlExport({ agentId }).then((r) => {
                    if (r.ok && r.data === "saved") showToast("\u5df2\u5bfc\u51fa Agent YAML");
                    else if (!r.ok) showToast(r.error.message);
                  })
                }
              >
                \u5bfc\u51fa YAML
              </button>
            </div>
          </div>
        }
      >
        <SettingsSection title="\u57fa\u672c\u4fe1\u606f">
          <SettingsField label="\u540d\u79f0">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </SettingsField>
        </SettingsSection>

        <SettingsSection title="\u6a21\u578b">
          <div className="settings-row settings-row--switch">
            <span className="settings-row__label">\u4e13\u5c5e\u6a21\u578b</span>
            <Switch checked={modelEnabled} onChange={setModelEnabled} aria-label="\u4e13\u5c5e\u6a21\u578b" />
          </div>
          {!modelEnabled ? (
            <p className="settings-hint">\u672a\u542f\u7528\u65f6\u8ddf\u968f\u5de5\u4f5c\u533a\u5f53\u524d\u6a21\u578b\uff08\u4f1a\u8bdd\u64cd\u4f5c\u62bd\u5c49 / \u6211\u7684\uff09\u3002</p>
          ) : (
            <>
              <SettingsField label="\u670d\u52a1\u5546">
                <select value={providerId} onChange={(e) => void handleProviderChange(e.target.value)}>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </SettingsField>
              <SettingsField label="\u6a21\u578b">
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
              <p className="settings-hint">model: {preferredModelId ?? "\u2014"}</p>
            </>
          )}
        </SettingsSection>

        <SettingsSection title="\u8fd0\u884c\u65f6">
          <SettingsField label="\u6700\u5927\u6b65\u6570 maxSteps">
            <input type="number" min={1} value={maxSteps} onChange={(e) => setMaxSteps(e.target.value)} />
          </SettingsField>
        </SettingsSection>

        <SettingsSection title="\u5de5\u5177\u7b56\u7565">
          <SettingsField label="\u6a21\u5f0f">
            <select value={toolsMode} onChange={(e) => setToolsMode(e.target.value as ToolsMode)}>
              {TOOL_MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SettingsField>
          {toolsMode !== "default" ? (
            <SettingsField label={toolsMode === "allow" ? "\u767d\u540d\u5355\u5de5\u5177\u540d" : "\u9ed1\u540d\u5355\u5de5\u5177\u540d"}>
              <textarea
                rows={3}
                value={toolsList}
                onChange={(e) => setToolsList(e.target.value)}
                placeholder="vfs.read, vfs.grep"
              />
            </SettingsField>
          ) : (
            <p className="settings-hint">\u672a\u914d\u7f6e\u65f6\u4f7f\u7528\u5168\u90e8\u5df2\u6ce8\u518c\u5de5\u5177\uff08vfs.read\u3001vfs.write \u7b49\uff09\u3002</p>
          )}
        </SettingsSection>

        <SettingsSection title="Prompt \u5757">
          <div className="settings-section__actions">
            <button type="button" className="settings-link-btn" onClick={() => setAddBlockMenu((v) => !v)}>
              \u6dfb\u52a0
            </button>
          </div>
          {addBlockMenu ? (
            <div className="settings-inline-actions">
              <Button variant="secondary" onClick={() => addBlock("text")}>
                \u6587\u672c\u5757
              </Button>
              <Button variant="secondary" onClick={() => addBlock("chat")}>
                \u4f1a\u8bdd\u5757
              </Button>
            </div>
          ) : null}
          <div className="config-block-list">
            {prompts.map((block, index) => (
              <div key={`prompt-${index}`} className="config-block-card">
                <div className="config-block-card__header">
                  <span className="config-block-card__badge">{blockTypeLabel(block.type)}</span>
                  <span className="config-block-card__name">{block.name}</span>
                  <div className="config-block-card__actions">
                    {index > 0 ? (
                      <button type="button" className="icon-btn" onClick={() => moveBlock(index, -1)}>
                        \u2191
                      </button>
                    ) : null}
                    {index < prompts.length - 1 ? (
                      <button type="button" className="icon-btn" onClick={() => moveBlock(index, 1)}>
                        \u2193
                      </button>
                    ) : null}
                    <button type="button" className="icon-btn" onClick={() => deleteBlock(index)}>
                      \u00d7
                    </button>
                  </div>
                </div>
                <SettingsField label="\u540d\u79f0">
                  <input value={block.name} onChange={(e) => updateBlock(index, { name: e.target.value })} />
                </SettingsField>
                {block.type === "text" ? (
                  <>
                    <SettingsField label="\u89d2\u8272">
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
                    <p className="settings-hint">
                      \u4ec5 system \u6587\u672c\u5757\u4f1a\u5408\u5e76\u8fdb LLM system\uff1b\u4f1a\u8bdd\u5386\u53f2\u8bf7\u7528 chat \u5757\u3002
                    </p>
                    <SettingsField label="\u5185\u5bb9">
                      <textarea
                        rows={4}
                        value={block.content}
                        onChange={(e) => updateBlock(index, { type: "text", content: e.target.value })}
                      />
                    </SettingsField>
                  </>
                ) : (
                  <p className="settings-hint">chat \u5757\u5c06\u4f1a\u8bdd\u6d88\u606f\u6ce8\u5165\u6a21\u578b\u4e0a\u4e0b\u6587\uff0c\u901a\u5e38\u653e\u5728 prompt \u5217\u8868\u672b\u5c3e\u3002</p>
                )}
              </div>
            ))}
          </div>
        </SettingsSection>
      </SettingsFormSection>
      <SettingsStatus message={status} />
      <ConfirmModal
        open={confirmImport}
        title="\u5bfc\u5165 YAML"
        message="\u5c06\u8986\u76d6\u5f53\u524d Agent \u914d\u7f6e\uff0c\u662f\u5426\u7ee7\u7eed\uff1f"
        onConfirm={() => {
          setConfirmImport(false);
          void ipcAgentYamlImport({ agentId }).then((r) => {
            if (r.ok && r.data === "imported") {
              void loadAgent();
              showToast("\u5df2\u5bfc\u5165 Agent YAML");
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