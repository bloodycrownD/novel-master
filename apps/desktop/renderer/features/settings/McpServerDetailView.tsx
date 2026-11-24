/**
 * 设置 · MCP 服务器详情页（两级结构第二级，照搜索引擎详情页同构）：
 * `navState.editingMcpServerId` 定位单 server，编辑 + create 模式（哨兵复用本 viewId）。
 * 表单：名称 / 传输方式（HTTP / SSE / stdio——后两者只归一不可连，选项文案就地标注）/
 * URL / 请求超时 / 认证三态（无 / Bearer / OAuth 2.1）。Bearer 明文只在输入框停留，
 * 保存经 IPC 写 SKSP（留空保留、清除按钮传空串）；OAuth 区显示授权状态并在「发起授权」
 * 时走 main 侧 loopback 回调（invoke 挂起至浏览器授权完成）。测试连接先静默保存
 * （main 按已存配置测），结果读 `McpServerStatus`——失败时 `failure.detail` 原文展示。
 * 说明文字一组一条（表单尾部脚注），整组事实性说明不再按字段重复。
 */
import { useCallback, useEffect, useState } from "react";
import type { McpAuthType, McpServerStatus, McpTransportType } from "@shared/ipc-types";
import { ipcMcpDeleteServer, ipcMcpListServers, ipcMcpOAuthStart, ipcMcpOAuthStatuses, ipcMcpSaveServer, ipcMcpTestConnection } from "@/ipc/client";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { toastSettingsSuccess } from "@/utils/settings-feedback";
import { mcpT } from "../../i18n/settings";
import type { SettingsNavHandle } from "./settings-nav";
import { mcpStatusLabel, mcpStatusTagClass, NEW_MCP_SERVER_SENTINEL } from "./mcp-server-meta";
import { SettingsField, SettingsFormSection, SettingsPanel, SettingsSection, SettingsStatus } from "./settings-ui";

/** 表单草稿（timeout 以文本承载，提交时才数值化；空串 = 用默认）。 */
type McpServerFormState = {
    name: string;
    transportType: McpTransportType;
    url: string;
    timeoutText: string;
    authType: McpAuthType;
};

