/**
 * 设置 · MCP 服务器详情页（两级结构第二级，照搜索引擎详情页同构）：
 * `navState.editingMcpServerId` 定位单 server，编辑 + create 模式（哨兵复用本 viewId）。
 * 表单：ID（`mcp__<ID>__<tool>` 的服务器段，只允许英文字母、数字和下划线，编辑时可改——
 * 换 ID 由 main 侧 rename 改写 agent 工具引用并迁移密钥）/ 描述（选填）/ 传输类型（HTTP /
 * SSE / stdio——后两者只归一不可连，不可用原因由 server 状态位置的 `failure.detail` 事实
 * 提示承担）/ 地址 / 超时时间 / 认证三态（无 / Bearer / OAuth）。Bearer 明文只在输入框
 * 停留，保存经 IPC 写 SKSP（留空保留、清除按钮传空串）；OAuth 区显示授权状态并在「发起
 * 授权」时走 main 侧 loopback 回调（invoke 挂起至浏览器授权完成）。测试连接先静默保存
 * （main 按已存配置测），结果读 `McpServerStatus`——失败时 `failure.detail` 原文展示。
 */
import { useCallback, useEffect, useState } from "react";
import { McpId } from "@shared/logic/mcp-id";
import type { McpAuthType, McpServerStatus, McpTransportType } from "@shared/ipc-types";
import { ipcMcpListServers, ipcMcpOAuthStart, ipcMcpOAuthStatuses, ipcMcpSaveServer, ipcMcpTestConnection } from "@/ipc/client";
import { Button } from "@/components/ui/Button";
import { toastSettingsSuccess } from "@/utils/settings-feedback";
import { coreT } from "@shared/logic/core-i18n";
import { settingsTranslator } from "../../i18n/settings";
import type { SettingsNavHandle } from "./settings-nav";
import { mcpStatusLabel, NEW_MCP_SERVER_SENTINEL } from "./mcp-server-meta";
import { SettingsField, SettingsFormSection, SettingsPanel, SettingsSection, SettingsStatus } from "./settings-ui";

/** 表单草稿（timeout 以文本承载，提交时才数值化；空串 = 用默认）。 */
type McpServerFormState = {
    id: string;
    description: string;
    transportType: McpTransportType;
    url: string;
    timeoutText: string;
    authType: McpAuthType;
};

const EMPTY_FORM: McpServerFormState = { id: "", description: "", transportType: "http", url: "", timeoutText: "", authType: "none" };

