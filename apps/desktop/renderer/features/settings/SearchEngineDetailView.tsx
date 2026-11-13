/**
 * 设置 · 搜索引擎详情页（两级结构第二级）：`navState.editingEngineId` 定位单引擎，
 * 三分支 + create 模式：
 * - duckduckgo：内置代码引擎，只读说明（无表单无保存）；
 * - 预置（六出厂 id）：key 表单（模板引用 `{{apiKey}}` 时）+ baseUrl 表单（模板
 *   引用 `{{baseUrl}}` 时）+ 全量模板表单平铺（出厂模板预填，保存只提交与出厂
 *   不同的字段以保留既有覆盖）+ 恢复默认 + 测试；
 * - 自定义：key 表单（含 `{{apiKey}}` 注入方式快捷选择）+ baseUrl 表单（模板引用
 *   `{{baseUrl}}` 时）+ 全量模板表单 + 测试 + 删除；
 * - create 模式（`editingEngineId === NEW_ENGINE_SENTINEL`，复用本 viewId）：
 *   curl 导入粘贴域 + 全量表单 + 测试，保存走 `createCustomEngine` 后回列表。
 *
 * 模板字段（SPEC v2 透传改造）：name / method / url / headers / defaultBody（可选，
 * 留空则由 agent 调用时传参）/ paramHint；响应侧无任何映射配置（v1 的
 * resultPath/fieldMap/answerPath/envelope 已废除，执行器自动提取最长对象数组）。
 *
 * 测试默认走**草稿直测**：当前表单 + 本次输入的 key/baseUrl 组成 draft，不落库；
 * 表单里没填 key 时由 core 回退已存 SKSP 值。例外（拍板 1）：预置引擎已有覆盖
 * 且表单与出厂模板逐字段相等（key/baseUrl 草稿也为空）时省略 draft 只传
 * engineId，由 core 走「覆盖合并 + SKSP 现读」测生效配置。保存前模板统一过
 * `validateSearchEngineTemplate`（Result 失败直接展示原因，不发 IPC）。
 * 保存 / 清除 / 测试互斥（在途期间按钮禁用 + 交错点击直接忽略）。
 */
import { useCallback, useEffect, useState } from "react";
import type { IpcResult, SearchConfigDto } from "@shared/ipc-types";
import { coreT } from "@shared/logic/core-i18n";
import { PRESET_ENGINE_TEMPLATES, parseCurlCommand, validateSearchEngineTemplate, type CustomEngineDef, type SearchEngineTemplate } from "@shared/logic/search-engines";
import {
  ipcSearchClearEngineKey,
  ipcSearchCreateCustomEngine,
  ipcSearchDeleteCustomEngine,
  ipcSearchGetConfig,
  ipcSearchResetPresetOverride,
  ipcSearchSaveEngineKey,
  ipcSearchSetEngineBaseUrl,
  ipcSearchTestEngine,
  ipcSearchUpdateCustomEngine,
  ipcSearchUpdatePresetOverride,
} from "@/ipc/client";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { toastSettingsError, toastSettingsSuccess } from "@/utils/settings-feedback";
import { settingsTranslator } from "../../i18n/settings";
import type { SettingsNavHandle } from "./settings-nav";
import { ENGINE_META, NEW_ENGINE_SENTINEL, engineLabel } from "./search-engine-meta";
import { ApiKeyStatusTag, SettingsField, SettingsFormSection, SettingsPanel, SettingsSection, SettingsStatus } from "./settings-ui";

/** 出厂模板表（字面量类型 → 按 id 索引的只读视图）。 */
const PRESET_TEMPLATES: Readonly<Record<string, SearchEngineTemplate>> = PRESET_ENGINE_TEMPLATES;

/** 模板表单草稿：所有字段按文本框持有，保存 / 测试前统一转模板形状走校验。 */
type TemplateFormState = {
  name: string;
  method: "GET" | "POST";
  url: string;
  headersJson: string;
  defaultBody: string;
  paramHint: string;
};

/** 新建自定义引擎的初始表单（POST + JSON 请求体的常见形态，减少手填）。 */
const EMPTY_FORM: TemplateFormState = {
  name: "",
  method: "POST",
  url: "",
  headersJson: JSON.stringify({ "Content-Type": "application/json", Accept: "application/json" }, null, 2),
  defaultBody: JSON.stringify({ query: "{{query}}", count: "{{count}}" }, null, 2),
  paramHint: "",
};