const EMPTY_FORM: McpServerFormState = { name: "", transportType: "http", url: "", timeoutText: "", authType: "none" };

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
    const [deleteOpen, setDeleteOpen] = useState(false);

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
            setForm({ name: entry.name, transportType: entry.transport.type, url: entry.transport.type === "stdio" ? "" : entry.transport.url, timeoutText: String(entry.timeoutMs), authType: entry.auth.type });
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
                <SettingsFormSection title={mcpT({ key: "mcp.nav_label" })}>
                    <p className="settings-hint">{mcpT({ key: "mcp.list.empty" })}</p>
                    <Button variant="secondary" onClick={() => nav.pop()}>
                        {mcpT({ key: "mcp.detail.back_to_list" })}
                    </Button>
                </SettingsFormSection>
            </SettingsPanel>
        );
    }

    // 编辑态首次读库完成前只显示加载提示（避免空表单闪一下再被回填覆盖）。
    if (!isCreate && !loaded) {
        return (
            <SettingsPanel>
                <p className="settings-hint">{mcpT({ key: "mcp.list.loading" })}</p>
            </SettingsPanel>
        );
    }

    const busy = saving || testing || authorizing;

    /**
     * 保存草稿（测试连接 / 发起授权前也走这里，main 按已存配置操作）。
     * 返回成功时的 serverId（新建后即得真 id）；失败置页内错误返回 null。
     * bearerToken：输入框非空 → 覆盖；clearToken=true → 传空串清除；否则不传（保留）。
     */
    const save = async (clearToken = false): Promise<string | null> => {
        setSaving(true);
        setError(undefined);
        try {
            const timeoutValue = Number(form.timeoutText.trim());
            const res = await ipcMcpSaveServer({
                ...(isCreate ? {} : { id: effectiveId }),
                name: form.name.trim(),
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
                title={isCreate ? mcpT({ key: "mcp.list.add" }) : form.name}
                footer={
                    <Button variant="primary" disabled={busy} onClick={() => void save().then((id) => id != null && toastSettingsSuccess(mcpT({ key: "mcp.toast.saved" })))}>
                        {saving ? mcpT({ key: "mcp.detail.saving" }) : isCreate ? mcpT({ key: "mcp.detail.create" }) : mcpT({ key: "mcp.detail.save" })}
                    </Button>
                }
            >
                <SettingsField label={mcpT({ key: "mcp.detail.name_label" })}>
                    <input type="text" value={form.name} placeholder={mcpT({ key: "mcp.detail.name_placeholder" })} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </SettingsField>
                <SettingsField label={mcpT({ key: "mcp.detail.transport_label" })}>
                    <select value={form.transportType} onChange={(e) => setForm({ ...form, transportType: e.target.value as McpTransportType })}>
                        <option value="http">{mcpT({ key: "mcp.transport.http" })}</option>
                        <option value="sse">{mcpT({ key: "mcp.transport.sse" })}</option>
                        <option value="stdio">{mcpT({ key: "mcp.transport.stdio" })}</option>
                    </select>
                </SettingsField>
                {form.transportType !== "stdio" ? (
                    <SettingsField label={mcpT({ key: "mcp.detail.url_label" })}>
                        <input type="text" value={form.url} placeholder={mcpT({ key: "mcp.detail.url_placeholder" })} onChange={(e) => setForm({ ...form, url: e.target.value })} />
                    </SettingsField>
                ) : null}
                <SettingsField label={mcpT({ key: "mcp.detail.timeout_label" })}>
                    <input type="text" inputMode="numeric" value={form.timeoutText} placeholder="120000" onChange={(e) => setForm({ ...form, timeoutText: e.target.value })} />
                    <span className="settings-hint">{mcpT({ key: "mcp.detail.timeout_hint" })}</span>
                </SettingsField>
                <SettingsField label={mcpT({ key: "mcp.detail.auth_label" })}>
                    <select value={form.authType} onChange={(e) => setForm({ ...form, authType: e.target.value as McpAuthType })}>
                        <option value="none">{mcpT({ key: "mcp.auth.none" })}</option>
                        <option value="bearer">{mcpT({ key: "mcp.auth.bearer" })}</option>
                        <option value="oauth">{mcpT({ key: "mcp.auth.oauth" })}</option>
                    </select>
                </SettingsField>
                {form.authType === "bearer" ? (
                    <SettingsField label={mcpT({ key: "mcp.detail.token_label" })}>
                        <input type="password" value={token} autoComplete="new-password" onChange={(e) => setToken(e.target.value)} />
                        {!isCreate ? (
                            <Button variant="secondary" disabled={busy} onClick={() => void save(true).then((id) => id != null && toastSettingsSuccess(mcpT({ key: "mcp.toast.saved" })))}>
                                {mcpT({ key: "mcp.detail.clear_token" })}
                            </Button>
                        ) : null}
                    </SettingsField>
                ) : null}
                {form.authType === "oauth" ? (
                    <SettingsSection title={mcpT({ key: "mcp.detail.oauth_section" })}>
                        <SettingsField label={mcpT({ key: "mcp.detail.oauth_status_label" })} row>
                            <span className={oauthAuthorized ? "settings-tag settings-tag--ok" : "settings-tag settings-tag--muted"}>{oauthAuthorized ? mcpT({ key: "mcp.oauth.authorized" }) : mcpT({ key: "mcp.oauth.not_authorized" })}</span>
                        </SettingsField>
                        {/* 发起授权：先保存（拿真 id）再走 main loopback——invoke 挂起至浏览器授权完成（busy 互斥态就地维护）。 */}
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
                                    toastSettingsSuccess(mcpT({ key: "mcp.oauth.authorized" }));
                                } catch (e) {
                                    setError(e instanceof Error ? e.message : String(e));
                                } finally {
                                    setAuthorizing(false);
                                }
                            }}
                        >
                            {authorizing ? mcpT({ key: "mcp.oauth.waiting" }) : mcpT({ key: "mcp.oauth.start" })}
                        </Button>
                    </SettingsSection>
                ) : null}
                <SettingsStatus message={testStatus?.state === "ready" ? mcpStatusLabel(testStatus) : undefined} error={error} />
                <p className="settings-hint">{mcpT({ key: "mcp.detail.group_hint" })}</p>
            </SettingsFormSection>
            <SettingsSection title={mcpT({ key: "mcp.detail.test" })}>
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
                    {testing ? mcpT({ key: "mcp.detail.testing" }) : mcpT({ key: "mcp.detail.test" })}
                </Button>
                {testStatus != null ? (
                    <p className="settings-hint">
                        <span className={mcpStatusTagClass(testStatus.state)}>{mcpStatusLabel(testStatus)}</span>
                        {testStatus.failure?.detail != null ? ` ${testStatus.failure.detail}` : ""}
                    </p>
                ) : null}
            </SettingsSection>
            {!isCreate ? (
                <SettingsSection title={mcpT({ key: "mcp.detail.delete_title" })}>
                    <Button variant="danger" disabled={busy} onClick={() => setDeleteOpen(true)}>
                        {mcpT({ key: "mcp.detail.delete_title" })}
                    </Button>
                </SettingsSection>
            ) : null}
            <ConfirmModal
                open={deleteOpen}
                title={mcpT({ key: "mcp.detail.delete_title" })}
                message={mcpT({ key: "mcp.detail.delete_confirm", params: { name: form.name } })}
                confirmLabel={mcpT({ key: "mcp.list.menu.delete" })}
                danger
                busy={busy}
                onConfirm={() => {
                    void (async () => {
                        setSaving(true);
                        try {
                            const res = await ipcMcpDeleteServer({ serverId: effectiveId });
                            setDeleteOpen(false);
                            if (!res.ok) {
                                setError(res.error.message);
                                return;
                            }
                            toastSettingsSuccess(mcpT({ key: "mcp.toast.deleted" }));
                            nav.pop();
                        } finally {
                            setSaving(false);
                        }
                    })();
                }}
                onCancel={() => setDeleteOpen(false)}
            />
        </SettingsPanel>
    );
}
