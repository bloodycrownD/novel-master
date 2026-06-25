import { useCallback, useEffect, useState } from "react";
import { parseApplicationModelId, TOKEN_COUNTER_MODE_SELECT_OPTIONS, type LlmProtocolKind, type ModelSamplingParams, type TokenizerOverride } from "@novel-master/core/provider";
import { Button } from "@/components/ui/Button";
import { toastSettingsError, toastSettingsSuccess } from "@/utils/settings-feedback";
import {
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
  SettingsSwitchRow,
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
    readonly thinking: {
      readonly enabled: boolean;
    };
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
  const applicationModelId = nav.navState.editingApplicationModelId;
  const [protocol, setProtocol] = useState<LlmProtocolKind>("openai");
  const [params, setParams] = useState<ModelSamplingParams | undefined>();
  const [contextWindowTokens, setContextWindowTokens] = useState("");
  const [tokenCounterMode, setTokenCounterMode] = useState<TokenizerOverride>("auto");
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    if (!applicationModelId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { providerId } = parseApplicationModelId(applicationModelId);
      const providerRes = await ipcProvidersGet({ providerId });
      if (providerRes.ok && providerRes.data) {
        setProtocol(providerRes.data.protocol as LlmProtocolKind);
      }
      const savedRes = await ipcProviderModelsGetSaved({ applicationModelId });
      if (!savedRes.ok || !savedRes.data) {
        return;
      }
      const saved = savedRes.data as { settings: SavedModelSettingsV2 };
      const { internal, generation } = saved.settings;
      setContextWindowTokens(String(internal.contextWindowTokens));
      setTokenCounterMode(internal.tokenCounterMode);
      const stored =
        generation.sampling.enabled && generation.sampling.params != null
          ? generation.sampling.params
          : undefined;
      setParams(stored);
      setThinkingEnabled(generation.thinking.enabled);
    } finally {
      setLoading(false);
    }
  }, [applicationModelId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!applicationModelId) {
    return <p className="settings-hint">缺少模型</p>;
  }

  const save = async () => {
    const { providerId, vendorModelId } = parseApplicationModelId(applicationModelId);
    const contextWindow = Number(contextWindowTokens);
    if (!Number.isInteger(contextWindow) || contextWindow <= 0) {
      toastSettingsError("上下文上限须为正整数");
      return;
    }
    setSaving(true);
    try {
      const sampling =
        paramsEmpty(params) || !params
          ? { enabled: false as const }
          : { enabled: true as const, params };
      const res = await ipcProviderModelsUpdateSettings({
        providerId,
        vendorModelId,
        contextWindowTokens: contextWindow,
        tokenCounterMode,
        sampling,
        thinking: { enabled: thinkingEnabled },
      });
      if (!res.ok) {
        toastSettingsError(res.error.message);
        return;
      }
      toastSettingsSuccess("已保存模型设置");
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = async () => {
    const { providerId, vendorModelId } = parseApplicationModelId(applicationModelId);
    setResetting(true);
    try {
      const resetRes = await ipcProviderModelsResetContextWindow({ providerId, vendorModelId });
      if (!resetRes.ok) {
        toastSettingsError(resetRes.error.message);
        return;
      }
      const clearRes = await ipcProviderModelsUpdateSettings({
        providerId,
        vendorModelId,
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
      toastSettingsSuccess("已恢复默认采样参数");
    } finally {
      setResetting(false);
    }
  };

  const sectionHint = `${applicationModelId}\n展示协议推荐默认值；保存后以本页为准。`;

  return (
    <SettingsPanel>
      {loading ? <p className="settings-hint">加载中…</p> : null}

      <SettingsSection
        title="内部预算"
        desc="上下文窗口与 token 计数方式，不直接映射 HTTP 生成 body。"
      >
        <SettingsField label="上下文上限 (tokens)">
          <input
            type="number"
            value={contextWindowTokens}
            onChange={(e) => setContextWindowTokens(e.target.value)}
          />
        </SettingsField>
        <SettingsField label="计数方式">
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
      </SettingsSection>

      <SettingsFormSection
        title="生成参数"
        desc={sectionHint}
        toolbar={
          <button
            type="button"
            className="settings-link-btn"
            disabled={resetting || loading}
            onClick={() => void resetDefaults()}
          >
            {resetting ? "恢复中…" : "恢复默认"}
          </button>
        }
        footer={
          <Button variant="primary" disabled={saving || loading} onClick={() => void save()}>
            {saving ? "保存中…" : "保存"}
          </Button>
        }
      >
        <SamplingForm protocol={protocol} params={params} onChange={setParams} />
        <SettingsSwitchRow
          label="思考"
          checked={thinkingEnabled}
          onChange={setThinkingEnabled}
        />
      </SettingsFormSection>
    </SettingsPanel>
  );
}
