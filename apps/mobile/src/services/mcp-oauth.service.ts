/**
 * MCP OAuth deep link 回调（spec mcp-support Step 13 / §八）。
 *
 * 发起：`start` 调 core `McpOAuth.start(serverId, REDIRECT_URL)` 拿授权跳转 URL，
 * 经 `Linking.openURL` 交系统浏览器（Custom Tabs）；成功后登记 pending server——
 * 回调 URL 只带 code / state 不带 serverId，凭登记路由到对应 server（配错时
 * core 的 state CSRF 校验会拒收，多 server 并发授权的后发起者覆盖先发起者）。
 *
 * 回调：`listen` 挂全局 `url` 监听（含冷启动 getInitialURL——授权期间进程可能
 * 被系统回收，浏览器回跳会重新拉起 app），只接受 `nm://oauth/callback` 形态，
 * 解析出的 code / state / error **原样透传**给 core `McpOAuth.handleCallback`，
 * 不自己拼 token 请求；结果经 AppToast 反馈，成功后 invalidate 该 server 的
 * 连接缓存（下次连接带新令牌）。
 *
 * @module services/mcp-oauth.service
 */
import {Linking} from 'react-native';
import {AppError, Result} from '@novel-master/core/errors';
import {McpSecretRefs} from '@novel-master/core/mcp';
import {AppToast} from '@/services/app-toast';
import {settingsTranslator} from '@/i18n/settings';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

/** 移动端固定 redirectUrl（spec §八；AndroidManifest intent-filter 与 core DCR 的 redirect_uris 同值）。 */
export const MCP_OAUTH_REDIRECT_URL = 'nm://oauth/callback';

/** 待回调的 serverId（进程内单例；undefined = 无进行中的授权）。 */
const pendingAuthorization = {serverId: undefined as string | undefined};

/** 处理一条回调 URL：解析 → 透传 handleCallback → toast + 失效连接缓存。 */
const handleCallbackUrl = async (runtime: MobileNovelMasterRuntime, url: string): Promise<void> => {
    // 精确 scheme + host + path（AndroidManifest 注册面同口径），其它 deep link 一律忽略。
    if (url !== MCP_OAUTH_REDIRECT_URL && !url.startsWith(`${MCP_OAUTH_REDIRECT_URL}?`)) {
        return;
    }
    const serverId = pendingAuthorization.serverId;
    pendingAuthorization.serverId = undefined;
    if (serverId == null) {
        AppToast.show(settingsTranslator({key: 'settings.mcp.toast.oauth_no_pending.mobile'}));
        return;
    }
    // 回调查询串最窄解析：手写拆键值（+ 号按空格还原），编码异常的键值跳过——解析永不炸监听。
    const queryStart = url.indexOf('?');
    const table: Record<string, string> = {};
    for (const pair of (queryStart < 0 ? '' : url.slice(queryStart + 1)).split('&')) {
        if (pair === '') {
            continue;
        }
        const eq = pair.indexOf('=');
        const key = (eq < 0 ? pair : pair.slice(0, eq)).replace(/\+/g, ' ');
        const value = (eq < 0 ? '' : pair.slice(eq + 1)).replace(/\+/g, ' ');
        try {
            table[decodeURIComponent(key)] = decodeURIComponent(value);
        } catch {
            // 编码异常的键值跳过（回调形态不受控）
        }
    }
    const result = await runtime.mcp.oauth.handleCallback(serverId, {code: table.code, state: table.state, error: table.error});
    if (!result.ok) {
        AppToast.show(settingsTranslator({key: 'settings.mcp.toast.oauth_callback_failed.mobile', params: {reason: result.error.message}}));
        return;
    }
    // 授权成功后旧连接可能还挂着过期令牌：失效让下次连接用新 token 重连。
    runtime.mcp.connectionManager.invalidate(serverId);
    AppToast.show(settingsTranslator({key: 'settings.mcp.toast.oauth_callback_ok'}));
};

export const McpOauthService = {
    /**
   * 发起授权：core start → 系统浏览器；openURL 失败（无浏览器 / scheme 被拦）
   * 回收 pending 登记并以 Result.err 上行，UI 边界收口 toast。
   */
    start: async (runtime: MobileNovelMasterRuntime, serverId: string): Promise<Result<void, AppError>> => {
        const started = await runtime.mcp.oauth.start(serverId, MCP_OAUTH_REDIRECT_URL);
        if (!started.ok) {
            return Result.err(started.error);
        }
        pendingAuthorization.serverId = serverId;
        try {
            await Linking.openURL(started.value.authorizeUrl);
        } catch (cause) {
            pendingAuthorization.serverId = undefined;
            return Result.err(new AppError('INFRA_UNEXPECTED_ERROR', {detail: `无法打开系统浏览器: ${cause instanceof Error ? cause.message : String(cause)}`}));
        }
        return Result.ok(undefined);
    },

    /**
   * 挂全局 deep link 监听（runtime 就绪后调用一次；返回解绑函数）。冷启动
   * getInitialURL 兜进程被回收后的回跳；运行中回调走 addEventListener。
   */
    listen: (runtime: MobileNovelMasterRuntime): (() => void) => {
        void Linking.getInitialURL()
            .then(url => {
                if (url != null) {
                    return handleCallbackUrl(runtime, url);
                }
                return undefined;
            })
            .catch(() => undefined);
        const subscription = Linking.addEventListener('url', event => {
            void handleCallbackUrl(runtime, event.url);
        });
        return () => subscription.remove();
    },

    // nm-style: keep-public — 详情页授权状态标签的唯一读数（service 接口方法，单调用点是消费不是内联候选）。
    /**
   * OAuth 授权状态：SKSP `mcp/{id}/oauth` 单键 JSON 里存在 `tokens` 键即视为
   * 已授权（core McpOAuthProvider 的持久化契约字段，跨实例读回行为 T-M22 锁定）。
   */
    authorized: async (runtime: MobileNovelMasterRuntime, serverId: string): Promise<boolean> => {
        const raw = await runtime.secretStore.get(McpSecretRefs.oauth(serverId));
        if (raw == null) {
            return false;
        }
        try {
            const parsed: unknown = JSON.parse(raw);
            if (parsed == null || typeof parsed !== 'object') {
                return false;
            }
            const record = parsed as Record<string, unknown>;
            return record.tokens != null;
        } catch {
            return false;
        }
    },
};
