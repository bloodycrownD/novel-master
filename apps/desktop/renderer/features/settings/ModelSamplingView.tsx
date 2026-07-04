import { useCallback, useEffect, useState } from "react";
import {
  THINKING_LEVEL_SELECT_OPTIONS,
  TOKEN_COUNTER_MODE_SELECT_OPTIONS,
  type LlmProtocolKind,
  type ModelSamplingParams,
  type ThinkingLevel,
  type TokenizerOverride,
} from "@novel-master/core/provider";
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
      const stored =
        generation.sampling.enabled && generation.sampling.params != null
          ? generation.sampling.params
          : undefined;
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
    return <p className="settings-hint">缺少模型</p>;
  }

  const saveModelName = async () => {
    const trimmed = modelName.trim();
    if (!trimmed) {
      toastSettingsError("模型名称不能为空");
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
      toastSettingsSuccess("已更新模型名称");
    } finally {
      setRenaming(false);
    }
  };

  const save = async () => {
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
      toastSettingsSuccess("已保存模型设置");
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
      toastSettingsSuccess("已恢复默认采样参数");
    } finally {
      setResetting(false);
    }
  };

  const sectionHint = `${displayName || savedModelId}\n厂商 ID：${vendorModelId}\n展示协议推荐默认值；保存后以本页为准。`;

  return (
    <SettingsPanel>
      {loading ? <p className="settings-hint">加载中…</p> : null}

      <SettingsSection
        title="模型名称"
        desc="用于列表与选择器展示；派生 displayName 为 服务商/模型名称。"
      >
        <div className="settings-fields">
          <SettingsField label="模型名称">
            <input
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="默认同厂商模型 ID"
            />
          </SettingsField>
          <SettingsField label="展示名称（派生）">
            <input value={displayName} readOnly disabled />
          </SettingsField>
        </div>
        <Button
          variant="secondary"
          disabled={renaming || loading}
          onClick={() => void saveModelName()}
        >
          {renaming ? "保存中…" : "保存名称"}
        </Button>
      </SettingsSection>

      <SettingsSection
        title="内部预算"
        desc="上下文窗口与 token 计数方式，不直接映射 HTTP 生成 body。"
      >
        <div className="settings-fields">
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
        </div>
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
        <SettingsField label="思考强度">
          <SegmentedControl
            aria-label="思考强度"
            value={thinkingLevel}
            options={THINKING_LEVEL_SELECT_OPTIONS}
            onChange={setThinkingLevel}
          />
        </SettingsField>
      </SettingsFormSection>
    </SettingsPanel>
  );
}
