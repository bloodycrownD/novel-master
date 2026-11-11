/**
 * 设置 · 搜索引擎详情页（两级结构第二级）：`navState.editingEngineId` 定位单引擎，
 * 三分支 + create 模式：
 * - duckduckgo：内置代码引擎，只读说明（无表单无保存）；
 * - 预置（六出厂 id）：key 表单（模板引用 `{{apiKey}}` 时）+ baseUrl 表单（模板
 *   引用 `{{baseUrl}}` 时）+「高级编辑」折叠区（全量模板表单，出厂模板预填，
 *   保存只提交与出厂不同的字段以保留既有覆盖）+ 恢复默认 + 测试；
 * - 自定义：key 表单（含 `{{apiKey}}` 注入方式快捷选择）+ baseUrl 表单（模板引用
 *   `{{baseUrl}}` 时）+ 全量模板表单 + 测试 + 删除；
 * - create 模式（`editingEngineId === NEW_ENGINE_SENTINEL`，复用本 viewId）：
 *   curl 导入粘贴域 + 全量表单 + 测试，保存走 `createCustomEngine` 后回列表。
 *
 * 测试一律走**草稿直测**：当前表单 + 本次输入的 key/baseUrl 组成 draft，不落库；
 * 表单里没填 key 时由 core 回退已存 SKSP 值。保存前模板统一过
 * `validateSearchEngineTemplate`（Result 失败直接展示原因，不发 IPC）。
 * 保存 / 清除 / 测试互斥（在途期间按钮禁用 + 交错点击直接忽略）。
 */
import { useCallback, useEffect, useState } from "react";
import type { SearchConfigDto } from "@shared/ipc-types";
import { coreT } from "@shared/logic/core-i18n";
import {
  PRESET_ENGINE_TEMPLATES,
  parseCurlCommand,
  validateSearchEngineTemplate,
  type CustomEngineDef,
  type SearchEngineTemplate,
} from "@shared/logic/search-engines";
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
  bodyTemplate: string;
  resultPath: string;
  fieldMapTitle: string;
  fieldMapUrl: string;
  fieldMapSnippet: string;
  answerPath: string;
  envelopeCodePath: string;
  envelopeOkValues: string;
  envelopeMsgPath: string;
  paramHint: string;
};

/** 新建自定义引擎的初始表单（POST + JSON 请求体的常见形态，减少手填）。 */
const EMPTY_FORM: TemplateFormState = {
  name: "",
  method: "POST",
  url: "",
  headersJson: JSON.stringify({ "Content-Type": "application/json", Accept: "application/json" }, null, 2),
  bodyTemplate: JSON.stringify({ query: "{{query}}", count: "{{count}}" }, null, 2),
  resultPath: "results",
  fieldMapTitle: "title",
  fieldMapUrl: "url",
  fieldMapSnippet: "snippet",
  answerPath: "",
  envelopeCodePath: "",
  envelopeOkValues: "",
  envelopeMsgPath: "",
  paramHint: "",
};

/** 密钥注入方式快捷选择（只写 header，模板里留 `{{apiKey}}` 占位符）。 */
const INJECTION_OPTIONS: ReadonlyArray<{ readonly label: string; readonly header: string; readonly value: string }> = [
  { label: "Authorization: Bearer {{apiKey}}", header: "Authorization", value: "Bearer {{apiKey}}" },
  { label: "X-API-Key: {{apiKey}}", header: "X-API-Key", value: "{{apiKey}}" },
  { label: "X-Subscription-Token: {{apiKey}}", header: "X-Subscription-Token", value: "{{apiKey}}" },
];

