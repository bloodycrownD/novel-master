/**
 * 项目智能体配置页：压缩配置式开关（关=跟随全局，开=项目专属）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { type AgentDefinition } from "@novel-master/core/agent";
import {
  assessAgentDefinitionWire,
  buildDefaultAgentDefinitionPreservingName,
  resolveAgentDefinitionFromStorage,
} from "@novel-master/core/config-forms/stored-config-validity";
import type { ProjectAgentModeDto } from "@shared/ipc-types";
import { Button } from "@/components/ui/Button";
import { showToast } from "@/components/ui/show-toast";
import { toastSettingsError, toastSettingsSuccess } from "@/utils/settings-feedback";
import {
  ipcAgentRegistryGet,
  ipcAgentResolveCurrent,
  ipcProjectsGetAgentConfig,
  ipcProjectsUpdateAgentConfig,
} from "@/ipc/client";
import {
  AgentDefinitionEditorForm,
  type AgentDefinitionEditorFormHandle,
} from "./AgentDefinitionEditorForm";
import { SettingsFormSection, SettingsSwitchRow } from "./settings-ui";

export type ProjectAgentConfigViewProps = {
  open: boolean;
  projectId: string;
  projectName: string;
  onClose: () => void;
  onSaved?: () => void;
};

/** 克隆当前全局 Agent 定义；无全局 Agent 时用默认模板。 */
async function cloneGlobalAgentDefinition(): Promise<AgentDefinition> {
  const currentRes = await ipcAgentResolveCurrent();
  const fallbackName = currentRes.ok ? currentRes.data.agentName : "项目专属 Agent";

  if (currentRes.ok && currentRes.data.agentId) {
    const agentRes = await ipcAgentRegistryGet({ agentId: currentRes.data.agentId });
    if (agentRes.ok) {
      const health = assessAgentDefinitionWire(agentRes.data.wire);
      if (health.status === "valid") {
        return structuredClone(health.value);
      }
    }
  }

  return buildDefaultAgentDefinitionPreservingName(fallbackName);
}

function definitionFromStored(stored: unknown): AgentDefinition | undefined {
  if (stored == null) {
    return undefined;
  }
  const health = resolveAgentDefinitionFromStorage(stored);
  if (health.status === "valid") {
    return health.value;
  }
  return undefined;
}

