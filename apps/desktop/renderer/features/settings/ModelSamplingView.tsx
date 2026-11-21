import { useCallback, useEffect, useState } from "react";
import { coreT } from "@shared/logic/core-i18n";
import {
  THINKING_LEVEL_SELECT_OPTIONS,
  TOKEN_COUNTER_MODE_SELECT_OPTIONS,
  type LlmProtocolKind,
  type ModelSamplingParams,
  type ThinkingLevel,
  type TokenizerOverride,
} from "@shared/logic/provider";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { toastSettingsError, toastSettingsSuccess } from "@/utils/settings-feedback";
import {
  ipcProviderModelsEditSaved,
  ipcProviderModelsGetSaved,
  ipcProviderModelsResetContextWindow,
  ipcProviderModelsUpdateSettings,
  ipcProvidersGet,
} from "@/ipc/client";
import type { SettingsNavState } from "./settings-nav";
import { SamplingForm } from "./SamplingForm";
import {
  SettingsField,
  SettingsFormSection,
  SettingsPanel,
  SettingsSection,
} from "./settings-ui";

type Nav = {
  push: (view: string) => void;
  pop: () => void;
  navState: SettingsNavState;
};

/** v2 已保存模型 settings 形态（handler 返回嵌套结构）。 */
type SavedModelSettingsV2 = {
  readonly internal: {
    readonly contextWindowTokens: number;
    readonly tokenCounterMode: TokenizerOverride;
  };
  readonly generation: {
    readonly sampling: {
      readonly enabled: boolean;
      readonly params?: ModelSamplingParams;
    };
    readonly thinkingLevel: ThinkingLevel;
  };
};

function paramsEmpty(params: ModelSamplingParams | undefined): boolean {
  if (!params) {
    return true;
  }
  if (params.protocol === "openai") {
    return Object.keys(params.openai).length === 0;
  }
  if (params.protocol === "anthropic") {
    return Object.keys(params.anthropic).length === 0;
  }
  if (params.protocol === "gemini") {
    return Object.keys(params.gemini).length === 0;
  }
  return true;
}