/** 预置覆盖按差异提交时比较的模板字段（与 SearchEngineTemplate 字段一一对应）。 */
const TEMPLATE_FIELDS = ["name", "method", "url", "headers", "bodyTemplate", "resultPath", "fieldMap", "answerPath", "envelope", "paramHint"] as const;

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
  const [templateOpen, setTemplateOpen] = useState(false);
  const [testQuery, setTestQuery] = useState("");
  const [testResult, setTestResult] = useState<{ count: number; titles: readonly string[] } | undefined>();
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
          bodyTemplate: template.bodyTemplate ?? "",
          resultPath: template.resultPath,
          fieldMapTitle: template.fieldMap.title.join(", "),
          fieldMapUrl: template.fieldMap.url.join(", "),
          fieldMapSnippet: template.fieldMap.snippet.join(", "),
          answerPath: template.answerPath ?? "",
          envelopeCodePath: template.envelope?.codePath ?? "",
          envelopeOkValues: template.envelope?.okValues?.join(", ") ?? "",
          envelopeMsgPath: template.envelope?.msgPath ?? "",
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
        <SettingsFormSection title="搜索引擎">
          <p className="settings-hint">未指定引擎，请从搜索配置列表选择。</p>
          <Button variant="secondary" onClick={() => nav.pop()}>
            返回列表
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
          <p className="settings-hint">内置免费引擎，无需 API Key；在列表页开关控制是否参与搜索。它忽略 params 透传，也不支持 site: 等高级检索语法。</p>
        </SettingsFormSection>
      </SettingsPanel>
    );
  }

  // 编辑态首次读库完成前只显示加载提示（避免空表单闪一下再被回填覆盖）。
  if (!isCreate && !loaded) {
    return (
      <SettingsPanel>
        <p className="settings-hint">加载中…</p>
      </SettingsPanel>
    );
  }

  const engine = config?.engines.find((item) => item.id === engineId);
  const customDef: CustomEngineDef | undefined = engine?.isCustom === true ? config?.customEngines.find((def) => def.id === engineId) : undefined;
  const isPreset = engine != null && !engine.isCustom;
  const busy = saving || clearing || testing;
  const usesApiKey = form.url.includes("{{apiKey}}") || form.headersJson.includes("{{apiKey}}") || form.bodyTemplate.includes("{{apiKey}}");
  const usesBaseUrl = form.url.includes("{{baseUrl}}") || form.headersJson.includes("{{baseUrl}}") || form.bodyTemplate.includes("{{baseUrl}}");
  const title = isCreate ? "新建自定义引擎" : (engine?.name ?? (engineLabel(engineId) || "搜索引擎"));

  /** Headers JSON 文本 → 对象（非法文本 / 非对象给中文原因；合法返回 undefined 以外的值）。 */
  const parseHeaders = (text: string): Record<string, unknown> | string => {
    let parsed: unknown;
    try {
      parsed = text.trim().length === 0 ? {} : JSON.parse(text);
    } catch {
      return "Headers 必须是合法 JSON";
    }
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : "Headers 必须是 JSON 对象";
  };

  /** 表单 → 校验后的模板；保存与测试共用（headers/body 的 JSON 文本先解析再校验）。 */
  const readTemplate = (): SearchEngineTemplate | undefined => {
    const candidates = (text: string): readonly string[] => text.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
    const headers = parseHeaders(form.headersJson);
    if (typeof headers === "string") {
      setError(coreT({ key: "error.tool.search_template_invalid", params: { reason: headers } }));
      return undefined;
    }
    const raw: Record<string, unknown> = {
      name: form.name,
      method: form.method,
      url: form.url,
      headers,
      resultPath: form.resultPath,
      fieldMap: { title: candidates(form.fieldMapTitle), url: candidates(form.fieldMapUrl), snippet: candidates(form.fieldMapSnippet) },
      paramHint: form.paramHint,
    };
    if (form.bodyTemplate.trim().length > 0) raw.bodyTemplate = form.bodyTemplate;
    if (form.answerPath.trim().length > 0) raw.answerPath = form.answerPath;
    if (form.envelopeCodePath.trim().length > 0 || form.envelopeMsgPath.trim().length > 0 || form.envelopeOkValues.trim().length > 0) {
      raw.envelope = {
        codePath: form.envelopeCodePath,
        ...(form.envelopeMsgPath.trim().length > 0 ? { msgPath: form.envelopeMsgPath } : {}),
        ...(form.envelopeOkValues.trim().length > 0 ? { okValues: candidates(form.envelopeOkValues).map((item) => (/^-?\d+(\.\d+)?$/.test(item) ? Number(item) : item)) } : {}),
      };
    }
    const validated = validateSearchEngineTemplate(raw);
    if (!validated.ok) {
      setError(coreT(validated.error.messageKey == null ? { key: "error.tool.search_template_invalid", params: { reason: validated.error.message } } : { key: validated.error.messageKey, params: validated.error.messageParams }));
      return undefined;
    }
    return validated.value;
  };

  const clearKey = async () => {
    if (busy) return;
    setClearing(true);
    setError(undefined);
    try {
      const res = await ipcSearchClearEngineKey({ engineId });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      await reload();
      toastSettingsSuccess("已清除");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClearing(false); // 异常也不残留互斥态
    }
  };

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
        const def: CustomEngineDef = { id, name: template.name, template, createdAt: new Date().toISOString() };
        const res = await ipcSearchCreateCustomEngine({ def, ...(key.length > 0 ? { apiKey: key } : {}), ...(url.length > 0 ? { baseUrl: url } : {}) });
        if (!res.ok) {
          setError(res.error.message);
          return;
        }
        toastSettingsSuccess("已创建");
        nav.pop();
        return;
      }
      if (engine?.isCustom === true) {
        // 自定义：模板整体替换（key 留空不动；baseUrl 仅模板引用时提交，空串清除）
        const res = await ipcSearchUpdateCustomEngine({ engineId, name: template.name, template, ...(key.length > 0 ? { apiKey: key } : {}), ...(usesBaseUrl ? { baseUrl: url } : {}) });
        if (!res.ok) {
          setError(res.error.message);
          return;
        }
      } else if (presetDefault != null) {
        // 预置：只提交与出厂模板不同的字段，未改字段保留既有覆盖（patch 浅合并）
        const patch: Record<string, unknown> = {};
        for (const field of TEMPLATE_FIELDS) if (JSON.stringify(presetDefault[field]) !== JSON.stringify(template[field])) patch[field] = template[field];
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
        if (usesBaseUrl) {
          const res = await ipcSearchSetEngineBaseUrl({ engineId, baseUrl: url });
          if (!res.ok) {
            setError(res.error.message);
            return;
          }
        }
      }
      setApiKey(""); // 保存成功后密码框回落空白（不留明文残影）
      // 覆盖内容不回显进 DTO：保存后收起高级编辑，重开时按「出厂模板 + 差异提交」继续编辑
      setTemplateOpen(false);
      await reload();
      toastSettingsSuccess("已保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (busy) return;
    const template = readTemplate();
    if (template == null) return;
    const query = testQuery.trim();
    if (query.length === 0) {
      setError("请输入测试查询");
      return;
    }
    setTesting(true);
    setError(undefined);
    setTestResult(undefined);
    try {
      const key = apiKey.trim();
      const url = baseUrl.trim();
      const draft = { template, ...(key.length > 0 ? { apiKey: key } : {}), ...(usesBaseUrl && url.length > 0 ? { baseUrl: url } : {}) };
      // 编辑已存引擎时同传 engineId：draft 优先，缺省 key/baseUrl 回退 SKSP / engineBaseUrls 既有值
      const res = await ipcSearchTestEngine({ ...(isCreate ? {} : { engineId }), draft, query });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setTestResult({ count: res.data.resultCount, titles: res.data.sample.map((item) => item.title) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const resetTemplate = async () => {
    if (busy) return;
    setSaving(true);
    setError(undefined);
    try {
      const res = await ipcSearchResetPresetOverride({ engineId });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      await reload();
      toastSettingsSuccess("已恢复默认");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const removeEngine = async () => {
    if (busy) return;
    setSaving(true);
    setError(undefined);
    try {
      const res = await ipcSearchDeleteCustomEngine({ engineId });
      // 失败也收起确认框：错误经页内 SettingsStatus 展示，避免弹窗挡住原因
      setDeleteOpen(false);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      toastSettingsSuccess("已删除");
      nav.pop();
    } catch (e) {
      setDeleteOpen(false);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  /** curl 导入：解析失败整体拒绝（toast 原因），成功预填 method/URL/headers/body 与识别出的密钥。 */
  const importCurl = () => {
    const parsed = parseCurlCommand(curlText);
    if (!parsed.ok) {
      toastSettingsError(coreT(parsed.error.message));
      return;
    }
    const draft = parsed.value;
    setForm({ ...form, method: draft.method, url: draft.url, headersJson: JSON.stringify(draft.headers, null, 2), bodyTemplate: draft.bodyTemplate ?? form.bodyTemplate });
    if (draft.apiKey != null) setApiKey(draft.apiKey);
    setImportedKey(draft.apiKey != null);
    toastSettingsSuccess("已导入 curl 配置，请补全结果映射");
  };

  /** 注入方式快捷选择：把选中的 header（值含 `{{apiKey}}`）写进 Headers JSON。 */
  const applyInjection = (label: string) => {
    const option = INJECTION_OPTIONS.find((item) => item.label === label);
    if (option == null) return;
    const headers = parseHeaders(form.headersJson);
    if (typeof headers === "string") {
      toastSettingsError(headers);
      return;
    }
    setForm({ ...form, headersJson: JSON.stringify({ ...headers, [option.header]: option.value }, null, 2) });
  };

  // 编辑态但库里已找不到（如自定义实例被删）：回到列表页
  if (!isCreate && engine == null) {
    return (
      <SettingsPanel>
        <SettingsFormSection title="搜索引擎">
          <p className="settings-hint">引擎不存在，可能已被删除。</p>
          <Button variant="secondary" onClick={() => nav.pop()}>
            返回列表
          </Button>
        </SettingsFormSection>
      </SettingsPanel>
    );
  }

  const templateFields = (
    <>
      <SettingsField label="Method">
        <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value === "GET" ? "GET" : "POST" })}>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
        </select>
      </SettingsField>
      <SettingsField label="URL（可含 {{query}} / {{count}} / {{apiKey}} / {{baseUrl}}）">
        <input type="text" value={form.url} placeholder="https://api.example.com/search?q={{query}}" onChange={(e) => setForm({ ...form, url: e.target.value })} />
      </SettingsField>
      <SettingsField label="Headers（JSON 对象）">
        <textarea rows={4} value={form.headersJson} onChange={(e) => setForm({ ...form, headersJson: e.target.value })} placeholder={'{"Authorization": "Bearer {{apiKey}}"}'} />
      </SettingsField>
      <SettingsField label="请求体模板（POST 必填，合法 JSON 对象文本）">
        <textarea rows={4} value={form.bodyTemplate} onChange={(e) => setForm({ ...form, bodyTemplate: e.target.value })} placeholder={'{"query": "{{query}}", "count": "{{count}}"}'} />
      </SettingsField>
      <SettingsField label="结果数组路径（点路径；空 = 根节点即数组）">
        <input type="text" value={form.resultPath} placeholder="results" onChange={(e) => setForm({ ...form, resultPath: e.target.value })} />
      </SettingsField>
      <SettingsField label="标题候选字段（逗号分隔，按序取首个非空）">
        <input type="text" value={form.fieldMapTitle} onChange={(e) => setForm({ ...form, fieldMapTitle: e.target.value })} />
      </SettingsField>
      <SettingsField label="链接候选字段（逗号分隔）">
        <input type="text" value={form.fieldMapUrl} onChange={(e) => setForm({ ...form, fieldMapUrl: e.target.value })} />
      </SettingsField>
      <SettingsField label="摘要候选字段（逗号分隔）">
        <input type="text" value={form.fieldMapSnippet} onChange={(e) => setForm({ ...form, fieldMapSnippet: e.target.value })} />
      </SettingsField>
      <SettingsField label="answer 点路径（可选；命中非空字符串时透传）">
        <input type="text" value={form.answerPath} onChange={(e) => setForm({ ...form, answerPath: e.target.value })} />
      </SettingsField>
      <SettingsField label="业务码路径（可选；如 code，取到值且不在成功码内视为失败）">
        <input type="text" value={form.envelopeCodePath} placeholder="code" onChange={(e) => setForm({ ...form, envelopeCodePath: e.target.value })} />
      </SettingsField>
      <SettingsField label="业务码成功值（逗号分隔；留空默认 200）">
        <input type="text" value={form.envelopeOkValues} placeholder="200" onChange={(e) => setForm({ ...form, envelopeOkValues: e.target.value })} />
      </SettingsField>
      <SettingsField label="业务码错误消息路径（可选；脱敏后进错误文案）">
        <input type="text" value={form.envelopeMsgPath} placeholder="msg" onChange={(e) => setForm({ ...form, envelopeMsgPath: e.target.value })} />
      </SettingsField>
      <SettingsField label="参数说明（拼进工具描述，≤500 字符）">
        <textarea rows={3} value={form.paramHint} onChange={(e) => setForm({ ...form, paramHint: e.target.value })} placeholder="可经 params 透传……" />
      </SettingsField>
    </>
  );

  return (
    <SettingsPanel>
      <SettingsFormSection
        title={title}
        desc={isCreate ? "从 curl 导入或直接填写请求模板；API Key 经本机安全密钥库存储。" : customDef != null ? "自定义引擎；API Key 经本机安全密钥库存储。" : `${ENGINE_META[engineId]?.desc ?? ""} · 预置引擎`}
        footer={
          <Button variant="primary" disabled={saving || clearing || testing} onClick={() => void save()}>
            {saving ? "保存中…" : isCreate ? "创建" : "保存"}
          </Button>
        }
      >
        {isCreate ? (
          <SettingsSection title="从 curl 导入" desc="粘贴一条 curl 命令（支持 -X / -H / -d / --data-raw / -G）；识别到的明文密钥会替换为 {{apiKey}} 并在保存时写入安全密钥库。">
            <SettingsField label="curl 命令">
              <textarea rows={5} value={curlText} onChange={(e) => setCurlText(e.target.value)} placeholder={"curl -X POST https://api.example.com/search -H 'Authorization: Bearer sk-xxx' -d '{\"query\":\"{{query}}\"}'"} />
            </SettingsField>
            <Button variant="secondary" onClick={importCurl}>
              解析并预填
            </Button>
            {importedKey ? <p className="settings-hint">已识别到密钥，已填入下方 API Key 输入框；保存后写入安全密钥库。</p> : null}
          </SettingsSection>
        ) : null}

        <SettingsSection title="连接配置">
          {isCreate || customDef != null ? (
            <SettingsField label="显示名称">
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：我的搜索 API" />
            </SettingsField>
          ) : null}
          {isCreate ? null : (
            <SettingsField label="密钥状态" row>
              <ApiKeyStatusTag status={engine?.hasKey === true ? "set" : "not set"} />
            </SettingsField>
          )}
          {isCreate || engine?.needsKey === true || usesApiKey ? (
            <SettingsField label={engine?.hasKey === true ? "新 API Key（留空则不修改）" : "API Key"}>
              <input type="password" value={apiKey} autoComplete="new-password" onChange={(e) => setApiKey(e.target.value)} />
            </SettingsField>
          ) : null}
          {isCreate || customDef != null ? (
            <SettingsField label="密钥注入方式（快捷写入 Headers，模板里保留 {{apiKey}} 占位符）">
              <select value="" onChange={(e) => applyInjection(e.target.value)}>
                <option value="">选择注入方式…</option>
                {INJECTION_OPTIONS.map((option) => (
                  <option key={option.label} value={option.label}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SettingsField>
          ) : null}
          {engine?.hasKey === true && !isCreate ? (
            <Button variant="secondary" disabled={busy} onClick={() => void clearKey()}>
              {clearing ? "清除中…" : "清除密钥"}
            </Button>
          ) : null}
          {isCreate || engine?.needsBaseUrl === true || usesBaseUrl ? (
            <SettingsField label="实例 Base URL（服务模板中的 {{baseUrl}}；留空 = 清除）">
              <input type="text" value={baseUrl} placeholder="https://searxng.example.com" onChange={(e) => setBaseUrl(e.target.value)} />
            </SettingsField>
          ) : null}
        </SettingsSection>

        <SettingsSection title="请求模板">
          {isPreset ? (
            <>
              <div className="settings-form-actions">
                <Button variant="secondary" onClick={() => setTemplateOpen((open) => !open)}>
                  {templateOpen ? "收起高级编辑" : "高级编辑"}
                </Button>
                {config?.presetOverrides[engineId] === true ? (
                  <Button variant="secondary" disabled={busy} onClick={() => void resetTemplate()}>
                    恢复默认
                  </Button>
                ) : null}
              </div>
              {config?.presetOverrides[engineId] === true ? <p className="settings-hint">该引擎已有自定义覆盖；高级编辑显示出厂模板，保存时只提交你修改过的字段，未改字段保留既有覆盖。</p> : null}
              {templateOpen ? templateFields : <p className="settings-hint">{config?.presetOverrides[engineId] === true ? "当前使用已保存的自定义覆盖" : "当前使用出厂模板"}；展开「高级编辑」可修改 method / URL / headers / 请求体 / 结果映射。</p>}
            </>
          ) : (
            templateFields
          )}
        </SettingsSection>

        <SettingsSection title="测试" desc="草稿直测：用当前表单内容真实发起一次搜索（不保存），会消耗该引擎的调用配额。">
          <SettingsField label="测试查询">
            <input type="text" value={testQuery} onChange={(e) => setTestQuery(e.target.value)} placeholder="例如：人工智能" />
          </SettingsField>
          <Button variant="secondary" disabled={busy} onClick={() => void runTest()}>
            {testing ? "测试中…" : "测试"}
          </Button>
          {testResult != null ? <p className="settings-hint">命中 {testResult.count} 条{testResult.titles.length > 0 ? `：${testResult.titles.join(" / ")}` : "（无结果标题）"}</p> : null}
        </SettingsSection>

        {customDef != null ? (
          <SettingsSection title="删除引擎" desc="删除后该引擎的模板、密钥与本机保存的实例地址会一并清除。">
            <Button variant="danger" disabled={busy} onClick={() => setDeleteOpen(true)}>
              删除自定义引擎
            </Button>
          </SettingsSection>
        ) : null}

        <SettingsStatus error={error} />
      </SettingsFormSection>
      <ConfirmModal
        open={deleteOpen}
        title="删除自定义引擎"
        message={`确定删除「${engine?.name ?? ""}」吗？`}
        confirmLabel="删除"
        danger
        busy={busy}
        onConfirm={() => void removeEngine()}
        onCancel={() => setDeleteOpen(false)}
      />
    </SettingsPanel>
  );
}
