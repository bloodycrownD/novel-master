/**
 * MCP 配置 IPC 处理器：绑定 main runtime 的 mcpConfig / mcp.connections / mcpOAuth。
 *
 * 口径（mcp-connect-model）：配置 CRUD 是 core `McpConfigStore` 的薄转发（归一、
 * SKSP 密钥拆分、容错迁移全在 store），写成功后 invalidate 对应 server 的缓存与在途
 * 尝试（停用、换 ID 靠它清缓存）；create 是新建专用（ID 撞名拒绝），bearer 明文在
 * create 成功后才写（撞名不碰已有 server 的密钥）；换 ID（previousId ≠ id）走 core
 * 的 `McpServerRename.withAfterStep` 统一编排（rename → 写用户新填 bearer，任一步
 * 失败反向回滚）；
 * 「测试连接」与启用保存的自动连接 = `connect(id)`（作废缓存后连接并等结果，状态与
 * 错误原文的唯一读取面，detail 原文透出）；进页面的一轮自动连接 = `connectUnconnected`；
 * `toolList` 只读连接管理器的工具缓存，不触发任何请求；OAuth 桌面侧只经 `McpOAuth.start` /
 * `handleCallback` 两个入口——本文件负责 loopback 回调 server（127.0.0.1 随机端口，先起
 * server 拿到 redirectUrl 再调 start）与打开系统浏览器（拿到 authorizeUrl 后
 * shell.openExternal），授权成功即返回成功，随后的 invalidate + connect 后台进行、
 * 失败经状态查询的 `failure.detail` 呈现，不自己拼 token 请求。
 *
 * store 方法 throw 的失败（SKSP / KKV infra）在编排边界经 FormatIpcError 收进
 * IpcResult；store 方法自身的已知失败沿 Result 上行、就地短路（与 search handler 同构）。
 */
import * as nodeHttp from "node:http";
import type { AddressInfo } from "node:net";
import { shell } from "electron";
import type {
    IpcResult,
    McpDeleteServerRequest,
    McpOAuthStartRequest,
    McpOAuthStatusesDto,
    McpSaveServerRequest,
    McpSetToolDisabledRequest,
    McpTestConnectionRequest,
    McpToolListRequest,
    McpToolRowDto,
} from "../../../../shared/ipc-types.js";
import { MCP_DEFAULT_TIMEOUT_MS, MCP_MIN_TIMEOUT_MS, McpSecretRefs, McpServerRename, McpServerConfigOps, type McpAuthConfig, type McpServerConfig, type McpServerStatus, type McpTransportConfig } from "@novel-master/core/mcp";
import { AppError } from "@novel-master/core/errors";
import { DesktopRuntimeSingleton } from "../../runtime/desktop-runtime-singleton.js";
import { FormatIpcError } from "../ipc-error.js";
import { IpcResults } from "../ipc-result.js";

/** OAuth 授权全程的等待上限：浏览器侧超过它视为放弃（loopback server 收口、invoke 以失败返回）。 */
const OAUTH_WAIT_TIMEOUT_MS = 5 * 60_000;

/** loopback 回调参数（URL query 的 code / state / error 原样透传给 core handleCallback）。 */
type McpLoopbackCallback = { readonly code?: string; readonly state?: string; readonly error?: string };

/** loopback 回调 server 句柄：redirectUrl 已定、waitCallback 以首个 /callback 请求收口。 */
interface McpLoopbackHandle {
    readonly redirectUrl: string;
    waitCallback(): Promise<McpLoopbackCallback>;
    close(): Promise<void>;
}