export function ModelSamplingView({ nav }: { nav: Nav }) {
  const savedModelId = nav.navState.editingSavedModelId;
  const [modelName, setModelName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [vendorModelId, setVendorModelId] = useState("");
  const [protocol, setProtocol] = useState<LlmProtocolKind>("openai");
  const [params, setParams] = useState<ModelSamplingParams | undefined>();
  const [contextWindowTokens, setContextWindowTokens] = useState("");
  const [tokenCounterMode, setTokenCounterMode] = useState<TokenizerOverride>("auto");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("off");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    if (!savedModelId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const savedRes = await ipcProviderModelsGetSaved({ savedModelId });
      if (!savedRes.ok || !savedRes.data) {
        return;
      }
      const saved = savedRes.data;
      setModelName(saved.modelName);
      setDisplayName(saved.displayName);
      setVendorModelId(saved.vendorModelId);
      const providerRes = await ipcProvidersGet({ providerId: saved.providerId });
      if (providerRes.ok && providerRes.data) {
        setProtocol(providerRes.data.protocol as LlmProtocolKind);
      }
      const { settings } = saved as { settings: SavedModelSettingsV2 };
      const { internal, generation } = settings;
      setContextWindowTokens(String(internal.contextWindowTokens));
      setTokenCounterMode(internal.tokenCounterMode);
      const stored = generation.sampling.enabled && generation.sampling.params != null ? generation.sampling.params : undefined;
      setParams(stored);
      setThinkingLevel(generation.thinkingLevel);
    } finally {
      setLoading(false);
    }
  }, [savedModelId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!savedModelId) {
    return <p className="settings-hint">{coreT({key: "ui.sampling.model_missing"})}</p>;
  }

  const saveModelName = async () => {
    const trimmed = modelName.trim();
    if (!trimmed) {
      toastSettingsError(coreT({key: "ui.sampling.name_required"}));
      return;
    }
    setRenaming(true);
    try {
      const res = await ipcProviderModelsEditSaved({
        savedModelId,
        modelName: trimmed,
      });
      if (!res.ok) {
        toastSettingsError(res.error.message);
        return;
      }
      setModelName(res.data.modelName);
      setDisplayName(res.data.displayName);
      toastSettingsSuccess(coreT({key: "ui.provider.model_renamed_done"}));
    } finally {
      setRenaming(false);
    }
  };

  const save = async () => {
    const contextWindow = Number(contextWindowTokens);
    if (!Number.isInteger(contextWindow) || contextWindow <= 0) {
      toastSettingsError(coreT({key: "ui.sampling.context_limit_positive"}));
      return;
    }
    setSaving(true);
    try {
      const sampling = paramsEmpty(params) || !params ? { enabled: false as const } : { enabled: true as const, params };
      const res = await ipcProviderModelsUpdateSettings({
        savedModelId,
        contextWindowTokens: contextWindow,
        tokenCounterMode,
        sampling,
        thinkingLevel,
      });
      if (!res.ok) {
        toastSettingsError(res.error.message);
        return;
      }
      toastSettingsSuccess(coreT({key: "ui.sampling.saved_done"}));
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = async () => {
    setResetting(true);
    try {
      const resetRes = await ipcProviderModelsResetContextWindow({ savedModelId });
      if (!resetRes.ok) {
        toastSettingsError(resetRes.error.message);
        return;
      }
      const clearRes = await ipcProviderModelsUpdateSettings({
        savedModelId,
        sampling: { enabled: false },
      });
      if (!clearRes.ok) {
        toastSettingsError(clearRes.error.message);
        return;
      }
      if (resetRes.data) {
        const saved = resetRes.data as { settings: SavedModelSettingsV2 };
        setContextWindowTokens(String(saved.settings.internal.contextWindowTokens));
      }
      setParams(undefined);
      toastSettingsSuccess(coreT({key: "ui.sampling.reset_done"}));
    } finally {
      setResetting(false);
    }
  };

  const sectionHint = `${displayName || savedModelId}\n${coreT({key: "ui.sampling.vendor_id_line", params: {id: vendorModelId}})}\n${coreT({key: "ui.sampling.section_hint_plain"})}`;

  return (
    <SettingsPanel>
      {loading ? <p className="settings-hint">{coreT({key: "ui.common.loading"})}</p> : null}

      <SettingsSection
        title={coreT({key: "ui.common.model_name"})}
        desc={coreT({key: "ui.sampling.model_name_hint"})}
      >
        <div className="settings-fields">
          <SettingsField label={coreT({key: "ui.common.model_name"})}>
            <input
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder={coreT({key: "ui.sampling.model_name_placeholder_hint"})}
            />
          </SettingsField>
          <SettingsField label={coreT({key: "ui.sampling.display_name_derived"})}>
            <input value={displayName} readOnly disabled />
          </SettingsField>
        </div>
        <Button
          variant="secondary"
          disabled={renaming || loading}
          onClick={() => void saveModelName()}
        >
          {renaming ? coreT({key: "ui.common.saving"}) : coreT({key: "ui.sampling.save_name_label"})}
        </Button>
      </SettingsSection>

      <SettingsSection
        title={coreT({key: "ui.sampling.internal_budget_section"})}
        desc={coreT({key: "ui.sampling.internal_budget_hint"})}
      >
        <div className="settings-fields">
          <SettingsField label={coreT({key: "ui.sampling.context_limit_label"})}>
            <input
              type="number"
              value={contextWindowTokens}
              onChange={(e) => setContextWindowTokens(e.target.value)}
            />
          </SettingsField>
          <SettingsField label={coreT({key: "ui.sampling.counting_method_label"})}>
            <select
              value={tokenCounterMode}
              onChange={(e) => setTokenCounterMode(e.target.value as TokenizerOverride)}
            >
              {TOKEN_COUNTER_MODE_SELECT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsFormSection
        title={coreT({key: "ui.sampling.generation_section"})}
        desc={sectionHint}
        toolbar={
          <button
            type="button"
            className="settings-link-btn"
            disabled={resetting || loading}
            onClick={() => void resetDefaults()}
          >
            {resetting ? coreT({key: "ui.common.restoring"}) : coreT({key: "ui.common.reset_default"})}
          </button>
        }
        footer={
          <Button variant="primary" disabled={saving || loading} onClick={() => void save()}>
            {saving ? coreT({key: "ui.common.saving"}) : coreT({key: "ui.common.save"})}
          </Button>
        }
      >
        <SamplingForm protocol={protocol} params={params} onChange={setParams} />
        <SettingsField label={coreT({key: "ui.sampling.thinking_effort_label"})}>
          <SegmentedControl
            aria-label={coreT({key: "ui.sampling.thinking_effort_label"})}
            value={thinkingLevel}
            options={THINKING_LEVEL_SELECT_OPTIONS}
            onChange={setThinkingLevel}
          />
        </SettingsField>
      </SettingsFormSection>
    </SettingsPanel>
  );
}
