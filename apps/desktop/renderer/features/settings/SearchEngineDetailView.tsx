/**
 * 设置 · 搜索引擎详情页（两级结构第二级）：`navState.editingEngineId` 定位单引擎，
 * 三分支 + create 模式（v3 功能收缩拍板 A4：表单面与 mobile 同构——无请求体
 * defaultBody 编辑、无 `{{apiKey}}` 注入方式快捷选择、无测试搜索按钮，
 * desktop 侧 testEngine 已整链退役）：
 * - duckduckgo：内置代码引擎，只读说明（无表单无保存）；
 * - 预置（六出厂 id）：连接（method + url，内置只读；searxng URL 例外可改）+
 *   认证三态 + 参数说明（内置只读）+ key / baseUrl 表单 + 恢复默认；
 * - 自定义：连接（可编辑）+ 认证三态 + 参数说明 + key / baseUrl 表单 + 删除；
 * - create 模式（`editingEngineId === NEW_ENGINE_SENTINEL`，复用本 viewId）：
 *   curl 导入粘贴域 + 全量表单，保存走 `createCustomEngine` 后回列表。
 *
 * 表单字段集合与 mobile v3 对齐：name / method / url / headers / paramHint
 * （TEMPLATE_FIELDS 同步收窄，defaultBody 不参与预置差异比较）。headers 不出
 * 现在表单里：由「认证方式 + 请求头名称」在保存时重建认证头、出厂非认证头
 * 原样保留。预置引擎模板字段（method / url / 认证方式 / 参数说明）内置只读，
 * 与 mobile nameLocked 口径一致——UI 改写不到模板键，B-1 的「按出厂基线整键
 * 替换丢既有覆盖」路径随之关闭；改预置先「恢复默认」。
 * 保存前模板统一过 `validateSearchEngineTemplate`（Result 失败直接展示原因，
 * 不发 IPC）。保存 / 清除互斥（在途期间按钮禁用 + 交错点击直接忽略）。
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
  ipcSearchUpdateCustomEngine,
  ipcSearchUpdatePresetOverride,
} from "@/ipc/client";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { toastSettingsError, toastSettingsSuccess } from "@/utils/settings-feedback";
import { settingsTranslator } from "../../i18n/settings";
import type { SettingsNavHandle } from "./settings-nav";
import { NEW_ENGINE_SENTINEL, engineLabel, engineMeta } from "./search-engine-meta";
import { ApiKeyStatusTag, SettingsField, SettingsFormSection, SettingsPanel, SettingsSection, SettingsStatus } from "./settings-ui";

/** 出厂模板表（字面量类型 → 按 id 索引的只读视图）。 */
const PRESET_TEMPLATES: Readonly<Record<string, SearchEngineTemplate>> = PRESET_ENGINE_TEMPLATES;

/** 认证方式：Bearer / 自定义请求头 / 无认证（与 mobile 三态同构）。 */
type AuthStyle = "bearer" | "header" | "none";

/** 模板表单草稿：headers 只持有非认证头底座，认证头由认证方式在保存时重建。 */
type TemplateFormState = {
  name: string;
  method: "GET" | "POST";
  url: string;
  /** 非认证头底座（Content-Type / Accept 等出厂头），UI 不直接编辑。 */
  headers: Record<string, string>;
  /** 认证方式（保存时重建认证头，非认证头原样保留）。 */
  authStyle: AuthStyle;
  /** 自定义请求头名称（authStyle === "header" 时生效）。 */
  authHeaderName: string;
  paramHint: string;
};

/** 新建自定义引擎的初始表单（POST + JSON 内容头、Bearer 认证的常见形态；v3 无请求体字段）。 */
const EMPTY_FORM: TemplateFormState = {
  name: "",
  method: "POST",
  url: "",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  authStyle: "bearer",
  authHeaderName: "",
  paramHint: "",
};

