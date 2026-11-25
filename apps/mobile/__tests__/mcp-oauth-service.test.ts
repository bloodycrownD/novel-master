/**
 * McpOauthService 单测（spec mcp-support Step 13 / §八，CR-10）：
 *
 * - 回调 URL 窄解析：`+` 号按空格还原、百分号解码、编码异常的键值跳过且不炸监听
 * - pending 登记路由：start 登记 → 后发起者覆盖先发起者；无 pending 时回调被拒收
 * - code / state / error 原样透传 core handleCallback（service 不自己拼 token 请求）
 * - 冷启动 getInitialURL 分支（进程被回收后的回跳）与运行中 addEventListener 分支
 * - start 的失败路径：oauth.start 被拒 / openURL 失败都回收 pending 登记并转 Result.err
 *
 * react-native 整模块 mock 只留 Linking（service 链路里唯一 RN 依赖）；AppToast
 * 与 settingsTranslator 打桩后按调用断言，不依赖真实文案目录。
 */
import {AppError, Result} from '@novel-master/core/errors';
import {Linking} from 'react-native';
import {AppToast} from '@/services/app-toast';
import {MCP_OAUTH_REDIRECT_URL, McpOauthService} from '@/services/mcp-oauth.service';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

jest.mock('react-native', () => ({
    Linking: {openURL: jest.fn(), getInitialURL: jest.fn(), addEventListener: jest.fn()},
}));

jest.mock('@/i18n/settings', () => ({
    // 目录模板在 mock 里不可得：回显 key + params 键值对，断言按「key 与参数都在回显里」进行。
    settingsTranslator: jest.fn((input: {key: string; params?: Record<string, unknown>}) => {
        const rendered = Object.entries(input.params ?? {}).map(([name, value]) => `${name}=${String(value)}`).join(',');
        return rendered.length === 0 ? input.key : `${input.key}(${rendered})`;
    }),
}));

const openURLMock = Linking.openURL as unknown as jest.Mock;
const getInitialURLMock = Linking.getInitialURL as unknown as jest.Mock;
const addEventListenerMock = Linking.addEventListener as unknown as jest.Mock;

interface OauthHarness {
    runtime: MobileNovelMasterRuntime;
    oauthStart: jest.Mock;
    handleCallback: jest.Mock;
    invalidate: jest.Mock;
    toasts: string[];
}

function makeHarness(): OauthHarness {
    const oauthStart = jest.fn(async () => Result.ok({authorizeUrl: 'https://auth.example.com/authorize'}));
    const handleCallback = jest.fn(async () => Result.ok(undefined));
    const invalidate = jest.fn();
    const toasts: string[] = [];
    jest.spyOn(AppToast, 'show').mockImplementation(message => {
        toasts.push(message);
    });
    const runtime = {mcp: {oauth: {start: oauthStart, handleCallback}, connectionManager: {invalidate}}} as unknown as MobileNovelMasterRuntime;
    return {runtime, oauthStart, handleCallback, invalidate, toasts};
}

/** 挂上 deep link 监听（分发回调用；getInitialURL 由 beforeEach 钉在 null）。 */
function listen(h: OauthHarness): void {
    McpOauthService.listen(h.runtime);
}

/** 取最近一次注册的 url 监听回调（测试分派 deep link 用）。 */
function lastUrlHandler(): (event: {url: string}) => void {
    const calls = addEventListenerMock.mock.calls as Array<[string, (event: {url: string}) => void]>;
    const call = calls[calls.length - 1];
    if (call == null) {
        throw new Error('未注册 url 监听');
    }
    return call[1];
}

/** 排空 listen 的浮空 getInitialURL promise（冷启动分支异步落地）。 */
async function flushInitialUrl(): Promise<void> {
    await new Promise<void>(resolve => {
        setImmediate(resolve);
    });
}

