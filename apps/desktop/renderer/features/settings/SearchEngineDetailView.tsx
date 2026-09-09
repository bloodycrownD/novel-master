/**
 * 设置 · 搜索引擎详情页（两级结构第二级）：navState.editingEngineId
 * 定位单引擎，表单按引擎类型分流——
 * - key 引擎（bocha/tavily/brave）：密码框 + 留空不修改 + 已配置时的
 *   「清除密钥」按钮；
 * - searxng：实例 baseUrl 表单，空串保存即清除；URL 形状校验
 *   （http/https、禁 userinfo）前置于提交，无连通性测试（PRD 口径）。
 * 保存与清除双向互斥（沿用旧单页的互斥口径：saving/clearing 布尔
 * 双态，在途期间按钮禁用 + 交错点击直接忽略）。
 */
import { useCallback, useEffect, useState } from "react";
import type { EngineId } from "@shared/logic/search-engines";
import {
  ipcSearchClearEngineKey,
  ipcSearchGetConfig,
  ipcSearchSaveEngineKey,
  ipcSearchSetSearxngBaseUrl,
} from "@/ipc/client";
import { Button } from "@/components/ui/Button";
import type { SettingsNavHandle } from "./settings-nav";
import {
  ENGINE_META,
  isEngineId,
  isKeyEngineId,
} from "./search-engine-meta";
import {
  ApiKeyStatusTag,
  SettingsField,
  SettingsFormSection,
  SettingsPanel,
  SettingsSection,
  SettingsStatus,
} from "./settings-ui";
import { toastSettingsSuccess } from "@/utils/settings-feedback";

/** searxng baseUrl 的 URL 形状校验（无连通性测试；禁 userinfo，与列表页旧口径一致）。 */
function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function SearchEngineDetailView({ nav }: { nav: SettingsNavHandle }) {
  const engineId = nav.navState.editingEngineId;

  const [configured, setConfigured] = useState(false);
  const [searxngUrl, setSearxngUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  /** 清除 key 在途（与保存互斥；false = 空闲）。 */
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const reload = useCallback(async (engine: EngineId): Promise<void> => {
    const res = await ipcSearchGetConfig();
    if (res.ok) {
      setConfigured(res.data.engines[engine]?.configured ?? false);
      // baseUrl 回填仅 searxng 用（key 引擎输入恒从空白开始：留空不改语义）
      if (engine === "searxng") setSearxngUrl(res.data.searxngBaseUrl);
      setLoaded(true);
    } else {
      setError(res.error.message);
    }
  }, []);

  useEffect(() => {
    if (isEngineId(engineId)) {
      void reload(engineId);
    }
  }, [engineId, reload]);

  // navState 脏值（绕过列表页直跳）兜底：回到列表页
  if (!isEngineId(engineId)) {
    return (
      <SettingsPanel>
        <SettingsFormSection title="搜索引擎">
          <p className="settings-hint">未指定引擎，请从搜索配置列表选择。</p>
          <Button variant="secondary" onClick={() => nav.pop()}>
            返回列表
          </Button>
        </SettingsFormSection>
      </SettingsPanel>
    );
  }

  const isKeyEngine = isKeyEngineId(engineId);
  const meta = ENGINE_META[engineId];

  const clearKey = async () => {
    if (!isKeyEngine || saving || clearing) return; // 与保存互斥，避免交错 IPC
    setClearing(true);
    setError(undefined);
    try {
      const res = await ipcSearchClearEngineKey({ engineId });
      if (res.ok) {
        await reload(engineId);
        toastSettingsSuccess("已清除");
      } else {
        setError(res.error.message);
      }
    } finally {
      setClearing(false); // 异常也不残留互斥态
    }
  };

  const save = async () => {
    if (clearing) return; // 与清除互斥
    setSaving(true);
    setError(undefined);
    try {
      if (isKeyEngine) {
        // key 引擎：留空 = 不修改，输入非空才保存
        const trimmed = apiKey.trim();
        if (trimmed.length === 0) {
          setError("请输入 API Key（留空不会修改已保存的密钥）");
          return;
        }
        const res = await ipcSearchSaveEngineKey({
          engineId,
          apiKey: trimmed,
        });
        if (!res.ok) {
          setError(res.error.message);
          return;
        }
      } else {
        // searxng：空串 = 清除；非空先做形状校验再提交（无 IPC 副作用早退）
        const trimmed = searxngUrl.trim();
        if (trimmed.length > 0 && !isValidHttpUrl(trimmed)) {
          setError("SearXNG 实例地址须为 http/https URL，且不允许携带用户名密码");
          return;
        }
        const res = await ipcSearchSetSearxngBaseUrl({ baseUrl: trimmed });
        if (!res.ok) {
          setError(res.error.message);
          return;
        }
      }
      setApiKey(""); // 保存成功后密码框回落空白（不留明文残影）
      await reload(engineId);
      toastSettingsSuccess("已保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPanel>
      {loaded ? null : <p className="settings-hint">加载中…</p>}
      <SettingsFormSection
        title={meta.label}
        desc={meta.desc}
        footer={
          <Button
            variant="primary"
            disabled={saving || clearing}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        }
      >
        <SettingsSection title="配置状态">
          <SettingsField label="状态">
            <ApiKeyStatusTag status={configured ? "set" : "not set"} />
          </SettingsField>
          {isKeyEngine ? (
            <SettingsField
              label={configured ? "新 API Key（留空则不修改）" : "API Key"}
            >
              <input
                type="password"
                value={apiKey}
                autoComplete="new-password"
                onChange={(e) => setApiKey(e.target.value)}
              />
            </SettingsField>
          ) : (
            <SettingsField label="实例 Base URL（留空 = 清除）">
              <input
                type="text"
                value={searxngUrl}
                placeholder="https://searxng.example.com"
                onChange={(e) => setSearxngUrl(e.target.value)}
              />
            </SettingsField>
          )}
          <p className="settings-hint settings-hint--compact">
            API Key 经 SKSP 安全存储，仅保存时写入；至少配置一个引擎后
            search 工具可用。
          </p>
          {isKeyEngine && configured ? (
            <Button
              variant="secondary"
              disabled={saving || clearing}
              onClick={() => void clearKey()}
            >
              {clearing ? "清除中…" : "清除密钥"}
            </Button>
          ) : null}
        </SettingsSection>
        <SettingsStatus error={error} />
      </SettingsFormSection>
    </SettingsPanel>
  );
}