/** 预置覆盖按差异提交时比较的模板字段（v3 起 UI 无请求体字段，defaultBody 不参与判定）。 */
const TEMPLATE_FIELDS = ["name", "method", "url", "headers", "paramHint"] as const;

/** headers 按键值对排序后序列化（认证头重建会改键序，乱序不算差异）。 */
const sortedHeadersJson = (headers: Record<string, unknown>): string => JSON.stringify(Object.entries(headers).sort());

/** 从模板 headers 反推认证三态（含 `{{apiKey}}` 的键视为认证头，首个定方式；非认证头进底座）。 */
function templateToForm(template: SearchEngineTemplate): TemplateFormState {
  let authStyle: AuthStyle = "none";
  let authHeaderName = "";
  const baseHeaders: Record<string, string> = {};
  for (const [headerName, value] of Object.entries(template.headers)) {
    if (!value.includes("{{apiKey}}")) {
      baseHeaders[headerName] = value;
      continue;
    }
    if (authStyle === "none") {
      if (headerName.toLowerCase() === "authorization") {
        authStyle = "bearer";
      } else {
        authStyle = "header";
        authHeaderName = headerName;
      }
    }
  }
  return { name: template.name, method: template.method, url: template.url, headers: baseHeaders, authStyle, authHeaderName, paramHint: template.paramHint };
}