export namespace Mcp {
    /** OAuth loopback 回调 server（spec §八）：127.0.0.1 随机端口，端口选定后拼 redirectUrl；其余路径 404。 */
    // nm-style: keep-local — 持有 node:http server 实例与一次性回调 resolve 的闭包状态，是 OAuth 授权腿的 IO 管线。
    const openLoopback = async (): Promise<McpLoopbackHandle> => {
        const server = nodeHttp.createServer();
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        const port = (server.address() as AddressInfo).port;
        let deliver: ((callback: McpLoopbackCallback) => void) | null = null;
        const callbackPromise = new Promise<McpLoopbackCallback>((resolve) => {
            deliver = resolve;
        });
        server.on("request", (req, res) => {
            const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
            if (url.pathname !== "/callback") {
                res.writeHead(404);
                res.end();
                return;
            }
            // 回调页固定文案：授权流程在 main 侧继续，浏览器只是中转（错误结果也在 app 内展示）。
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>nm 授权回调</title></head><body style="font-family:sans-serif;text-align:center;padding-top:80px"><h2>授权回调已完成</h2><p>请返回 Novel Master 查看结果，本页面可以关闭。</p></body></html>');
            deliver?.({ code: url.searchParams.get("code") ?? undefined, state: url.searchParams.get("state") ?? undefined, error: url.searchParams.get("error") ?? undefined });
        });
        return {
            redirectUrl: `http://127.0.0.1:${port}/callback`,
            // nm-style: keep-public — McpLoopbackHandle 契约方法（oauthStart 经接口形态消费），对象字面量实现按名计数看不见调用点。
            waitCallback: () => callbackPromise,
            close: () =>
                new Promise<void>((resolve) => {
                    // keep-alive 连接会阻止 close 回调，顺手收割（Node 18.2+）
                    server.closeAllConnections();
                    server.close(() => resolve());
                }),
        };
    };

