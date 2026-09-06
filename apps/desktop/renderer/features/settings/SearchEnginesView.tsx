import { useCallback, useEffect, useMemo, useState } from "react";
import type { SearchConfigDto } from "@shared/ipc-types";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  ipcSearchClearEngineKey,
  ipcSearchGetConfig,
  ipcSearchSaveEngineKey,
  ipcSearchSetDefaultEngine,
  ipcSearchSetSearxngBaseUrl,
} from "@/ipc/client";
import { toastSettingsSuccess } from "@/utils/settings-feedback";
import {
  ApiKeyStatusTag,
  SettingsField,
  SettingsFormSection,
  SettingsPanel,
  SettingsSection,
  SettingsStatus,
} from "./settings-ui";

/**
 * 引擎展示元数据（与 core ENGINE_IDS 对应；engineId 值即 core 侧
 * EngineId 字符串，configured 状态经 IPC DTO 回填）。
 */
const ENGINE_CARDS = [
  {
    id: "bocha",
    label: "Bocha",
    desc: "博查 AI 搜索（api.bochaai.com），需 API Key。",
  },
  {
    id: "tavily",
    label: "Tavily",
    desc: "Tavily 搜索（tavily.com），需 API Key。",
  },
  {
    id: "brave",
    label: "Brave",
    desc: "Brave 搜索（search.brave.com），需 API Key。",
  },
  {
    id: "searxng",
    label: "SearXNG",
    desc: "自托管元搜索实例，无需 API Key，填实例地址即可。",
  },
] as const;

type KeyEngineId = "bocha" | "tavily" | "brave";

const KEY_ENGINES: readonly KeyEngineId[] = ["bocha", "tavily", "brave"];

/** 空白 key 输入态（保存后也回落到此态：留空不改语义）。 */
const EMPTY_KEYS: Record<KeyEngineId, string> = {
  bocha: "",
  tavily: "",
  brave: "",
};

/** searxng baseUrl 的 URL 形状校验（无连通性测试，PRD 口径）。 */
function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function SearchEnginesView() {
  const [config, setConfig] = useState<SearchConfigDto | null>(null);
  const [keys, setKeys] = useState<Record<KeyEngineId, string>>(EMPTY_KEYS);
  const [searxngUrl, setSearxngUrl] = useState("");
  const [defaultEngine, setDefaultEngine] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const reload = useCallback(async (): Promise<void> => {
    const res = await ipcSearchGetConfig();
    if (res.ok) {
      setConfig(res.data);
      setSearxngUrl(res.data.searxngBaseUrl);
      setDefaultEngine(res.data.defaultEngine);
      setKeys(EMPTY_KEYS);
    } else {
      setError(res.error.message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const clearKey = async (engineId: KeyEngineId) => {
    if (saving) return; // 与保存互斥，避免交错 IPC（与 mobile 侧口径一致）
    setError(undefined);
    const res = await ipcSearchClearEngineKey({ engineId });
    if (res.ok) {
      await reload();
      toastSettingsSuccess("已清除");
    } else {
      setError(res.error.message);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      // 1) key 引擎：输入非空才保存（留空 = 不修改）
      for (const engineId of KEY_ENGINES) {
        const apiKey = keys[engineId].trim();
        if (apiKey.length === 0) continue;
        const res = await ipcSearchSaveEngineKey({ engineId, apiKey });
        if (!res.ok) {
          setError(res.error.message);
          await reload(); // 部分成功的已生效，回读刷新状态
          return;
        }
      }
      // 2) searxng baseUrl：与已存值不同才提交（空串 = 清除）
      const nextUrl = searxngUrl.trim();
      if (nextUrl !== (config?.searxngBaseUrl ?? "")) {
        if (nextUrl.length > 0 && !isValidHttpUrl(nextUrl)) {
          setError("SearXNG 实例地址须为 http/https URL");
          return;
        }
        const res = await ipcSearchSetSearxngBaseUrl({ baseUrl: nextUrl });
        if (!res.ok) {
          setError(res.error.message);
          await reload();
          return;
        }
      }
      // 3) 默认引擎：变化才提交（null = 清除，回落第一个已配置引擎）
      if (defaultEngine !== (config?.defaultEngine ?? null)) {
        const res = await ipcSearchSetDefaultEngine({
          engineId: defaultEngine,
        });
        if (!res.ok) {
          setError(res.error.message);
          await reload();
          return;
        }
      }
      await reload();
      toastSettingsSuccess("已保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const defaultOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [
      { value: "", label: "自动" },
    ];
    for (const card of ENGINE_CARDS) {
      if (config?.engines[card.id]?.configured) {
        options.push({ value: card.id, label: card.label });
      }
    }
    // 当前默认引擎已不在候选（如 key 被清除）时补挂为禁用项，保持可见可切换但不可重选（与 mobile 侧口径一致）
    if (
      defaultEngine != null &&
      !options.some((o) => o.value === defaultEngine)
    ) {
      const meta = ENGINE_CARDS.find((c) => c.id === defaultEngine);
      if (meta) options.push({ value: meta.id, label: meta.label, disabled: true });
    }
    return options;
  }, [config, defaultEngine]);

  return (
    <SettingsPanel>
      {config == null && error == null ? (
        <p className="settings-hint">加载中…</p>
      ) : null}
      <SettingsFormSection
        title="AI 搜索"
        desc="为 search 工具配置搜索引擎：API Key 经 SKSP 安全存储，仅保存时写入；至少配置一个引擎后 search 工具可用。"
        footer={
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? "保存中…" : "保存"}
          </Button>
        }
      >
        {ENGINE_CARDS.map((card) => {
          const configured = config?.engines[card.id]?.configured ?? false;
          return (
            <SettingsSection key={card.id} title={card.label}>
              <p className="settings-hint settings-hint--compact">
                {card.desc}
              </p>
              <SettingsField label="配置状态">
                <ApiKeyStatusTag status={configured ? "set" : "not set"} />
              </SettingsField>
              {card.id === "searxng" ? (
                <SettingsField label="实例 Base URL（留空 = 清除）">
                  <input
                    type="text"
                    value={searxngUrl}
                    placeholder="https://searxng.example.com"
                    onChange={(e) => setSearxngUrl(e.target.value)}
                  />
                </SettingsField>
              ) : (
                <>
                  <SettingsField
                    label={configured ? "新 API Key（留空则不修改）" : "API Key"}
                  >
                    <input
                      type="password"
                      value={keys[card.id]}
                      onChange={(e) =>
                        setKeys({ ...keys, [card.id]: e.target.value })
                      }
                    />
                  </SettingsField>
                  {configured ? (
                    <Button
                      variant="secondary"
                      onClick={() => void clearKey(card.id)}
                    >
                      清除密钥
                    </Button>
                  ) : null}
                </>
              )}
            </SettingsSection>
          );
        })}

        <SettingsSection title="默认引擎">
          <SettingsField label="解析顺序">
            <SegmentedControl
              value={defaultEngine ?? ""}
              options={defaultOptions}
              onChange={(next) => setDefaultEngine(next === "" ? null : next)}
              aria-label="默认搜索引擎"
            />
          </SettingsField>
          <p className="settings-hint settings-hint--compact">
            自动 = 使用第一个已配置引擎（Bocha → Tavily → Brave →
            SearXNG）；未配置任何引擎时 search 工具返回配置提示。
          </p>
        </SettingsSection>

        <SettingsStatus error={error} />
      </SettingsFormSection>
    </SettingsPanel>
  );
}