export function ProjectAgentConfigView({
  open,
  projectId,
  projectName,
  onClose,
  onSaved,
}: ProjectAgentConfigViewProps) {
  const formRef = useRef<AgentDefinitionEditorFormHandle>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<ProjectAgentModeDto>("follow");
  const [globalAgentName, setGlobalAgentName] = useState("—");
  const [formDefinition, setFormDefinition] = useState<AgentDefinition | null>(null);
  const [formResetKey, setFormResetKey] = useState(0);
  const draftDefinitionRef = useRef<AgentDefinition | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [configRes, globalRes] = await Promise.all([
        ipcProjectsGetAgentConfig({ projectId }),
        ipcAgentResolveCurrent(),
      ]);

      if (!configRes.ok) {
        setLoadError(configRes.error.message);
        return;
      }

      if (globalRes.ok) {
        setGlobalAgentName(globalRes.data.agentName);
      }

      setMode(configRes.data.mode);
      const storedDef = definitionFromStored(configRes.data.definition);
      if (storedDef) {
        draftDefinitionRef.current = storedDef;
        setFormDefinition(storedDef);
      } else {
        draftDefinitionRef.current = null;
        setFormDefinition(null);
      }
      setFormResetKey((k) => k + 1);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load]);

  const ensureCustomDefinition = useCallback(async (): Promise<AgentDefinition> => {
    if (draftDefinitionRef.current) {
      return draftDefinitionRef.current;
    }
    const cloned = await cloneGlobalAgentDefinition();
    draftDefinitionRef.current = cloned;
    return cloned;
  }, []);

  const handleModeChange = useCallback(
    (nextMode: ProjectAgentModeDto) => {
      if (mode === "custom" && formRef.current) {
        const built = formRef.current.buildDefinition();
        if (built.ok) {
          draftDefinitionRef.current = built.definition;
        }
      }

      setMode(nextMode);
      if (nextMode === "custom") {
        void (async () => {
          const def = await ensureCustomDefinition();
          setFormDefinition(def);
          setFormResetKey((k) => k + 1);
        })();
      }
    },
    [mode, ensureCustomDefinition],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      if (mode === "follow") {
        const patch: { mode: ProjectAgentModeDto; definition?: AgentDefinition } = {
          mode: "follow",
        };
        if (draftDefinitionRef.current) {
          patch.definition = draftDefinitionRef.current;
        } else if (formRef.current) {
          const built = formRef.current.buildDefinition();
          if (built.ok) {
            draftDefinitionRef.current = built.definition;
            patch.definition = built.definition;
          }
        }
        const res = await ipcProjectsUpdateAgentConfig({ projectId, patch });
        if (res.ok) {
          toastSettingsSuccess("已保存项目智能体配置");
          onSaved?.();
          onClose();
        } else {
          toastSettingsError(res.error.message);
        }
        return;
      }

      const built = formRef.current?.buildDefinition();
      if (!built?.ok) {
        showToast(built?.message ?? "表单校验失败");
        return;
      }
      draftDefinitionRef.current = built.definition;
      const res = await ipcProjectsUpdateAgentConfig({
        projectId,
        patch: { mode: "custom", definition: built.definition },
      });
      if (res.ok) {
        formRef.current?.markSaved();
        toastSettingsSuccess("已保存项目智能体配置");
        onSaved?.();
        onClose();
      } else {
        toastSettingsError(res.error.message);
      }
    } finally {
      setSaving(false);
    }
  }, [mode, projectId, onClose, onSaved]);

  if (!open) {
    return null;
  }

  const customEnabled = mode === "custom";

  return (
    <div className="text-prompt-overlay" onClick={onClose}>
      <div
        className="text-prompt-modal text-prompt-modal--wide project-agent-config-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-agent-config-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="project-agent-config-modal__header">
          <h3 id="project-agent-config-title" className="project-agent-config-modal__title">
            智能体配置
          </h3>
          <p className="project-agent-config-modal__subtitle">{projectName}</p>
        </header>

        {loading ? (
          <p className="settings-hint">加载中…</p>
        ) : loadError ? (
          <div className="settings-error-panel">
            <p className="settings-error-panel__message">{loadError}</p>
            <Button variant="secondary" onClick={onClose}>
              关闭
            </Button>
          </div>
        ) : (
          <>
            <SettingsFormSection
              title="项目智能体配置"
              desc="关闭时跟随全局智能体；开启后为本项目单独配置，会话中将显示「项目智能体」。"
            >
              <SettingsSwitchRow
                label="启用项目专属智能体"
                checked={customEnabled}
                onChange={(next) => handleModeChange(next ? "custom" : "follow")}
              />

              {!customEnabled ? (
                <div className="project-agent-config-modal__follow">
                  <p className="settings-hint">
                    跟随全局：<strong>{globalAgentName}</strong>
                  </p>
                  <p className="settings-hint settings-hint--subtle">
                    全局 Agent 变更后，本项目将自动使用新的全局配置；关闭专属配置时会保留自定义草稿但不生效。
                  </p>
                </div>
              ) : formDefinition ? (
                <div className="project-agent-config-modal__custom">
                  <p className="settings-hint settings-hint--subtle">
                    以下为项目专属 Agent 配置，不会写入全局 Agent 列表。
                  </p>
                  <AgentDefinitionEditorForm
                    ref={formRef}
                    definition={formDefinition}
                    resetKey={formResetKey}
                    onSubmitShortcut={() => void handleSave()}
                  />
                </div>
              ) : (
                <p className="settings-hint">正在准备表单…</p>
              )}
            </SettingsFormSection>

            <div className="project-agent-config-modal__actions">
              <Button variant="secondary" disabled={saving} onClick={onClose}>
                取消
              </Button>
              <Button variant="primary" disabled={saving} onClick={() => void handleSave()}>
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