/** 密钥注入方式快捷选择（只写 header，模板里留 `{{apiKey}}` 占位符）。 */
const INJECTION_OPTIONS: ReadonlyArray<{
  readonly label: string;
  readonly header: string;
  readonly value: string;
}> = [
  {
    label: "Authorization: Bearer {{apiKey}}",
    header: "Authorization",
    value: "Bearer {{apiKey}}",
  },
  { label: "X-API-Key: {{apiKey}}", header: "X-API-Key", value: "{{apiKey}}" },
  {
    label: "X-Subscription-Token: {{apiKey}}",
    header: "X-Subscription-Token",
    value: "{{apiKey}}",
  },
];

/** 预置覆盖按差异提交时比较的模板字段（与 SearchEngineTemplate 字段一一对应）。 */
const TEMPLATE_FIELDS = ["name", "method", "url", "headers", "defaultBody", "paramHint"] as const;

export function SearchEngineDetailView({ nav }: { nav: SettingsNavHandle }) {
  const engineId = nav.navState.editingEngineId;
  const isCreate = engineId === NEW_ENGINE_SENTINEL;

  const [config, setConfig] = useState<SearchConfigDto | null>(null);
  const [form, setForm] = useState<TemplateFormState>(EMPTY_FORM);
  /** 预置模板的出厂初值（覆盖按差异提交）；自定义 / create 恒 undefined。 */
  const [presetDefault, setPresetDefault] = useState<SearchEngineTemplate | undefined>();
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [testQuery, setTestQuery] = useState("");
  const [testResult, setTestResult] = useState<{ preview: string; resultCount?: number; truncated: boolean } | undefined>();
  const [curlText, setCurlText] = useState("");
  const [importedKey, setImportedKey] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    if (engineId == null || engineId === NEW_ENGINE_SENTINEL) return;
    const res = await ipcSearchGetConfig();
    if (!res.ok) {
      setError(res.error.message);
      setLoaded(true);
      return;
    }
    setConfig(res.data);
    const entry = res.data.engines.find((item) => item.id === engineId);
    if (entry != null) {
      setBaseUrl(entry.baseUrl ?? "");
      const custom = entry.isCustom ? res.data.customEngines.find((def) => def.id === engineId) : undefined;
      const factory = entry.isCustom || entry.id === "duckduckgo" ? undefined : PRESET_TEMPLATES[entry.id];
      setPresetDefault(factory);
      const template = custom?.template ?? factory;
      if (template != null) {
        setForm({
          name: template.name,
          method: template.method,
          url: template.url,
          headersJson: Object.keys(template.headers).length > 0 ? JSON.stringify(template.headers, null, 2) : "",
          defaultBody: template.defaultBody ?? "",
          paramHint: template.paramHint,
        });
      }
    }
    setLoaded(true);
  }, [engineId]);

  useEffect(() => {
    // DDG 只读说明卡不依赖库内数据；create 模式表单为空初值——都不读 IPC。
    if (engineId == null || engineId === "duckduckgo" || engineId === NEW_ENGINE_SENTINEL) {
      setLoaded(true);
      return;
    }
    void reload();
  }, [engineId, reload]);

  // navState 脏值（绕过列表页直跳）兜底：回到列表页
  if (engineId == null) {
    return (
      <SettingsPanel>
        <SettingsFormSection title={settingsTranslator({ key: "settings.search.detail.engine_section.desktop" })}>
          <p className="settings-hint">{settingsTranslator({ key: "settings.search.empty.no_engine_selected.desktop" })}</p>
          <Button variant="secondary" onClick={() => nav.pop()}>
            {settingsTranslator({ key: "settings.search.detail.back_to_list.desktop" })}
          </Button>
        </SettingsFormSection>
      </SettingsPanel>
    );
  }

  // 内置代码引擎：只读说明（无表单无保存；文案与 mobile 同构勿漂移）。
  if (engineId === "duckduckgo") {
    return (
      <SettingsPanel>
        <SettingsFormSection title={ENGINE_META.duckduckgo.label} desc={ENGINE_META.duckduckgo.desc}>
          <p className="settings-hint">{settingsTranslator({ key: "settings.search.detail.builtin_body.desktop" })}</p>
        </SettingsFormSection>
      </SettingsPanel>
    );
  }

  // 编辑态首次读库完成前只显示加载提示（避免空表单闪一下再被回填覆盖）。
  if (!isCreate && !loaded) {
    return (
      <SettingsPanel>
        <p className="settings-hint">{settingsTranslator({ key: "settings.search.empty.loading.desktop" })}</p>
      </SettingsPanel>
    );
  }

  const engine = config?.engines.find((item) => item.id === engineId);
  const customDef: CustomEngineDef | undefined = engine?.isCustom === true ? config?.customEngines.find((def) => def.id === engineId) : undefined;
  const isPreset = engine != null && !engine.isCustom;
  const busy = saving || clearing || testing;
  /** 模板里是否引用了对应宏：url / headers / body 任一出现即视为需要。 */
  const uses = (macro: string) => [form.url, form.headersJson, form.defaultBody].some((text) => text.includes(macro));
  const usesApiKey = uses("{{apiKey}}");
  const usesBaseUrl = uses("{{baseUrl}}");
  const titleFallback = engineLabel(engineId) || settingsTranslator({ key: "settings.search.detail.engine_section.desktop" });
  const title = isCreate ? settingsTranslator({ key: "settings.search.list.create_custom" }) : engine?.name ?? titleFallback;
  /** 模板校验失败文案（reason 为字段原因）。 */
  const templateErrorText = (reason: string) => coreT({ key: "error.tool.search_template_invalid", params: { reason } });

  /** Headers JSON 文本 → 对象（非法文本 / 非对象给中文原因；合法返回 undefined 以外的值）。 */
  const parseHeaders = (text: string): Record<string, unknown> | string => {
    let parsed: unknown;
    try {
      parsed = text.trim().length === 0 ? {} : JSON.parse(text);
    } catch {
      return settingsTranslator({ key: "settings.search.validation.headers_invalid_json.desktop" });
    }
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : settingsTranslator({ key: "settings.search.validation.headers_not_object.desktop" });
  };

  /** 表单 → 校验后的模板；保存与测试共用（headers/body 的 JSON 文本先解析再校验）。 */
  const readTemplate = (): SearchEngineTemplate | undefined => {
    const headers = parseHeaders(form.headersJson);
    if (typeof headers === "string") {
      setError(templateErrorText(headers));
      return undefined;
    }
    const bodyText = form.defaultBody.trim();
    const raw: Record<string, unknown> = {
      name: form.name,
      method: form.method,
      url: form.url,
      headers,
      paramHint: form.paramHint,
    };
    if (bodyText.length > 0) raw.defaultBody = bodyText;
    const validated = validateSearchEngineTemplate(raw);
    if (!validated.ok) {
      const { messageKey, message, messageParams } = validated.error;
      setError(messageKey == null ? templateErrorText(message) : coreT({ key: messageKey, params: messageParams }));
      return undefined;
    }
    return validated.value;
  };

  // nm-style: keep-local — 保存分流 create/自定义/预置三分支，共享 saving 互斥态、
  // key/baseUrl 草稿与逐 IPC 失败短路；内联进 footer 按钮会拆散互斥与错误回显
  const save = async () => {
    if (busy) return;
    setSaving(true);
    setError(undefined);
    try {
      const template = readTemplate();
      if (template == null) return;
      const key = apiKey.trim();
      const url = baseUrl.trim();
      if (isCreate) {
        const id = `custom:${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
        const def: CustomEngineDef = {
          id,
          name: template.name,
          template,
          createdAt: new Date().toISOString(),
        };
        const input = {
          def,
          ...(key.length > 0 ? { apiKey: key } : {}),
          ...(url.length > 0 ? { baseUrl: url } : {}),
        };
        const res = await ipcSearchCreateCustomEngine(input);
        if (!res.ok) {
          setError(res.error.message);
          return;
        }
        toastSettingsSuccess(settingsTranslator({ key: "settings.search.toast.created.desktop" }));
        nav.pop();
        return;
      }
      if (engine?.isCustom === true) {
        // 自定义：模板整体替换（key 留空不动；baseUrl 仅模板引用时提交，空串清除）
        const input = {
          engineId,
          name: template.name,
          template,
          ...(key.length > 0 ? { apiKey: key } : {}),
          ...(usesBaseUrl ? { baseUrl: url } : {}),
        };
        const res = await ipcSearchUpdateCustomEngine(input);
        if (!res.ok) {
          setError(res.error.message);
          return;
        }
      } else if (presetDefault != null) {
        // 拍板 7 + CR2 P2-9：拦截按草稿判定（usesApiKey，与 mobile draftNeedsKey 同源）——
        // 草稿已删 {{apiKey}} 引用则放行，避免「已存生效模板 needsKey」误拦清 key 的草稿
        if (usesApiKey && engine?.hasKey !== true && key.length === 0) {
          setError(settingsTranslator({ key: "settings.search.validation.api_key_required" }));
          return;
        }
        // 预置：只提交与出厂模板不同的字段，未改字段保留既有覆盖（patch 浅合并）
        const patch: Record<string, unknown> = {};
        for (const field of TEMPLATE_FIELDS) {
          if (JSON.stringify(presetDefault[field]) !== JSON.stringify(template[field])) patch[field] = template[field];
        }
        // baseUrl 仅在草稿与已存值不同时提交（空串 = 清除；相同 = 无写操作）
        const baseUrlChanged = usesBaseUrl && url !== (engine?.baseUrl ?? "");
        if (Object.keys(patch).length === 0 && key.length === 0 && !baseUrlChanged) {
          toastSettingsSuccess(settingsTranslator({ key: "settings.search.toast.no_changes" }));
          return;
        }
        if (Object.keys(patch).length > 0) {
          const res = await ipcSearchUpdatePresetOverride({ engineId, patch: patch as Partial<SearchEngineTemplate> });
          if (!res.ok) {
            setError(res.error.message);
            return;
          }
        }
        if (key.length > 0) {
          const res = await ipcSearchSaveEngineKey({ engineId, apiKey: key });
          if (!res.ok) {
            setError(res.error.message);
            return;
          }
        }
        if (baseUrlChanged) {
          const res = await ipcSearchSetEngineBaseUrl({ engineId, baseUrl: url });
          if (!res.ok) {
            setError(res.error.message);
            return;
          }
        }
      }
      setApiKey(""); // 保存成功后密码框回落空白（不留明文残影）
      await reload();
      toastSettingsSuccess(settingsTranslator({ key: "settings.search.toast.saved.desktop" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // nm-style: keep-local — 草稿直测共享 busy/testing 互斥态，成功回填 testResult、
  // 失败回显 error；内联进测试按钮会拆散测试状态机
  const runTest = async () => {
    if (busy) return;
    const template = readTemplate();
    if (template == null) return;
    const query = testQuery.trim();
    if (query.length === 0) {
      setError(settingsTranslator({ key: "settings.search.validation.test_query_required.desktop" }));
      return;
    }
    setTesting(true);
    setError(undefined);
    setTestResult(undefined);
    try {
      const key = apiKey.trim();
      const url = baseUrl.trim();
      const draft = {
        template,
        ...(key.length > 0 ? { apiKey: key } : {}),
        ...(usesBaseUrl && url.length > 0 ? { baseUrl: url } : {}),
      };
      // 拍板 1：预置已有覆盖且表单与出厂逐字段相等（key/baseUrl 草稿也为空）→
      // 省略 draft 只传 engineId，core 走「覆盖合并 + SKSP 现读」测生效配置；
      // 其余仍草稿直测（draft 优先，缺省 key/baseUrl 回退 SKSP / engineBaseUrls）。
      const sameAsFactory = presetDefault != null && TEMPLATE_FIELDS.every((field) => JSON.stringify(presetDefault[field]) === JSON.stringify(template[field]));
      const testEffective = isPreset && config?.presetOverrides[engineId] === true && sameAsFactory && key.length === 0 && !(usesBaseUrl && url.length > 0);
      const res = await ipcSearchTestEngine({ ...(isCreate || testEffective ? {} : { draft }), ...(isCreate ? {} : { engineId }), query });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setTestResult({
        preview: res.data.preview,
        resultCount: res.data.resultCount,
        truncated: res.data.truncated,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  /** busy 互斥的短写模板（清除/恢复默认/删除共用）：失败置页内 error 返回 false；成功回读后 toast，flag 复位交 finally。 */
  const runWrite = async (setFlag: (on: boolean) => void, action: (id: string) => Promise<IpcResult<void>>, success: string): Promise<boolean> => {
    if (busy) return false;
    setFlag(true);
    setError(undefined);
    try {
      const res = await action(engineId);
      if (!res.ok) {
        setError(res.error.message);
        return false;
      }
      await reload();
      toastSettingsSuccess(success);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setFlag(false);
    }
  };

  // 编辑态但库里已找不到（如自定义实例被删）：回到列表页
  if (!isCreate && engine == null) {
    return (
      <SettingsPanel>
        <SettingsFormSection title={settingsTranslator({ key: "settings.search.detail.engine_section.desktop" })}>
          <p className="settings-hint">{settingsTranslator({ key: "settings.search.empty.engine_missing.desktop" })}</p>
          <Button variant="secondary" onClick={() => nav.pop()}>
            {settingsTranslator({ key: "settings.search.detail.back_to_list.desktop" })}
          </Button>
        </SettingsFormSection>
      </SettingsPanel>
    );
  }

  const templateFields = (
    <>
      <SettingsField label={settingsTranslator({ key: "settings.search.detail.method_label.desktop" })}>
        <select
          value={form.method}
          onChange={(e) =>
            setForm({
              ...form,
              method: e.target.value === "GET" ? "GET" : "POST",
            })
          }
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
        </select>
      </SettingsField>
      <SettingsField label={settingsTranslator({ key: "settings.search.detail.url_label.desktop" })}>
        <input
          type="text"
          value={form.url}
          placeholder="https://api.example.com/search"
          // 内置引擎端点出厂固定（SearXNG 例外：URL 就是实例地址，需用户改）。
          disabled={isPreset && engineId !== "searxng"}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
        />
      </SettingsField>
      <SettingsField label={settingsTranslator({ key: "settings.search.detail.headers_label.desktop" })}>
        <textarea rows={4} value={form.headersJson} onChange={(e) => setForm({ ...form, headersJson: e.target.value })} placeholder={'{"Authorization": "Bearer {{apiKey}}"}'} />
      </SettingsField>
      <SettingsField label={settingsTranslator({ key: "settings.search.detail.body_label.desktop" })}>
        <textarea rows={4} value={form.defaultBody} onChange={(e) => setForm({ ...form, defaultBody: e.target.value })} placeholder={'{"query": "{{query}}", "count": "{{count}}"}'} />
        {/* FIX-26：裸形态 "{{count}}" 易误读为可写整值，双端统一强调带引号（文案与 mobile 同步） */}
        <span className="settings-hint">{settingsTranslator({ key: "settings.search.params.placeholder_note.desktop" })}</span>
      </SettingsField>
      <SettingsField label={settingsTranslator({ key: "settings.search.params.title.desktop" })}>
        <textarea
          rows={3}
          value={form.paramHint}
          onChange={(e) => setForm({ ...form, paramHint: e.target.value })}
          placeholder={settingsTranslator({ key: "settings.search.params.placeholder.desktop" })}
          disabled={isPreset}
        />
      </SettingsField>
    </>
  );

  return (
    <SettingsPanel>
      <SettingsFormSection
        title={title}
        desc={
          isCreate
            ? settingsTranslator({ key: "settings.search.detail.desc_create.desktop" })
            : customDef != null
            ? settingsTranslator({ key: "settings.search.detail.desc_custom.desktop" })
            : `${ENGINE_META[engineId]?.desc ?? ""} · ${settingsTranslator({ key: "settings.search.meta.preset_label.desktop" })}`
        }
        footer={
          <Button variant="primary" disabled={saving || clearing || testing} onClick={() => void save()}>
            {saving
              ? settingsTranslator({ key: "settings.search.detail.saving.desktop" })
              : isCreate
              ? settingsTranslator({ key: "settings.search.detail.create_action.desktop" })
              : settingsTranslator({ key: "settings.search.detail.save_action.desktop" })}
          </Button>
        }
      >
        {isCreate ? (
          <SettingsSection title={settingsTranslator({ key: "settings.search.curl.section_title.desktop" })} desc={settingsTranslator({ key: "settings.search.curl.section_desc.desktop" })}>
            <SettingsField label={settingsTranslator({ key: "settings.search.curl.command_label.desktop" })}>
              <textarea
                rows={5}
                value={curlText}
                onChange={(e) => setCurlText(e.target.value)}
                placeholder={"curl -X POST https://api.example.com/search -H 'Authorization: Bearer sk-xxx' -d '{\"query\":\"{{query}}\"}'"}
              />
            </SettingsField>
            <Button
              variant="secondary"
              onClick={() => {
                // curl 导入：解析失败整体拒绝；成功一次回填表单/密钥/识别提示
                const parsed = parseCurlCommand(curlText);
                if (!parsed.ok) {
                  toastSettingsError(coreT(parsed.error.message));
                  return;
                }
                const draft = parsed.value;
                setForm({
                  ...form,
                  method: draft.method,
                  url: draft.url,
                  headersJson: JSON.stringify(draft.headers, null, 2),
                  defaultBody: draft.defaultBody ?? form.defaultBody,
                });
                if (draft.apiKey != null) setApiKey(draft.apiKey);
                setImportedKey(draft.apiKey != null);
                toastSettingsSuccess(settingsTranslator({ key: "settings.search.toast.curl_imported.desktop" }));
              }}
            >
              {settingsTranslator({ key: "settings.search.curl.parse_action.desktop" })}
            </Button>
            {importedKey ? <p className="settings-hint">{settingsTranslator({ key: "settings.search.curl.key_detected.desktop" })}</p> : null}
          </SettingsSection>
        ) : null}

        <SettingsSection title={settingsTranslator({ key: "settings.search.detail.connection_section.desktop" })}>
          {isCreate || customDef != null ? (
            <SettingsField label={settingsTranslator({ key: "settings.search.detail.name_label.desktop" })}>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={settingsTranslator({ key: "settings.search.detail.name_placeholder.desktop" })}
              />
            </SettingsField>
          ) : null}
          {isCreate ? null : (
            <SettingsField label={settingsTranslator({ key: "settings.search.auth.key_status_label.desktop" })} row>
              <ApiKeyStatusTag status={engine?.hasKey === true ? "set" : "not set"} />
            </SettingsField>
          )}
          {isCreate || engine?.needsKey === true || usesApiKey ? (
            <SettingsField
              label={engine?.hasKey === true ? settingsTranslator({ key: "settings.search.auth.new_key_label.desktop" }) : settingsTranslator({ key: "settings.search.auth.api_key_label" })}
            >
              <input type="password" value={apiKey} autoComplete="new-password" onChange={(e) => setApiKey(e.target.value)} />
            </SettingsField>
          ) : null}
          {isCreate || customDef != null ? (
            <SettingsField label={settingsTranslator({ key: "settings.search.auth.injection_label.desktop" })}>
              <select
                value=""
                onChange={(e) => {
                  // 注入方式快捷选择：先解析现有 Headers（失败短路），再按选中项写回
                  const option = INJECTION_OPTIONS.find((item) => item.label === e.target.value);
                  if (option == null) return;
                  const headers = parseHeaders(form.headersJson);
                  if (typeof headers === "string") {
                    toastSettingsError(headers);
                    return;
                  }
                  setForm({
                    ...form,
                    headersJson: JSON.stringify({ ...headers, [option.header]: option.value }, null, 2),
                  });
                }}
              >
                <option value="">{settingsTranslator({ key: "settings.search.auth.injection_placeholder.desktop" })}</option>
                {INJECTION_OPTIONS.map((option) => (
                  <option key={option.label} value={option.label}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SettingsField>
          ) : null}
          {engine?.hasKey === true && !isCreate ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                void runWrite(setClearing, (id) => ipcSearchClearEngineKey({ engineId: id }), settingsTranslator({ key: "settings.search.toast.cleared.desktop" }));
              }}
            >
              {clearing ? settingsTranslator({ key: "settings.search.auth.clearing" }) : settingsTranslator({ key: "settings.search.auth.clear_key.desktop" })}
            </Button>
          ) : null}
          {/* 实例地址只服务模板里的 {{baseUrl}} 宏；searxng 出厂 URL 已是完整端点（示例地址），
              用户在 URL 字段里直接改成自己的实例即可。 */}
          {isCreate || usesBaseUrl ? (
            <SettingsField label={settingsTranslator({ key: "settings.search.auth.base_url_label.desktop" })}>
              <input type="text" value={baseUrl} placeholder="https://searxng.example.com" onChange={(e) => setBaseUrl(e.target.value)} />
            </SettingsField>
          ) : null}
        </SettingsSection>

        <SettingsSection title={settingsTranslator({ key: "settings.search.detail.template_section.desktop" })}>
          {isPreset && config?.presetOverrides[engineId] === true ? (
            <>
              <div className="settings-form-actions">
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    void runWrite(setSaving, (id) => ipcSearchResetPresetOverride({ engineId: id }), settingsTranslator({ key: "settings.search.toast.reset_done.desktop" }));
                  }}
                >
                  {settingsTranslator({ key: "settings.search.detail.reset_action.desktop" })}
                </Button>
              </div>
              <p className="settings-hint">{settingsTranslator({ key: "settings.search.detail.override_hint.desktop" })}</p>
            </>
          ) : null}
          {templateFields}
        </SettingsSection>

        <SettingsSection title={settingsTranslator({ key: "settings.search.detail.test_section.desktop" })} desc={settingsTranslator({ key: "settings.search.detail.test_desc.desktop" })}>
          <SettingsField label={settingsTranslator({ key: "settings.search.detail.test_query_label.desktop" })}>
            <input type="text" value={testQuery} onChange={(e) => setTestQuery(e.target.value)} placeholder={settingsTranslator({ key: "settings.search.detail.test_query_placeholder.desktop" })} />
          </SettingsField>
          <Button variant="secondary" disabled={busy} onClick={() => void runTest()}>
            {testing ? settingsTranslator({ key: "settings.search.detail.testing.desktop" }) : settingsTranslator({ key: "settings.search.detail.test_action.desktop" })}
          </Button>
          {testResult != null ? (
            <>
              {/* SPEC v2 §5：提取数组前 2 条的 JSON 预览（等宽 + 换行），不再渲染 title/url/snippet 人类列表 */}
              <pre
                className="settings-hint"
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "monospace",
                  margin: "0 0 8px",
                }}
              >
                {testResult.preview}
              </pre>
              <p className="settings-hint">
                {testResult.resultCount != null ? settingsTranslator({ key: "settings.search.detail.test_count.desktop", params: { count: testResult.resultCount } }) : ""}
                {testResult.truncated ? `${testResult.resultCount != null ? " · " : ""}${settingsTranslator({ key: "settings.search.detail.test_truncated.desktop" })}` : ""}
              </p>
            </>
          ) : null}
        </SettingsSection>

        {customDef != null ? (
          <SettingsSection title={settingsTranslator({ key: "settings.search.detail.delete_section" })} desc={settingsTranslator({ key: "settings.search.detail.delete_hint.desktop" })}>
            <Button variant="danger" disabled={busy} onClick={() => setDeleteOpen(true)}>
              {settingsTranslator({ key: "settings.search.detail.delete_title" })}
            </Button>
          </SettingsSection>
        ) : null}

        <SettingsStatus error={error} />
      </SettingsFormSection>
      <ConfirmModal
        open={deleteOpen}
        title={settingsTranslator({ key: "settings.search.detail.delete_title" })}
        message={settingsTranslator({ key: "settings.search.detail.delete_confirm.desktop", params: { name: engine?.name ?? "" } })}
        confirmLabel={settingsTranslator({ key: "settings.search.list.menu.delete" })}
        danger
        busy={busy}
        onConfirm={() => {
          // 删除走 runWrite：无论成败都收起确认框（错误经页内 SettingsStatus 展示，避免弹窗挡住原因），成功后回列表页
          void runWrite(setSaving, (id) => ipcSearchDeleteCustomEngine({ engineId: id }), settingsTranslator({ key: "settings.search.toast.deleted.desktop" })).then((ok) => {
            setDeleteOpen(false);
            if (ok) nav.pop();
          });
        }}
        onCancel={() => setDeleteOpen(false)}
      />
    </SettingsPanel>
  );
}
