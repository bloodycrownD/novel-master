/**
 * 设置 · MCP 服务器列表页（两级结构第一级，照搜索引擎配置页同构）：
 * 配置行来自 `ipcMcpListServers`（core 归一配置），状态标签来自 `ipcMcpServerStatuses`
 * （core 连接管理器同步读；server 带失败时状态位置直显 `failure.detail` 原文，不自写
 * 文案）。每行 = ID + 描述副标 + 状态 + 启用开关 + ⋮ 菜单（测试连接 / 删除）；点击行进
 * 详情页；页首「新建服务器」进详情页 create 模式（`NEW_MCP_SERVER_SENTINEL` 哨兵，不新增
 * viewId）。详细说明收进页首「?」帮助弹窗，页内不铺长文案（双端同构口径）。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { IpcResult, McpServerConfig, McpServerStatus } from "@shared/ipc-types";
import { ipcMcpConnectUnconnected, ipcMcpDeleteServer, ipcMcpListServers, ipcMcpSaveServer, ipcMcpServerStatuses, ipcMcpTestConnection } from "@/ipc/client";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { Switch } from "@/components/ui/Switch";
import { toastSettingsSuccess } from "@/utils/settings-feedback";
import { coreT } from "@shared/logic/core-i18n";
import { settingsTranslator } from "../../i18n/settings";
import type { SettingsNavHandle } from "./settings-nav";
import { mcpStatusLabel, NEW_MCP_SERVER_SENTINEL } from "./mcp-server-meta";

/** 状态标签的色调变体（settings-tag）；pending / connecting / disconnected / disabled 中性、ready 绿、failed / unsupported 暖。 */
const MCP_STATUS_TAG_VARIANT: Readonly<Partial<Record<McpServerStatus["state"], string>>> = { ready: "settings-tag--ok", disconnected: "settings-tag--muted", failed: "settings-tag--warn", unsupported: "settings-tag--warn" };
import { SettingsListSection, SettingsPanel, SettingsStatus } from "./settings-ui";

