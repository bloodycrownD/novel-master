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
} from "./settings-ui";

type Nav = {
  push: (view: string) => void;
  pop: () => void;
  navState: SettingsNavState;
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
      const saved = savedRes.data as {
        settings: {
          contextWindowTokens: number;
          tokenCounterMode: TokenizerOverride;
          sampling: {
            enabled: boolean;
            params?: ModelSamplingParams;
          };
        };
      };
      setContextWindowTokens(String(saved.settings.contextWindowTokens));
      setTokenCounterMode(saved.settings.tokenCounterMode);
      const stored =
        saved.settings.sampling.enabled && saved.settings.sampling.params != null
          ? saved.settings.sampling.params
          : undefined;
      setParams(stored);
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
        const saved = resetRes.data as { settings: { contextWindowTokens: number } };
        setContextWindowTokens(String(saved.settings.contextWindowTokens));
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
      <SettingsFormSection
        title="采样参数"
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
        <SettingsField label="上下文上限 (tokens)">
          <input
            type="number"
            value={contextWindowTokens}
            onChange={(e) => setContextWindowTokens(e.target.value)}
          />
        </SettingsField>
        <SamplingForm protocol={protocol} params={params} onChange={setParams} />
      </SettingsFormSection>

      <SettingsSection
        title="Token 计数器"
        desc="自动按模型名匹配分词器族；保存后以本页为准。"
      >
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
    </SettingsPanel>
  );
}