describe('mcp-oauth-service（CR-10）', () => {
    let toastSpy: jest.SpyInstance;

    beforeEach(() => {
        openURLMock.mockReset();
        getInitialURLMock.mockReset();
        addEventListenerMock.mockReset();
        openURLMock.mockResolvedValue(true);
        getInitialURLMock.mockResolvedValue(null);
        addEventListenerMock.mockImplementation(() => ({remove: jest.fn()}));
        toastSpy = jest.spyOn(AppToast, 'show').mockImplementation(() => undefined);
    });

    afterEach(() => {
        toastSpy.mockRestore();
    });

    it('回调窄解析：+ 号还原空格、百分号解码、编码异常的键值跳过；code / state 原样透传并失效连接缓存', async () => {
        const h = makeHarness();
        listen(h);
        const started = await McpOauthService.start(h.runtime, 'a');
        expect(started.ok).toBe(true);
        expect(openURLMock).toHaveBeenCalledWith('https://auth.example.com/authorize');

        await lastUrlHandler()({url: `${MCP_OAUTH_REDIRECT_URL}?code=abc+def&state=st%2Fate&bad=%zz`});

        expect(h.handleCallback).toHaveBeenCalledTimes(1);
        expect(h.handleCallback).toHaveBeenCalledWith('a', {code: 'abc def', state: 'st/ate', error: undefined});
        expect(h.invalidate).toHaveBeenCalledWith('a');
        expect(h.toasts).toContain('settings.mcp.toast.oauth_callback_ok');
    });

    it('pending 登记路由：后发起者覆盖先发起者；error 参数原样透传', async () => {
        const h = makeHarness();
        listen(h);
        h.oauthStart.mockImplementation(async (serverId: string) => Result.ok({authorizeUrl: `https://auth.example.com/authorize?client=${serverId}`}));
        await McpOauthService.start(h.runtime, 'a');
        await McpOauthService.start(h.runtime, 'b');

        await lastUrlHandler()({url: `${MCP_OAUTH_REDIRECT_URL}?error=access_denied&state=x`});

        expect(h.handleCallback).toHaveBeenCalledTimes(1);
        expect(h.handleCallback).toHaveBeenCalledWith('b', {code: undefined, state: 'x', error: 'access_denied'});
        expect(h.invalidate).toHaveBeenCalledWith('b');
    });

    it('无 pending 登记时回调被拒收：不透传 handleCallback、提示待授权', async () => {
        const h = makeHarness();
        listen(h);

        await lastUrlHandler()({url: `${MCP_OAUTH_REDIRECT_URL}?code=orphan`});

        expect(h.handleCallback).not.toHaveBeenCalled();
        expect(h.toasts).toContain('settings.mcp.toast.oauth_no_pending.mobile');
    });

    it('非回调 deep link 一律忽略', async () => {
        const h = makeHarness();
        listen(h);
        await McpOauthService.start(h.runtime, 'a');

        await lastUrlHandler()({url: 'nm://other/path?code=x'});

        expect(h.handleCallback).not.toHaveBeenCalled();
        // pending 保留：真正的回调仍能路由到 a
        await lastUrlHandler()({url: `${MCP_OAUTH_REDIRECT_URL}?code=late`});
        expect(h.handleCallback).toHaveBeenCalledWith('a', {code: 'late', state: undefined, error: undefined});
    });

    it('冷启动 getInitialURL 分支：进程被回收后凭 pending 路由', async () => {
        const h = makeHarness();
        await McpOauthService.start(h.runtime, 'a');
        getInitialURLMock.mockResolvedValue(`${MCP_OAUTH_REDIRECT_URL}?code=cold&state=s`);

        McpOauthService.listen(h.runtime);
        await flushInitialUrl();

        expect(h.handleCallback).toHaveBeenCalledWith('a', {code: 'cold', state: 's', error: undefined});
        expect(h.invalidate).toHaveBeenCalledWith('a');
    });

    it('冷启动 getInitialURL 为 null 或失败：不透传、监听照常挂上且不冒异常', async () => {
        const h = makeHarness();
        getInitialURLMock.mockResolvedValue(null);
        const unbind = McpOauthService.listen(h.runtime);
        await flushInitialUrl();
        expect(h.handleCallback).not.toHaveBeenCalled();
        unbind();

        const h2 = makeHarness();
        getInitialURLMock.mockRejectedValue(new Error('bridge 不可用'));
        const unbind2 = McpOauthService.listen(h2.runtime);
        await flushInitialUrl();
        expect(h2.handleCallback).not.toHaveBeenCalled();
        unbind2();
    });

    it('listen 返回解绑函数：移除 url 订阅', () => {
        const remove = jest.fn();
        addEventListenerMock.mockImplementation(() => ({remove}));

        const unbind = McpOauthService.listen(makeHarness().runtime);
        unbind();

        expect(remove).toHaveBeenCalledTimes(1);
    });

    it('oauth.start 被拒：Result.err 上行、不打开浏览器、pending 不登记', async () => {
        const h = makeHarness();
        listen(h);
        h.oauthStart.mockResolvedValue(Result.err(new AppError('INFRA_UNEXPECTED_ERROR', {detail: 'DCR 被拒'})));

        const started = await McpOauthService.start(h.runtime, 'a');

        expect(started.ok).toBe(false);
        if (started.ok) throw new Error('start 应失败');
        expect(started.error.message).toContain('DCR 被拒');
        expect(openURLMock).not.toHaveBeenCalled();
        await lastUrlHandler()({url: `${MCP_OAUTH_REDIRECT_URL}?code=x`});
        expect(h.handleCallback).not.toHaveBeenCalled();
    });

    it('openURL 失败：回收 pending 登记并以 Result.err 上行', async () => {
        const h = makeHarness();
        listen(h);
        openURLMock.mockRejectedValue(new Error('无浏览器'));

        const started = await McpOauthService.start(h.runtime, 'a');

        expect(started.ok).toBe(false);
        if (started.ok) throw new Error('start 应失败');
        expect(started.error.message).toContain('无法打开系统浏览器');
        await lastUrlHandler()({url: `${MCP_OAUTH_REDIRECT_URL}?code=x`});
        expect(h.handleCallback).not.toHaveBeenCalled();
        expect(h.toasts).toContain('settings.mcp.toast.oauth_no_pending.mobile');
    });

    it('handleCallback 失败：提示失败原因且不失效连接缓存', async () => {
        const h = makeHarness();
        listen(h);
        h.handleCallback.mockResolvedValue(Result.err(new AppError('INFRA_UNEXPECTED_ERROR', {detail: 'state 不匹配'})));
        await McpOauthService.start(h.runtime, 'a');

        await lastUrlHandler()({url: `${MCP_OAUTH_REDIRECT_URL}?code=x&state=bad`});

        expect(h.invalidate).not.toHaveBeenCalled();
        const failureToast = h.toasts.find(message => message.includes('settings.mcp.toast.oauth_callback_failed.mobile'));
        expect(failureToast).toBeDefined();
        expect(failureToast).toContain('state 不匹配');
    });
});