    export async function listServers(): Promise<IpcResult<readonly McpServerConfig[]>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            return IpcResults.from(await built.value.mcpConfig.list());
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    }

    export async function saveServer(req: McpSaveServerRequest): Promise<IpcResult<{ readonly serverId: string; readonly oauthMigrated?: boolean }>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            const rt = built.value;
            const id = req.id.trim();
            if (!McpServerConfigOps.isValidId(id)) return { ok: false, error: FormatIpcError.format(new AppError("INFRA_VALIDATION_FAILED", { detail: "ID 只能使用英文字母、数字和下划线" })) };
            const url = req.url?.trim() ?? "";
            if (req.transportType !== "stdio" && !/^https?:\/\//i.test(url)) return { ok: false, error: FormatIpcError.format(new AppError("INFRA_VALIDATION_FAILED", { detail: "URL 必须以 http:// 或 https:// 开头" })) };
            let transport: McpTransportConfig;
            if (req.transportType === "stdio") {
                transport = { type: "stdio" };
            } else if (req.transportType === "sse") {
                transport = { type: "sse", url };
            } else {
                transport = { type: "http", url };
            }
            let auth: McpAuthConfig;
            if (req.authType === "oauth") {
                auth = { type: "oauth" };
            } else if (req.authType === "bearer") {
                auth = { type: "bearer", secretRef: McpSecretRefs.bearer(id) };
            } else {
                auth = { type: "none" };
            }
            const config: McpServerConfig = {
                id,
                description: req.description.trim(),
                enabled: req.enabled !== false,
                transport,
                timeoutMs: req.timeoutMs != null && Number.isFinite(req.timeoutMs) && req.timeoutMs > 0 ? Math.max(MCP_MIN_TIMEOUT_MS, Math.trunc(req.timeoutMs)) : MCP_DEFAULT_TIMEOUT_MS,
                auth,
            };
            const previousId = req.previousId?.trim();
            // bearer 明文：undefined=保留、空串=清除、非空=覆盖（SKSP 直写，SecretStore 无 Result 通道、失败以 throw 收进 catch）。
            // 写入时机：新建在 create 成功之后（撞名被拒时不覆盖已有同名 server 的密钥）；
            // 换 ID 在 withAfterStep 的 afterRename 里（落在回滚链内，密钥写入失败整体回滚）；
            // 原地编辑保持先写后 save。
            const writeBearer = async (): Promise<void> => {
                if (req.authType !== "bearer" || req.bearerToken == null) return;
                if (req.bearerToken === "") await rt.secretStore.delete(McpSecretRefs.bearer(id));
                else await rt.secretStore.set(McpSecretRefs.bearer(id), req.bearerToken);
            };
            let oauthMigrated: boolean | undefined;
            if (req.create === true) {
                const created = await rt.mcpConfig.create(config);
                if (!created.ok) return { ok: false, error: FormatIpcError.format(created.error) };
                await writeBearer();
            } else if (previousId != null && previousId !== "" && previousId !== id) {
                // 换 ID：core 统一编排（rename（SKSP 密钥迁新 ref、配置原位替换、清旧 ref）
                // → afterRename 写用户新填的 bearer），任一步失败按旧配置改回旧 ID，
                // 不留「密钥改了一半」的状态。
                const renamed = await McpServerRename.withAfterStep({ configStore: rt.mcpConfig }, previousId, config, writeBearer);
                if (!renamed.ok) return { ok: false, error: FormatIpcError.format(renamed.error) };
                oauthMigrated = renamed.value.oauthMigrated;
                rt.mcp.connectionManager.invalidate(previousId);
            } else {
                await writeBearer();
                const saved = await rt.mcpConfig.save(config);
                if (!saved.ok) return { ok: false, error: FormatIpcError.format(saved.error) };
            }
            rt.mcp.connectionManager.invalidate(id);
            // 启用保存后自动连接（列表开关与详情保存同一条路，显式动作先作废再连并等结果）：
            // 失败原因经 serverStatuses 的 failure.detail 带出，不影响保存结果；停用只作废不连接。
            if (config.enabled) await rt.mcp.connectionManager.connect(id).catch(() => undefined);
            return IpcResults.ok({ serverId: id, ...(oauthMigrated === undefined ? {} : { oauthMigrated }) });
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    }

    export async function deleteServer(req: McpDeleteServerRequest): Promise<IpcResult<void>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            const rt = built.value;
            const removed = await rt.mcpConfig.remove(req.serverId);
            if (removed.ok) rt.mcp.connectionManager.invalidate(req.serverId);
            return IpcResults.from(removed);
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    }

    /** 测试连接：作废缓存后连接并等结果（失败原因在 `failure.detail` 原文透出）。 */
    export async function testConnection(req: McpTestConnectionRequest): Promise<IpcResult<McpServerStatus>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            return IpcResults.ok(await built.value.mcp.connectionManager.connect(req.serverId));
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    }

    /** 进页面触发：对从未尝试 / 已断开的服务器后台发起一轮连接；等本轮尝试结束后返回（管理器永不 reject）。 */
    export async function connectUnconnected(): Promise<IpcResult<void>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            await built.value.mcp.connectionManager.connectUnconnected();
            return IpcResults.ok(undefined);
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    }

    export async function listServerStatuses(): Promise<IpcResult<readonly McpServerStatus[]>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            return IpcResults.ok(built.value.mcp.connectionManager.serverStatuses());
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    }

    /**
     * 详情页「工具」卡的行清单：工具缓存按 server 过滤 + 禁用位，只读缓存不触发请求。
     * 读 includeDisabled（连被关的工具一起返回）——装配面的出口滤掉了被关的工具，拿它当行清单，关掉的工具会从卡上消失、没法再打开。
     * 禁用位只读 `mcpConfig.listDisabledTools()`，与行清单的来源分开。
     */
    export async function toolList(req: McpToolListRequest): Promise<IpcResult<readonly McpToolRowDto[]>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            const rt = built.value;
            const cached = rt.mcp.connectionManager.cachedTools({includeDisabled: true});
            const disabled = await rt.mcpConfig.listDisabledTools();
            if (!disabled.ok) return { ok: false, error: FormatIpcError.format(disabled.error) };
            const disabledNames = disabled.value[req.serverId] ?? [];
            return IpcResults.ok(cached.filter((entry) => entry.serverId === req.serverId).map((entry) => ({ toolName: entry.toolName, toolDescription: entry.toolDescription, disabled: disabledNames.includes(entry.toolName) })));
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    }

    /** 每工具启停：KKV 直写；过滤发生在 cachedTools 出口，被关的工具下一次装配自然不注册进 agent，无需重连。 */
    export async function setToolDisabled(req: McpSetToolDisabledRequest): Promise<IpcResult<void>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            return IpcResults.from(await built.value.mcpConfig.setToolDisabled(req.serverId, req.toolName, req.disabled));
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    }

    /**
     * 发起 OAuth 授权：先起 loopback server 拿 redirectUrl，再调 `McpOAuth.start`
     * （start 不负责选端口，spec §八端口时序）；拿到 authorizeUrl 后 main 侧
     * shell.openExternal 打开系统浏览器。invoke 挂起至回调完成——返回值即授权
     * 成败（浏览器打不开 / 等待 / 交换任一环失败都以 err 收口）。
     */
    export async function oauthStart(req: McpOAuthStartRequest): Promise<IpcResult<{ readonly authorizeUrl: string }>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            const rt = built.value;
            const loopback = await openLoopback();
            // 等待上限：到点以失败收口（loopback server 在 finally 里关闭，invoke 不无限挂起）。
            let waitTimer: NodeJS.Timeout | undefined;
            const timeoutPromise = new Promise<never>((_, reject) => {
                waitTimer = setTimeout(() => reject(new AppError("INFRA_VALIDATION_FAILED", { detail: `授权等待超时（${Math.round(OAUTH_WAIT_TIMEOUT_MS / 60_000)} 分钟），请重新发起授权` })), OAUTH_WAIT_TIMEOUT_MS);
                waitTimer?.unref();
            });
            try {
                const started = await rt.mcpOAuth.start(req.serverId, loopback.redirectUrl);
                if (!started.ok) return { ok: false, error: FormatIpcError.format(started.error) };
                // 浏览器由 main 侧打开（spec §八桌面口径）；openExternal 的 reject 走 catch
                // 立即收口，不让用户对着 5 分钟超时干等。
                await shell.openExternal(started.value.authorizeUrl);
                const callback = await Promise.race([loopback.waitCallback(), timeoutPromise]);
                const handled = await rt.mcpOAuth.handleCallback(req.serverId, callback);
                if (!handled.ok) return { ok: false, error: FormatIpcError.format(handled.error) };
                // 授权成功即视为动作完成（显式动作口径）：作废旧缓存并后台重连，不等结果、
                // 连接失败不改变本返回值——失败经状态查询的 failure.detail 呈现。
                rt.mcp.connectionManager.invalidate(req.serverId);
                void rt.mcp.connectionManager.connect(req.serverId).catch(() => undefined);
                return IpcResults.ok({ authorizeUrl: started.value.authorizeUrl });
            } finally {
                clearTimeout(waitTimer);
                await loopback.close();
            }
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    }

    export async function oauthStatuses(): Promise<IpcResult<McpOAuthStatusesDto>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            const rt = built.value;
            const configs = await rt.mcpConfig.list();
            if (!configs.ok) return { ok: false, error: FormatIpcError.format(configs.error) };
            // SKSP oauth 键的容错解析（缺失 / 损坏 JSON 按未授权）就地展开在 map 回调里。
            const entries = await Promise.all(configs.value.filter((config) => config.auth.type === "oauth").map(async (config) => {
                const raw = await rt.secretStore.get(McpSecretRefs.oauth(config.id));
                let authorized = false;
                if (raw != null) {
                    try {
                        authorized = (JSON.parse(raw) as { tokens?: unknown }).tokens != null;
                    } catch {
                        authorized = false;
                    }
                }
                return [config.id, authorized] as const;
            }));
            return IpcResults.ok(Object.fromEntries(entries));
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    }
}
