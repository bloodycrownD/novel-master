/**
 * 设置 · MCP 服务器列表页（两级结构第一级，照搜索引擎配置页同构）：
 * 配置行来自 `ipcMcpListServers`（core 归一配置），状态标签来自 `ipcMcpServerStatuses`
 * （core 连接管理器同步读，错误原文 `failure.detail` 在详情页展示）。每行 = 名称 +
 * 状态标签 + 启用开关 + ⋮ 菜单（测试连接 / 删除）；点击行进详情页；页首「添加服务器」
 * 进详情页 create 模式（`NEW_MCP_SERVER_SENTINEL` 哨兵，不新增 viewId）、「导入 JSON」
 * 弹粘贴窗。详细说明收进页首「?」帮助弹窗，页内不铺长文案（双端同构口径）。
 */
import { useCallback, useEffect, useState } from "react";
import type { IpcResult, McpServerConfig, McpServerStatus } from "@shared/ipc-types";
import { ipcMcpDeleteServer, ipcMcpImportExternal, ipcMcpListServers, ipcMcpSaveServer, ipcMcpServerStatuses, ipcMcpTestConnection } from "@/ipc/client";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { Switch } from "@/components/ui/Switch";
import { toastSettingsSuccess } from "@/utils/settings-feedback";
import { mcpT } from "../../i18n/settings";
import type { SettingsNavHandle } from "./settings-nav";
import { mcpStatusLabel, mcpStatusTagClass, NEW_MCP_SERVER_SENTINEL } from "./mcp-server-meta";
import { SettingsListSection, SettingsPanel, SettingsStatus } from "./settings-ui";