export function McpServersView({ nav }: { nav: SettingsNavHandle }) {
    const [servers, setServers] = useState<readonly McpServerConfig[] | null>(null);
    const [statuses, setStatuses] = useState<readonly McpServerStatus[]>([]);
    const [menu, setMenu] = useState<{ serverId: string; x: number; y: number } | null>(null);
    /** 开关 / 测试 / 删除在途（行控件整体禁点，避免交错提交）。 */
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const [helpOpen, setHelpOpen] = useState(false);
    /** 待确认删除的 server（null = 无）。 */
    const [deleteTarget, setDeleteTarget] = useState<McpServerConfig | null>(null);

    /** 只重读列表与状态。写操作之后也走这里——不再顺带发起连接，否则页面上任何一次开关 / 保存 / 测试 / 删除都会替别的已断开服务器再连一轮。 */
    const reload = useCallback(async (): Promise<void> => {
        const [serversRes, statusesRes] = await Promise.all([ipcMcpListServers(), ipcMcpServerStatuses()]);
        if (serversRes.ok) setServers(serversRes.data);
        else setError(serversRes.error.message);
        if (statusesRes.ok) setStatuses(statusesRes.data);
    }, []);

    /** 进列表时发起一轮后台连接，每次进入只这一轮。 */
    const connectRound = useCallback(async (): Promise<void> => {
        const [serversRes, statusesRes] = await Promise.all([ipcMcpListServers(), ipcMcpServerStatuses()]);
        if (!serversRes.ok || !statusesRes.ok) return;
        const idle = serversRes.data.some((server) => {
            const state = statusesRes.data.find((status) => status.serverId === server.id)?.state ?? "pending";
            return server.enabled && (state === "pending" || state === "disconnected");
        });
        // connectUnconnected 只动「从未尝试 / 已断开」两态，已连接的不重拉、不作废缓存；发起后不等（免得连接预算把整页的可操作状态拖住），
        // 失败不自动重试（重试入口是「测试连接」）。
        if (!idle) return;
        void ipcMcpConnectUnconnected().then(async () => {
            const refreshed = await ipcMcpServerStatuses();
            if (refreshed.ok) setStatuses(refreshed.data);
        });
        // 发起后立即重读一次：让「连接中」先上屏（本轮结束后的重读在上面 then 里）。
        const kicking = await ipcMcpServerStatuses();
        if (kicking.ok) setStatuses(kicking.data);
    }, []);

    useEffect(() => {
        void reload().then(connectRound);
    }, [reload, connectRound]);

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
            toastSettingsSuccess(settingsTranslator({ key: "settings.mcp.toast.deleted" }));
        } catch (e) {
            setDeleteTarget(null);
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    /** 帮助弹窗分段（K-1 事实口径：只说这个选项是什么，不写建议句；传输类型的事实提示由 server 状态位置承担）。 */
    const helpSections: ReadonlyArray<{ title: string; body: string }> = [
        { title: settingsTranslator({ key: "settings.mcp.help.tools.title.desktop" }), body: settingsTranslator({ key: "settings.mcp.help.tools.body.desktop" }) },
        { title: settingsTranslator({ key: "settings.mcp.help.auth.title" }), body: settingsTranslator({ key: "settings.mcp.help.auth.body" }) },
    ];

    /** 行菜单目标 server 的连接中态（菜单项随之禁点）。 */
    const menuConnecting = menu != null && statuses.find((entry) => entry.serverId === menu.serverId)?.state === "connecting";

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
                            {settingsTranslator({ key: "settings.mcp.list.create" })}
                        </Button>
                        <button type="button" className="icon-btn" aria-label={coreT({ key: "ui.nav.mcp_servers" })} onClick={() => setHelpOpen(true)}>
                            ?
                        </button>
                    </div>
                }
            >
                {servers == null && error == null ? <p className="settings-hint">{settingsTranslator({ key: "settings.mcp.list.loading.desktop" })}</p> : null}
                {(servers ?? []).map((server) => {
                    const status = statuses.find((entry) => entry.serverId === server.id);
                    // 连接进行中该行只读（移动端同口径）：开关与行菜单都禁点，避免交错发起连接。
                    const connecting = status?.state === "connecting";
                    let statusMeta: ReactNode = null;
                    if (status != null) {
                        if (status.failure != null) {
                            // 状态不可用：状态位置直显 core 事实提示（failure.detail），不自写文案（超长由 meta 的 ellipsis 截断，原文进详情页）
                            statusMeta = <span style={{ color: "var(--warning, #b45309)" }}>{status.failure.detail}</span>;
                        } else {
                            statusMeta = <span className={`settings-tag ${MCP_STATUS_TAG_VARIANT[status.state] ?? "settings-tag--muted"}`}>{mcpStatusLabel(status)}</span>;
                        }
                    }
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
                                <span className="settings-list-item__label">
                                    {server.id}
                                    {server.description.trim().length === 0 ? null : <span className="settings-row__desc">{server.description}</span>}
                                </span>
                                <span className="settings-list-item__meta">
                                    {statusMeta}
                                </span>
                                <span className="settings-list-item__chevron" aria-hidden="true">
                                    ›
                                </span>
                            </button>
                            <span className="settings-list-item__switch">
                                {/* 开关提交完整草稿（bearerToken 不传 = 保留已存值）；构造内联自 meta 的单点 helper */}
                                <Switch
                                    checked={server.enabled}
                                    disabled={busy || connecting}
                                    onChange={(next) => void runWrite(() => ipcMcpSaveServer({ id: server.id, description: server.description, transportType: server.transport.type, url: server.transport.type === "stdio" ? undefined : server.transport.url, timeoutMs: server.timeoutMs, authType: server.auth.type, enabled: next }))}
                                    aria-label={server.id}
                                />
                            </span>
                            <button
                                type="button"
                                className="settings-list-item__menu-btn"
                                aria-label={server.id}
                                disabled={busy || connecting}
                                onClick={(e) => {
                                    if (busy || connecting) return;
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setMenu({ serverId: server.id, x: Math.max(8, rect.left), y: Math.max(8, rect.bottom + 4) });
                                }}
                            >
                                ⋮
                            </button>
                        </div>
                    );
                })}
                {servers != null && servers.length === 0 ? <p className="settings-list__empty">{settingsTranslator({ key: "settings.mcp.list.empty" })}</p> : null}
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
                                { label: settingsTranslator({ key: "settings.mcp.detail.test_connection" }), action: "test", disabled: busy || menuConnecting },
                                { label: settingsTranslator({ key: "settings.mcp.list.menu.delete" }), action: "delete", danger: true, disabled: busy || menuConnecting },
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
                title={settingsTranslator({ key: "settings.mcp.delete_title" })}
                message={settingsTranslator({ key: "settings.mcp.delete_notice", params: { id: deleteTarget?.id ?? "" } })}
                confirmLabel={settingsTranslator({ key: "settings.mcp.list.menu.delete" })}
                danger
                busy={busy}
                onConfirm={() => void removeServer()}
                onCancel={() => setDeleteTarget(null)}
            />
            {helpOpen ? (
                <div className="text-prompt-overlay" onClick={() => setHelpOpen(false)}>
                    <div className="text-prompt-modal text-prompt-modal--wide" role="dialog" aria-modal="true" aria-labelledby="mcp-help-title" onClick={(e) => e.stopPropagation()}>
                        <h3 id="mcp-help-title" className="text-prompt-modal__title">
                            {coreT({ key: "ui.nav.mcp_servers" })}
                        </h3>
                        {helpSections.map((section) => (
                            <p key={section.title} className="settings-hint">
                                <strong>{section.title}：</strong>
                                {section.body}
                            </p>
                        ))}
                        <div className="confirm-modal__actions">
                            <Button variant="primary" onClick={() => setHelpOpen(false)}>
                                {settingsTranslator({ key: "settings.mcp.help.dismiss" })}
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}
        </SettingsPanel>
    );
}
