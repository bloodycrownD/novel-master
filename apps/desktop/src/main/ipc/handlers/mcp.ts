/**
 * MCP 配置 IPC 处理器：绑定 main runtime 的 mcpConfig / mcp.connections / mcpOAuth。
 *
 * 口径（mcp-support Step 13/14）：配置 CRUD 是 core `McpConfigStore` 的薄转发（归一、
 * SKSP 密钥拆分、容错迁移全在 store），写成功后失效对应 server 的连接与快照缓存；
 * create 是新建专用（ID 撞名拒绝），换 ID（previousId ≠ id）先改写 agent 工具引用
 * `mcp__<旧ID>__` 再 rename（SKSP 密钥迁新 ref，失败回滚）；
 * 「测试连接」= invalidate + snapshotTools 重拉后读 serverStatuses（状态与错误原文
 * 的唯一读取面，detail 原文透出）；OAuth 桌面侧只经 `McpOAuth.start` / `handleCallback`
 * 两个入口——本文件负责 loopback 回调 server（127.0.0.1 随机端口，先起 server 拿到
 * redirectUrl 再调 start）与打开系统浏览器（拿到 authorizeUrl 后 shell.openExternal），
 * 不自己拼 token 请求。
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
    McpTestConnectionRequest,
    McpToolSnapshotDto,
} from "../../../../shared/ipc-types.js";
import { MCP_DEFAULT_TIMEOUT_MS, MCP_MIN_TIMEOUT_MS, McpSecretRefs, McpToolRefs, McpToolSlug, McpServerConfigOps, type McpServerConfig, type McpServerStatus } from "@novel-master/core/mcp";
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
            const config: McpServerConfig = {
                id,
                description: req.description.trim(),
                enabled: req.enabled !== false,
                transport: req.transportType === "stdio" ? { type: "stdio" } : req.transportType === "sse" ? { type: "sse", url } : { type: "http", url },
                timeoutMs: req.timeoutMs != null && Number.isFinite(req.timeoutMs) && req.timeoutMs > 0 ? Math.max(MCP_MIN_TIMEOUT_MS, Math.trunc(req.timeoutMs)) : MCP_DEFAULT_TIMEOUT_MS,
                auth: req.authType === "oauth" ? { type: "oauth" } : req.authType === "bearer" ? { type: "bearer", secretRef: McpSecretRefs.bearer(id) } : { type: "none" },
            };
            const previousId = req.previousId?.trim();
            const renaming = req.create !== true && previousId != null && previousId !== "" && previousId !== id;
            // bearer 明文：undefined=保留、空串=清除、非空=覆盖（SKSP 直写，SecretStore 无 Result 通道、失败以 throw 收进 catch）。
            // 换 ID 顺序相反：先 rename（旧 ref 密钥随迁），再对新 ref 执行同一语义——搬家旧值不能盖掉用户刚填的密钥。
            if (req.authType === "bearer" && req.bearerToken != null && !renaming) {
                if (req.bearerToken === "") await rt.secretStore.delete(McpSecretRefs.bearer(id));
                else await rt.secretStore.set(McpSecretRefs.bearer(id), req.bearerToken);
            }
            let oauthMigrated: boolean | undefined;
            if (req.create === true) {
                const created = await rt.mcpConfig.create(config);
                if (!created.ok) return { ok: false, error: FormatIpcError.format(created.error) };
            } else if (previousId != null && previousId !== "" && previousId !== id) {
                // 换 ID：先改写 agent 工具引用（mcp__<旧ID>__ → mcp__<新ID>__），再 rename（SKSP 密钥迁新 ref、配置原位替换、清旧 ref）；
                // 任一失败回滚（反向改写与迁回均幂等），不留配置已换、引用改一半的状态。
                const listed = await rt.mcpConfig.list();
                if (!listed.ok) return { ok: false, error: FormatIpcError.format(listed.error) };
                const previousConfig = listed.value.find((candidate) => candidate.id === previousId);
                try {
                    await McpToolRefs.rewriteAgentTools(rt.agentRegistry, previousId, id);
                    const renamed = await rt.mcpConfig.rename(previousId, config);
                    // nm-throw: keep — 转码边界：rename 的 Result.err 抛进本函数 catch，经 FormatIpcError 收进 IpcResult（回滚已在 catch 内先行）
                    if (!renamed.ok) throw renamed.error;
                    oauthMigrated = renamed.value.oauthMigrated;
                    rt.mcp.connectionManager.invalidate(previousId);
                } catch (cause) {
                    await McpToolRefs.rewriteAgentTools(rt.agentRegistry, id, previousId).catch(() => undefined);
                    if (previousConfig != null) await rt.mcpConfig.rename(id, previousConfig).catch(() => undefined);
                    return { ok: false, error: FormatIpcError.format(cause) };
                }
            } else {
                const saved = await rt.mcpConfig.save(config);
                if (!saved.ok) return { ok: false, error: FormatIpcError.format(saved.error) };
            }
            if (req.authType === "bearer" && req.bearerToken != null && renaming) {
                if (req.bearerToken === "") await rt.secretStore.delete(McpSecretRefs.bearer(id));
                else await rt.secretStore.set(McpSecretRefs.bearer(id), req.bearerToken);
            }
            rt.mcp.connectionManager.invalidate(id);
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

    /** 测试连接：失效缓存重拉快照后读该 server 的状态（失败原因在 `failure.detail` 原文透出）。 */
    export async function testConnection(req: McpTestConnectionRequest): Promise<IpcResult<McpServerStatus>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            const rt = built.value;
            rt.mcp.connectionManager.invalidate(req.serverId);
            await rt.mcp.connectionManager.snapshotTools();
            const status = rt.mcp.connectionManager.serverStatuses().find((entry) => entry.serverId === req.serverId);
            return status != null ? IpcResults.ok(status) : { ok: false, error: FormatIpcError.format(new AppError("INFRA_VALIDATION_FAILED", { detail: `MCP 服务器不在当前配置中: ${req.serverId}` })) };
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    }

    export async function serverStatuses(): Promise<IpcResult<readonly McpServerStatus[]>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            return IpcResults.ok(built.value.mcp.connectionManager.serverStatuses());
        } catch (err) {
            return { ok: false, error: FormatIpcError.format(err) };
        }
    }

    export async function toolsSnapshot(): Promise<IpcResult<readonly McpToolSnapshotDto[]>> {
        try {
            const built = await DesktopRuntimeSingleton.get();
            if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
            const snapshots = await built.value.mcp.connectionManager.snapshotTools();
            return IpcResults.ok(snapshots.map((entry) => ({ ...entry, registeredName: McpToolSlug.toolName(entry.serverId, entry.toolName) })));
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