export function McpServerDetailView({ nav }: { nav: SettingsNavHandle }) {
    const serverId = nav.navState.editingMcpServerId;
    const [form, setForm] = useState<McpServerFormState>(EMPTY_FORM);
    const [token, setToken] = useState("");
    /** 本会话保存后的真 id（新建保存成功即替换哨兵——后续保存带 id 更新而非再建）。 */
    const [savedId, setSavedId] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [authorizing, setAuthorizing] = useState(false);
    const [error, setError] = useState<string | undefined>();
    /** 最近一次测试连接的结果（tag + 原文展示）；null = 本会话未测过。 */
    const [testStatus, setTestStatus] = useState<McpServerStatus | null>(null);
    const [oauthAuthorized, setOauthAuthorized] = useState(false);

    const isCreate = serverId === NEW_MCP_SERVER_SENTINEL && savedId == null;
    // 早退守卫保证 serverId 非空；`?? NEW_MCP_SERVER_SENTINEL` 只是类型收窄（闭包里拿不到早退信息）。
    const effectiveId = savedId ?? serverId ?? NEW_MCP_SERVER_SENTINEL;

    const reloadOAuth = useCallback(async (id: string): Promise<void> => {
        const res = await ipcMcpOAuthStatuses();
        if (res.ok) setOauthAuthorized(res.data[id] === true);
    }, []);

    const reload = useCallback(async (): Promise<void> => {
        if (serverId == null || serverId === NEW_MCP_SERVER_SENTINEL) return;
        const res = await ipcMcpListServers();
        if (!res.ok) {
            setError(res.error.message);
            setLoaded(true);
            return;
        }
        const entry = res.data.find((server) => server.id === serverId);
        if (entry != null) {
            setForm({ id: entry.id, description: entry.description, transportType: entry.transport.type, url: entry.transport.type === "stdio" ? "" : entry.transport.url, timeoutText: String(entry.timeoutMs), authType: entry.auth.type });
            if (entry.auth.type === "oauth") void reloadOAuth(entry.id);
        }
        setLoaded(true);
    }, [serverId, reloadOAuth]);

    useEffect(() => {
        if (serverId == null || serverId === NEW_MCP_SERVER_SENTINEL) {
            setLoaded(true);
            return;
        }
        void reload();
    }, [serverId, reload]);

    // navState 脏值（绕过列表页直跳）兜底：回到列表页
    if (serverId == null) {
        return (
            <SettingsPanel>
                <SettingsFormSection title={coreT({ key: "ui.nav.mcp_servers" })}>
                    <p className="settings-hint">{settingsTranslator({ key: "settings.mcp.list.empty" })}</p>
                    <Button variant="secondary" onClick={() => nav.pop()}>
                        {settingsTranslator({ key: "settings.mcp.detail.back_to_list.desktop" })}
                    </Button>
                </SettingsFormSection>
            </SettingsPanel>
        );
    }

    // 编辑态首次读库完成前只显示加载提示（避免空表单闪一下再被回填覆盖）。
    if (!isCreate && !loaded) {
        return (
            <SettingsPanel>
                <p className="settings-hint">{settingsTranslator({ key: "settings.mcp.list.loading.desktop" })}</p>
            </SettingsPanel>
        );
    }

    const busy = saving || testing || authorizing;

    /**
     * 保存草稿（测试连接 / 发起授权前也走这里，main 按已存配置操作）。
     * 返回成功时的 serverId（新建 / 换 ID 后即得真 id）；失败置页内错误返回 null。
     * ID 空与非法在 renderer 拦（i18n 文案），撞已有 ID 预查列表后同样拦；main 的
     * create / rename 是权威兜底。bearerToken：输入框非空 → 覆盖；clearToken=true →
     * 传空串清除；否则不传（换 ID 时保留随迁的旧值）。
     */
    const save = async (clearToken = false): Promise<string | null> => {
        setSaving(true);
        setError(undefined);
        try {
            const timeoutValue = Number(form.timeoutText.trim());
            const nextId = form.id.trim();
            if (!McpId.isValid(nextId)) {
                setError(settingsTranslator({ key: nextId === "" ? "settings.mcp.validation.id_required" : "settings.mcp.validation.id_invalid" }));
                return null;
            }
            const listed = await ipcMcpListServers();
            if (listed.ok && listed.data.some((server) => server.id === nextId && server.id !== effectiveId)) {
                setError(settingsTranslator({ key: "settings.mcp.validation.id_exists" }));
                return null;
            }
            const res = await ipcMcpSaveServer({
                id: nextId,
                ...(isCreate ? { create: true } : { previousId: effectiveId }),
                description: form.description.trim(),
                transportType: form.transportType,
                url: form.transportType === "stdio" ? undefined : form.url.trim(),
                timeoutMs: form.timeoutText.trim() !== "" && Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : undefined,
                authType: form.authType,
                ...(token.trim() !== "" ? { bearerToken: token.trim() } : clearToken ? { bearerToken: "" } : {}),
            });
            if (!res.ok) {
                setError(res.error.message);
                return null;
            }
            setSavedId(res.data.serverId);
            // 换 ID 后把导航指针拨到新 id：reload 与后续保存都按新 id 找配置。
            nav.navState.editingMcpServerId = res.data.serverId;
            setToken(""); // 密码框回落空白（不留明文残影）
            await reload();
            if (form.authType === "oauth") void reloadOAuth(res.data.serverId);
            return res.data.serverId;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return null;
        } finally {
            setSaving(false);
        }
    };

    return (
        <SettingsPanel>
            <SettingsFormSection
                title={isCreate ? settingsTranslator({ key: "settings.mcp.detail.create_action" }) : form.id}
                footer={
                    <Button variant="primary" disabled={busy} onClick={() => void save().then((id) => id != null && toastSettingsSuccess(settingsTranslator({ key: "settings.mcp.toast.saved" })))}>
                        {saving ? settingsTranslator({ key: "settings.mcp.detail.saving.desktop" }) : isCreate ? settingsTranslator({ key: "settings.mcp.detail.create.desktop" }) : settingsTranslator({ key: "settings.mcp.detail.save_action" })}
                    </Button>
                }
            >
                <SettingsField label={settingsTranslator({ key: "settings.mcp.detail.id_label" })}>
                    <input type="text" value={form.id} placeholder={settingsTranslator({ key: "settings.mcp.detail.id_placeholder" })} onChange={(e) => setForm({ ...form, id: e.target.value })} />
                </SettingsField>
                <SettingsField label={settingsTranslator({ key: "settings.mcp.detail.description_label" })}>
                    <input type="text" value={form.description} placeholder={settingsTranslator({ key: "settings.mcp.detail.description_placeholder" })} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </SettingsField>
                <SettingsField label={settingsTranslator({ key: "settings.mcp.detail.transport_label" })}>
                    <select value={form.transportType} onChange={(e) => setForm({ ...form, transportType: e.target.value as McpTransportType })}>
                        <option value="http">{settingsTranslator({ key: "settings.mcp.detail.transport_http" })}</option>
                        <option value="sse">{settingsTranslator({ key: "settings.mcp.detail.transport_sse" })}</option>
                        <option value="stdio">{settingsTranslator({ key: "settings.mcp.detail.transport_stdio.desktop" })}</option>
                    </select>
                </SettingsField>
                {form.transportType !== "stdio" ? (
                    <SettingsField label={settingsTranslator({ key: "settings.mcp.detail.url_label" })}>
                        <input type="text" value={form.url} placeholder={settingsTranslator({ key: "settings.mcp.detail.url_placeholder" })} onChange={(e) => setForm({ ...form, url: e.target.value })} />
                    </SettingsField>
                ) : null}
                <SettingsField label={settingsTranslator({ key: "settings.mcp.detail.timeout_label" })}>
                    <input type="text" inputMode="numeric" value={form.timeoutText} placeholder="120000" onChange={(e) => setForm({ ...form, timeoutText: e.target.value })} />
                    <span className="settings-hint">{settingsTranslator({ key: "settings.mcp.detail.timeout_hint.desktop" })}</span>
                </SettingsField>
                <SettingsField label={settingsTranslator({ key: "settings.mcp.detail.auth_label" })}>
                    <select value={form.authType} onChange={(e) => setForm({ ...form, authType: e.target.value as McpAuthType })}>
                        <option value="none">{settingsTranslator({ key: "settings.mcp.detail.auth_none" })}</option>
                        <option value="bearer">{settingsTranslator({ key: "settings.mcp.detail.auth_bearer.desktop" })}</option>
                        <option value="oauth">{settingsTranslator({ key: "settings.mcp.detail.auth_oauth" })}</option>
                    </select>
                </SettingsField>
                {form.authType === "bearer" ? (
                    <SettingsField label={settingsTranslator({ key: "settings.mcp.detail.bearer_token_label.desktop" })}>
                        <input type="password" value={token} autoComplete="new-password" onChange={(e) => setToken(e.target.value)} />
                        {!isCreate ? (
                            <Button variant="secondary" disabled={busy} onClick={() => void save(true).then((id) => id != null && toastSettingsSuccess(settingsTranslator({ key: "settings.mcp.toast.saved" })))}>
                                {settingsTranslator({ key: "settings.mcp.detail.clear_key.desktop" })}
                            </Button>
                        ) : null}
                    </SettingsField>
                ) : null}
                {form.authType === "oauth" ? (
                    <SettingsSection title={settingsTranslator({ key: "settings.mcp.detail.oauth_section.desktop" })}>
                        <SettingsField label={settingsTranslator({ key: "settings.mcp.detail.oauth_status_label" })} row>
                            <span className={oauthAuthorized ? "settings-tag settings-tag--ok" : "settings-tag settings-tag--muted"}>{oauthAuthorized ? settingsTranslator({ key: "settings.mcp.detail.authorized" }) : settingsTranslator({ key: "settings.mcp.detail.not_authorized" })}</span>
                        </SettingsField>
                        {/* 发起授权：先保存（拿真 id）再走 main loopback——main 侧开系统浏览器，invoke 挂起至授权完成（busy 互斥态就地维护）。 */}
                        <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={async () => {
                                if (busy) return;
                                setAuthorizing(true);
                                try {
                                    const id = await save();
                                    if (id == null) return;
                                    const res = await ipcMcpOAuthStart({ serverId: id });
                                    if (!res.ok) {
                                        setError(res.error.message);
                                        return;
                                    }
                                    setError(undefined);
                                    await reloadOAuth(id);
                                    toastSettingsSuccess(settingsTranslator({ key: "settings.mcp.toast.oauth_callback_ok" }));
                                } catch (e) {
                                    setError(e instanceof Error ? e.message : String(e));
                                } finally {
                                    setAuthorizing(false);
                                }
                            }}
                        >
                            {authorizing ? settingsTranslator({ key: "settings.mcp.detail.authorizing.desktop" }) : settingsTranslator({ key: "settings.mcp.detail.reauthorize.desktop" })}
                        </Button>
                    </SettingsSection>
                ) : null}
                <SettingsStatus message={testStatus?.state === "ready" ? mcpStatusLabel(testStatus) : undefined} error={error} />
            </SettingsFormSection>
            <SettingsSection title={settingsTranslator({ key: "settings.mcp.detail.test_connection" })}>
                {/* 测试连接：先静默保存（main 按已存配置测），失败态展示 failure.detail 原文（busy 互斥态就地维护）。 */}
                <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={async () => {
                        if (busy) return;
                        setTesting(true);
                        try {
                            const id = await save();
                            if (id == null) return;
                            const res = await ipcMcpTestConnection({ serverId: id });
                            if (!res.ok) {
                                setError(res.error.message);
                                return;
                            }
                            setTestStatus(res.data);
                            setError(undefined);
                            if (res.data.state !== "ready") setError(res.data.failure?.detail ?? mcpStatusLabel(res.data));
                        } catch (e) {
                            setError(e instanceof Error ? e.message : String(e));
                        } finally {
                            setTesting(false);
                        }
                    }}
                >
                    {testing ? settingsTranslator({ key: "settings.mcp.detail.testing" }) : settingsTranslator({ key: "settings.mcp.detail.test_connection" })}
                </Button>
            </SettingsSection>
        </SettingsPanel>
    );
}