export function McpServersView({ nav }: { nav: SettingsNavHandle }) {
    const [servers, setServers] = useState<readonly McpServerConfig[] | null>(null);
    const [statuses, setStatuses] = useState<readonly McpServerStatus[]>([]);
    const [menu, setMenu] = useState<{ serverId: string; x: number; y: number } | null>(null);
    /** 开关 / 测试 / 删除 / 导入在途（行控件整体禁点，避免交错提交）。 */
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const [helpOpen, setHelpOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [importText, setImportText] = useState("");
    /** 待确认删除的 server（null = 无）。 */
    const [deleteTarget, setDeleteTarget] = useState<McpServerConfig | null>(null);

    const reload = useCallback(async (): Promise<void> => {
        const [serversRes, statusesRes] = await Promise.all([ipcMcpListServers(), ipcMcpServerStatuses()]);
        if (serversRes.ok) setServers(serversRes.data);
        else setError(serversRes.error.message);
        if (statusesRes.ok) setStatuses(statusesRes.data);
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    /** busy 互斥的写模板：失败置页内错误返回 false；成功回读后 toast，busy 复位交 finally。 */
    const runWrite = async (action: () => Promise<IpcResult<unknown>>, success?: string): Promise<boolean> => {
        if (busy) return false;
        setBusy(true);
        setError(undefined);
        try {
            const res = await action();
            if (!res.ok) {
                setError(res.error.message);
                return false;
            }
            await reload();
            if (success != null) toastSettingsSuccess(success);
            return true;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return false;
        } finally {
            setBusy(false);
        }
    };

    // nm-style: keep-local — 删除失败也要收起确认框（错误经页内 SettingsStatus 展示），
    // 复用 busy 互斥态与回读；内联进 ConfirmModal onConfirm 会拆散收框不变量。
    const removeServer = async (): Promise<void> => {
        if (deleteTarget == null) return;
        setBusy(true);
        setError(undefined);
        try {
            const res = await ipcMcpDeleteServer({ serverId: deleteTarget.id });
            // 失败也收起确认框：错误经页内 SettingsStatus 展示，避免弹窗挡住原因
            setDeleteTarget(null);
            if (!res.ok) {
                setError(res.error.message);
                return;
            }
            await reload();
            toastSettingsSuccess(mcpT({ key: "mcp.toast.deleted" }));
        } catch (e) {
            setDeleteTarget(null);
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    // nm-style: keep-local — 导入共享 busy 互斥态、收窗与回读；内联进按钮 onClick 会拆散互斥与错误回显（照 SearchEngineDetailView 的 runWrite 先例）。
    /** 导入：JSON 形状校验在 renderer 拦（不发 IPC）；core 归一后无可识别条目时按提示回显。 */
    const runImport = async (): Promise<void> => {
        if (busy) return;
        try {
            JSON.parse(importText);
        } catch {
            setError(mcpT({ key: "mcp.import.invalid_json" }));
            return;
        }
        setBusy(true);
        setError(undefined);
        try {
            const res = await ipcMcpImportExternal({ raw: importText });
            if (!res.ok) {
                setError(res.error.message);
                return;
            }
            setImportOpen(false);
            setImportText("");
            if (res.data.length === 0) {
                setError(mcpT({ key: "mcp.import.empty_result" }));
                return;
            }
            await reload();
            toastSettingsSuccess(mcpT({ key: "mcp.toast.imported" }));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    /** 帮助弹窗分段（K-1 事实口径：只说这个选项是什么，不写建议句）。 */
    const helpSections: ReadonlyArray<{ title: string; body: string }> = [
        { title: mcpT({ key: "mcp.list.help.transport.title" }), body: mcpT({ key: "mcp.list.help.transport.body" }) },
        { title: mcpT({ key: "mcp.list.help.tools.title" }), body: mcpT({ key: "mcp.list.help.tools.body" }) },
        { title: mcpT({ key: "mcp.list.help.auth.title" }), body: mcpT({ key: "mcp.list.help.auth.body" }) },
        { title: mcpT({ key: "mcp.list.help.import.title" }), body: mcpT({ key: "mcp.list.help.import.body" }) },
    ];

    return (
        <SettingsPanel>
            <SettingsListSection
                header={
                    <div className="settings-toolbar settings-toolbar--end">
                        <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                                nav.navState.editingMcpServerId = NEW_MCP_SERVER_SENTINEL;
                                nav.push("mcpServerDetail");
                            }}
                        >
                            {mcpT({ key: "mcp.list.add" })}
                        </Button>
                        <Button variant="secondary" disabled={busy} onClick={() => setImportOpen(true)}>
                            {mcpT({ key: "mcp.list.import" })}
                        </Button>
                        <button type="button" className="icon-btn" aria-label={mcpT({ key: "mcp.list.help.title" })} onClick={() => setHelpOpen(true)}>
                            ?
                        </button>
                    </div>
                }
            >
                {servers == null && error == null ? <p className="settings-hint">{mcpT({ key: "mcp.list.loading" })}</p> : null}
                {(servers ?? []).map((server) => {
                    const status = statuses.find((entry) => entry.serverId === server.id);
                    return (
                        <div key={server.id} className="settings-list-item-row">
                            <button
                                type="button"
                                className="settings-list-item"
                                onClick={() => {
                                    nav.navState.editingMcpServerId = server.id;
                                    nav.push("mcpServerDetail");
                                }}
                            >
                                <span className="settings-list-item__label">{server.name}</span>
                                <span className="settings-list-item__meta">{status != null ? <span className={mcpStatusTagClass(status.state)}>{mcpStatusLabel(status)}</span> : null}</span>
                                <span className="settings-list-item__chevron" aria-hidden="true">
                                    ›
                                </span>
                            </button>
                            <span className="settings-list-item__switch">
                                {/* 开关提交完整草稿（bearerToken 不传 = 保留已存值）；构造内联自 meta 的单点 helper */}
                                <Switch
                                    checked={server.enabled}
                                    disabled={busy}
                                    onChange={(next) => void runWrite(() => ipcMcpSaveServer({ id: server.id, name: server.name, transportType: server.transport.type, url: server.transport.type === "stdio" ? undefined : server.transport.url, timeoutMs: server.timeoutMs, authType: server.auth.type, enabled: next }))}
                                    aria-label={server.name}
                                />
                            </span>
                            <button
                                type="button"
                                className="settings-list-item__menu-btn"
                                aria-label={server.name}
                                onClick={(e) => {
                                    if (busy) return;
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setMenu({ serverId: server.id, x: Math.max(8, rect.left), y: Math.max(8, rect.bottom + 4) });
                                }}
                            >
                                ⋮
                            </button>
                        </div>
                    );
                })}
                {servers != null && servers.length === 0 ? <p className="settings-list__empty">{mcpT({ key: "mcp.list.empty" })}</p> : null}
            </SettingsListSection>
            <SettingsStatus error={error} />
            <ContextMenu
                open={menu != null}
                x={menu?.x ?? 0}
                y={menu?.y ?? 0}
                items={
                    menu == null
                        ? []
                        : [
                                { label: mcpT({ key: "mcp.list.menu.test" }), action: "test", disabled: busy },
                                { label: mcpT({ key: "mcp.list.menu.delete" }), action: "delete", danger: true, disabled: busy },
                            ]
                }
                onSelect={(action) => {
                    const server = servers?.find((item) => item.id === menu?.serverId);
                    if (server == null) return;
                    if (action === "test") void runWrite(() => ipcMcpTestConnection({ serverId: server.id }));
                    if (action === "delete") setDeleteTarget(server);
                }}
                onClose={() => setMenu(null)}
            />
            <ConfirmModal
                open={deleteTarget != null}
                title={mcpT({ key: "mcp.detail.delete_title" })}
                message={mcpT({ key: "mcp.list.delete_confirm", params: { name: deleteTarget?.name ?? "" } })}
                confirmLabel={mcpT({ key: "mcp.list.menu.delete" })}
                danger
                busy={busy}
                onConfirm={() => void removeServer()}
                onCancel={() => setDeleteTarget(null)}
            />
            {importOpen ? (
                <div className="text-prompt-overlay" onClick={() => setImportOpen(false)}>
                    <div className="text-prompt-modal" role="dialog" aria-modal="true" aria-labelledby="mcp-import-title" onClick={(e) => e.stopPropagation()}>
                        <h3 id="mcp-import-title" className="text-prompt-modal__title">
                            {mcpT({ key: "mcp.import.title" })}
                        </h3>
                        <p className="settings-hint">{mcpT({ key: "mcp.import.label" })}</p>
                        <textarea rows={8} value={importText} placeholder={mcpT({ key: "mcp.import.placeholder" })} onChange={(e) => setImportText(e.target.value)} />
                        <div className="confirm-modal__actions">
                            <Button variant="secondary" onClick={() => setImportOpen(false)}>
                                {mcpT({ key: "mcp.list.help.dismiss" })}
                            </Button>
                            <Button variant="primary" disabled={busy || importText.trim().length === 0} onClick={() => void runImport()}>
                                {mcpT({ key: "mcp.list.import" })}
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}
            {helpOpen ? (
                <div className="text-prompt-overlay" onClick={() => setHelpOpen(false)}>
                    <div className="text-prompt-modal text-prompt-modal--wide" role="dialog" aria-modal="true" aria-labelledby="mcp-help-title" onClick={(e) => e.stopPropagation()}>
                        <h3 id="mcp-help-title" className="text-prompt-modal__title">
                            {mcpT({ key: "mcp.list.help.title" })}
                        </h3>
                        {helpSections.map((section) => (
                            <p key={section.title} className="settings-hint">
                                <strong>{section.title}：</strong>
                                {section.body}
                            </p>
                        ))}
                        <div className="confirm-modal__actions">
                            <Button variant="primary" onClick={() => setHelpOpen(false)}>
                                {mcpT({ key: "mcp.list.help.dismiss" })}
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}
        </SettingsPanel>
    );
}