export function SearchEngineDetailView({ nav }: { nav: SettingsNavHandle }) {
  const engineId = nav.navState.editingEngineId;
  const isCreate = engineId === NEW_ENGINE_SENTINEL;

  const [config, setConfig] = useState<SearchConfigDto | null>(null);
  const [form, setForm] = useState<TemplateFormState>(EMPTY_FORM);
  /** 预置模板的出厂初值（覆盖按差异提交的 diff 基线）；自定义 / create 恒 undefined。 */
  const [presetDefault, setPresetDefault] = useState<SearchEngineTemplate | undefined>();
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | undefined>();
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
      // B-1 口径：预置模板字段整体只读，预填出厂模板即可（生效模板未透出 IPC，
      // 但模板键 UI 改写不到，不存在按出厂基线整键替换丢覆盖的路径）
      const factory = entry.isCustom || entry.id === "duckduckgo" ? undefined : PRESET_TEMPLATES[entry.id];
      setPresetDefault(factory);
      const template = custom?.template ?? factory;
      if (template != null) setForm(templateToForm(template));
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
    const ddgMeta = engineMeta("duckduckgo");
    return (
      <SettingsPanel>
        <SettingsFormSection title={ddgMeta?.label ?? "DuckDuckGo"} desc={ddgMeta?.desc ?? ""}>
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
  const busy = saving || clearing;
  // 认证三态驱动 key 需求（v3 拍板：{{apiKey}} 宏校验退役，与 mobile draftNeedsKey 同源）；
  // baseUrl 需求与 mobile draftNeedsBaseUrl 同源：url / 非认证头值任一引用 {{baseUrl}} 即需要。
  const needsKey = form.authStyle !== "none";
  const needsBaseUrl = form.url.includes("{{baseUrl}}") || Object.values(form.headers).some((value) => value.includes("{{baseUrl}}"));
  const authStyleOptions: ReadonlyArray<{ readonly value: AuthStyle; readonly label: string }> = [
    // Bearer 为请求头格式串（非 catalog 文案），双端字面同款
    { value: "bearer", label: "Authorization: Bearer" },
    { value: "header", label: settingsTranslator({ key: "settings.search.auth.style.custom_header.mobile" }) },
    { value: "none", label: settingsTranslator({ key: "settings.search.auth.style.none.mobile" }) },
  ];
  const titleFallback = engineLabel(engineId) || settingsTranslator({ key: "settings.search.detail.engine_section.desktop" });
  const title = isCreate ? settingsTranslator({ key: "settings.search.list.create_custom" }) : engine?.name ?? titleFallback;
  // nm-style: keep-local — 保存分流 create/自定义/预置三分支，共享 saving 互斥态、
  // key/baseUrl 草稿与逐 IPC 失败短路；内联进 footer 按钮会拆散互斥与错误回显
  const save = async () => {
    if (busy) return;
    setSaving(true);
    setError(undefined);
    try {
      // 草稿 → 校验通过的模板：先取出厂非认证头底座，再按「认证方式 + 请求头名称」
      // 重建认证头（旧认证头一律清掉）；校验失败置页内错误并中止（不发 IPC）。
      const baseHeaders: Record<string, string> = { ...form.headers };
      for (const name of Object.keys(baseHeaders)) {
        if (baseHeaders[name]!.includes("{{apiKey}}")) delete baseHeaders[name];
      }
      const authName = form.authHeaderName.trim();
      if (form.authStyle === "bearer") baseHeaders.Authorization = "Bearer {{apiKey}}";
      else if (form.authStyle === "header" && authName.length > 0) baseHeaders[authName] = "{{apiKey}}";
      const validated = validateSearchEngineTemplate({ name: form.name, method: form.method, url: form.url, headers: baseHeaders, paramHint: form.paramHint });
      if (!validated.ok) {
        const { messageKey, message, messageParams } = validated.error;
        setError(coreT(messageKey == null ? { key: "error.tool.search_template_invalid", params: { reason: message } } : { key: messageKey, params: messageParams }));
        return;
      }
      const template = validated.value;
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
        // 自定义：模板整体替换（key 留空不动；baseUrl 模板引用时提交，空串清除）
        const input = {
          engineId,
          name: template.name,
          template,
          ...(key.length > 0 ? { apiKey: key } : {}),
          ...(needsBaseUrl ? { baseUrl: url } : {}),
        };
        const res = await ipcSearchUpdateCustomEngine(input);
        if (!res.ok) {
          setError(res.error.message);
          return;
        }
      } else if (presetDefault != null) {
        // 认证方式需要 key 而草稿未填且未存 key 时拦截（authStyle 判定，与 mobile 同源）
        if (needsKey && engine?.hasKey !== true && key.length === 0) {
          setError(settingsTranslator({ key: "settings.search.validation.api_key_required" }));
          return;
        }
        // 预置：只提交与出厂模板不同的字段，未改字段保留既有覆盖（patch 浅合并）；
        // headers 经认证头重建会改键序，按键值对排序后比较（乱序不算差异）
        const patch: Record<string, unknown> = {};
        const headersSame = sortedHeadersJson(presetDefault.headers) === sortedHeadersJson(template.headers);
        for (const field of TEMPLATE_FIELDS) {
          const same = field === "headers" ? headersSame : JSON.stringify(presetDefault[field]) === JSON.stringify(template[field]);
          if (!same) patch[field] = template[field];
        }
        // baseUrl 仅在草稿与已存值不同时提交（空串 = 清除；相同 = 无写操作）
        const baseUrlChanged = needsBaseUrl && url !== (engine?.baseUrl ?? "");
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

  // 模板字段（连接区）：预置 method 恒锁（J-1 双端对齐）；url 内置锁死、searxng 例外可改
  const connectionFields = (
    <>
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
      <SettingsField label={settingsTranslator({ key: "settings.search.detail.method_label.desktop" })}>
        <select
          value={form.method}
          disabled={isPreset}
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
      {/* 实例地址只服务模板里的 {{baseUrl}} 宏；searxng 出厂 URL 已是完整端点（示例地址），
          用户在 URL 字段里直接改成自己的实例即可。 */}
      {isCreate || needsBaseUrl ? (
        <SettingsField label={settingsTranslator({ key: "settings.search.auth.base_url_label.desktop" })}>
          <input type="text" value={baseUrl} placeholder="https://searxng.example.com" onChange={(e) => setBaseUrl(e.target.value)} />
        </SettingsField>
      ) : null}
    </>
  );

  // 认证区：三态下拉 + 自定义头名 + 密钥状态 / key 表单 / 清除。
  // 预置认证方式出厂只读（与 mobile nameLocked 同口径，模板键改写不到 → 覆盖不丢）；
  // 密钥走 SKSP、实例地址走 baseUrls，都不在模板字段内，预置覆盖期间仍可编辑。
  const authFields = (
    <>
      <SettingsField label={settingsTranslator({ key: "settings.search.auth.style_label.mobile" })}>
        <select value={form.authStyle} disabled={isPreset} onChange={(e) => setForm({ ...form, authStyle: e.target.value === "bearer" ? "bearer" : e.target.value === "header" ? "header" : "none" })}>
          {authStyleOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="settings-hint">{settingsTranslator({ key: "settings.search.auth.style_hint.mobile" })}</span>
      </SettingsField>
      {form.authStyle === "header" ? (
        <SettingsField label={settingsTranslator({ key: "settings.search.auth.header_name_label.mobile" })}>
          <input type="text" value={form.authHeaderName} placeholder="X-API-Key" disabled={isPreset} onChange={(e) => setForm({ ...form, authHeaderName: e.target.value })} />
          <span className="settings-hint">{settingsTranslator({ key: "settings.search.auth.header_name_hint.mobile" })}</span>
        </SettingsField>
      ) : null}
      {!isCreate ? (
        <SettingsField label={settingsTranslator({ key: "settings.search.auth.key_status_label.desktop" })} row>
          <ApiKeyStatusTag status={engine?.hasKey === true ? "set" : "not set"} />
        </SettingsField>
      ) : null}
      {isCreate || customDef != null || needsKey ? (
        <SettingsField label={engine?.hasKey === true ? settingsTranslator({ key: "settings.search.auth.new_key_label.desktop" }) : settingsTranslator({ key: "settings.search.auth.api_key_label" })}>
          <input type="password" value={apiKey} autoComplete="new-password" onChange={(e) => setApiKey(e.target.value)} />
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
            : `${engineMeta(engineId)?.desc ?? ""} · ${settingsTranslator({ key: "settings.search.meta.preset_label.desktop" })}`
        }
        footer={
          <Button variant="primary" disabled={saving || clearing} onClick={() => void save()}>
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
                // curl 导入：解析失败整体拒绝；成功一次回填方法/端点/请求头（认证头反推三态）
                // 与密钥。v3 表单无请求体字段，-d 原文不再预填 defaultBody。
                const parsed = parseCurlCommand(curlText);
                if (!parsed.ok) {
                  toastSettingsError(coreT(parsed.error.message));
                  return;
                }
                const draft = parsed.value;
                setForm(templateToForm({ name: form.name, method: draft.method, url: draft.url, headers: { ...draft.headers }, paramHint: form.paramHint }));
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

        {/* 预置覆盖回显：模板字段内置只读，覆盖内容 UI 改写不到（B-1 路径关闭），只留恢复默认出口 */}
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

        <SettingsSection title={settingsTranslator({ key: "settings.search.detail.connection_section.desktop" })}>{connectionFields}</SettingsSection>

        <SettingsSection title={settingsTranslator({ key: "settings.search.auth.section_title.mobile" })}>{authFields}</SettingsSection>

        <SettingsSection title={settingsTranslator({ key: "settings.search.params.title.desktop" })}>
          <SettingsField label={settingsTranslator({ key: "settings.search.params.title.desktop" })}>
            <textarea
              rows={3}
              value={form.paramHint}
              onChange={(e) => setForm({ ...form, paramHint: e.target.value })}
              placeholder={settingsTranslator({ key: "settings.search.params.placeholder.desktop" })}
              disabled={isPreset}
            />
            {/* FIX-26：裸形态 "{{count}}" 易误读为可写整值，双端统一强调带引号（文案与 mobile 同步） */}
            <span className="settings-hint">{settingsTranslator({ key: "settings.search.params.placeholder_note.desktop" })}</span>
          </SettingsField>
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
