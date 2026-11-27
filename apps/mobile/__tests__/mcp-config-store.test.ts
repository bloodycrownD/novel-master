/**
 * McpRuntimeStore 薄镜像（spec mcp-support Step 13/14 / MCP 连接模型第四阶段）：
 *
 * - 写路径全部委托 core（McpConfigStoreFactory 的 store + McpServerRename.withAfterStep），
 *   连接管理器工厂被 mock 以便观测 connect 直连与 invalidate 的调用；KKV / SKSP
 *   用内存实现跑真链路
 * - rename 成功（密钥迁移 + afterRename 落点）与失败回滚（不留半截状态）
 * - create 撞名被拒转 throw 且不写任何密钥（CR-02 的 store 级断言）
 * - connect 直连 connectionManager.connect（作废由 core 负责）；停用与删除只
 *   invalidate 不连接（T-MO2）；connectUnconnected 透传
 * - setToolDisabled 落库并刷新镜像；remove 连带清镜像、禁用表与 SKSP refs
 */
import {AppError, Result} from '@novel-master/core/errors';
import type {KkvService} from '@novel-master/core/kkv';
import {McpConfigStoreFactory, McpConnectionManagerFactory, McpSecretRefs, type McpConnectionManagerDeps, type McpRequestFn, type McpServerConfig} from '@novel-master/core/mcp';
import type {SecretStore} from '@novel-master/core/sksp';
import {McpRuntimeFactory, type McpRuntimeSlice} from '@/services/mcp-config.store';

jest.mock('@novel-master/core/mcp', () => {
    const actual = jest.requireActual<typeof import('@novel-master/core/mcp')>('@novel-master/core/mcp');
    return {
        ...actual,
        // 只 mock 连接管理器工厂（不发真请求、可观测调用）；store / withAfterStep / OAuth 走真实 core 实现。
        McpConnectionManagerFactory: {
            ...actual.McpConnectionManagerFactory,
            create: jest.fn(),
        },
    };
});

/** 内存版 KKV（KkvService 全实现 + 测试注入 / 原读）。 */
class InMemoryKkv implements KkvService {
    private map = new Map<string, string>();

    private slot(module: string, key: string): string {
        return `${module}\u0000${key}`;
    }

    async listKeys(module: string): Promise<string[]> {
        return [...this.map.keys()].filter(slot => slot.startsWith(`${module}\u0000`)).map(slot => slot.slice(module.length + 1));
    }

    async get(module: string, key: string) {
        const value = this.map.get(this.slot(module, key));
        return value === undefined ? Result.err(new AppError('KKV_NOT_FOUND', {detail: `KKV key not found: ${module}/${key}`})) : Result.ok(value);
    }

    async set(module: string, key: string, value: string): Promise<void> {
        this.map.set(this.slot(module, key), value);
    }

    async delete(module: string, key: string) {
        return this.map.delete(this.slot(module, key)) ? Result.ok(undefined) : Result.err(new AppError('KKV_NOT_FOUND', {detail: `KKV key not found: ${module}/${key}`}));
    }

    inject(module: string, key: string, value: string): void {
        this.map.set(this.slot(module, key), value);
    }

    raw(module: string, key: string): string | undefined {
        return this.map.get(this.slot(module, key));
    }
}

/** 内存版 SKSP：方法面用 jest.fn 包裹以便断言「未写密钥 / 清了哪些 ref」。 */
function createSecretStore(initial: Record<string, string> = {}) {
    const map = new Map<string, string>(Object.entries(initial));
    return {
        has: jest.fn(async (ref: string) => map.has(ref)),
        get: jest.fn(async (ref: string) => map.get(ref) ?? null),
        set: jest.fn(async (ref: string, value: string) => {
            map.set(ref, value);
        }),
        delete: jest.fn(async (ref: string) => {
            map.delete(ref);
        }),
    };
}

/** mock 版连接管理器（McpConnectionManager 全方法 jest.fn，不发真请求）。 */
function createFakeManager() {
    return {
        cachedTools: jest.fn(() => []),
        connectUnconnected: jest.fn(async () => undefined),
        connect: jest.fn(async (serverId: string) => ({serverId, state: 'ready' as const})),
        serverStatuses: jest.fn(() => []),
        callTool: jest.fn(async () => Result.err({kind: 'server', action: 'report', detail: 'fake manager 不发请求'})),
        invalidate: jest.fn(),
        closeAll: jest.fn(async () => undefined),
    };
}

/** 连接管理器被 mock 后不会真发请求；工厂依赖仍要一个合法的 McpRequestFn 兜底。 */
const fakeRequestFn: McpRequestFn = async () => ({status: 500, headers: {}, bodyText: ''});

function serverConfig(id: string): McpServerConfig {
    return {id, description: '', enabled: true, transport: {type: 'http', url: `https://${id}.example.com/mcp`}, timeoutMs: 120000, auth: {type: 'bearer', secretRef: McpSecretRefs.bearer(id)}};
}

function serversJson(kkv: InMemoryKkv): unknown {
    const raw = kkv.raw(McpConfigStoreFactory.KKV_MODULE, McpConfigStoreFactory.KEY_SERVERS);
    return raw == null ? null : JSON.parse(raw);
}

function disabledJson(kkv: InMemoryKkv): unknown {
    const raw = kkv.raw(McpConfigStoreFactory.KKV_MODULE, McpConfigStoreFactory.KEY_DISABLED_TOOLS);
    return raw == null ? null : JSON.parse(raw);
}

interface SliceHarness {
    mcp: McpRuntimeSlice;
    kkv: InMemoryKkv;
    secretStore: ReturnType<typeof createSecretStore>;
    fakeManager: ReturnType<typeof createFakeManager>;
    managerDeps: McpConnectionManagerDeps;
}

async function makeHarness(seed: {servers?: McpServerConfig[]; disabledTools?: Record<string, readonly string[]>; secrets?: Record<string, string>} = {}): Promise<SliceHarness> {
    const kkv = new InMemoryKkv();
    if (seed.servers != null) kkv.inject(McpConfigStoreFactory.KKV_MODULE, McpConfigStoreFactory.KEY_SERVERS, JSON.stringify(seed.servers));
    if (seed.disabledTools != null) kkv.inject(McpConfigStoreFactory.KKV_MODULE, McpConfigStoreFactory.KEY_DISABLED_TOOLS, JSON.stringify(seed.disabledTools));
    const secretStore = createSecretStore(seed.secrets ?? {});
    const fakeManager = createFakeManager();
    const managerCreate = McpConnectionManagerFactory.create as unknown as jest.Mock;
    managerCreate.mockReset();
    managerCreate.mockImplementation(() => fakeManager);
    const mcp = await McpRuntimeFactory.create({kkv, secretStore: secretStore as unknown as SecretStore, requestFnFor: () => fakeRequestFn});
    const managerDeps = managerCreate.mock.calls[0][0] as McpConnectionManagerDeps;
    return {mcp, kkv, secretStore, fakeManager, managerDeps};
}

describe('mcp-config.store 薄镜像（CR-09 / CR-02 / 连接模型第四阶段）', () => {
    it('rename 成功：KKV 原位替换、SKSP 密钥迁新 ref 清旧 ref、afterRename 落在新 ref、镜像刷新并 invalidate 新旧 ID', async () => {
        const oldConfig = serverConfig('a');
        const h = await makeHarness({servers: [oldConfig], secrets: {[McpSecretRefs.bearer('a')]: 'key-a'}});
        const newConfig = {...oldConfig, id: 'b'};

        let afterRenameTarget = '';
        await h.mcp.rename('a', newConfig, async () => {
            afterRenameTarget = McpSecretRefs.bearer(newConfig.id);
            await h.secretStore.set(afterRenameTarget, 'key-new');
        });

        expect(h.mcp.servers().map(config => config.id)).toEqual(['b']);
        expect(serversJson(h.kkv)).toEqual([JSON.parse(JSON.stringify(newConfig))]);
        expect(afterRenameTarget).toBe(McpSecretRefs.bearer('b'));
        expect(await h.secretStore.get(McpSecretRefs.bearer('b'))).toBe('key-new');
        expect(await h.secretStore.get(McpSecretRefs.bearer('a'))).toBeNull();
        expect(h.fakeManager.invalidate).toHaveBeenCalledWith('a');
        expect(h.fakeManager.invalidate).toHaveBeenCalledWith('b');
    });

    it('rename 失败（afterRename 抛错）：转 throw 且回滚不留半截状态——配置回旧 ID、旧密钥仍在旧 ref', async () => {
        const oldConfig = serverConfig('a');
        const h = await makeHarness({servers: [oldConfig], secrets: {[McpSecretRefs.bearer('a')]: 'key-a'}});

        await expect(
            h.mcp.rename('a', {...oldConfig, id: 'b'}, async () => {
                throw new Error('写 bearer 失败');
            }),
        ).rejects.toThrow('写 bearer 失败');

        expect(h.mcp.servers().map(config => config.id)).toEqual(['a']);
        expect(await h.secretStore.get(McpSecretRefs.bearer('a'))).toBe('key-a');
        expect(await h.secretStore.get(McpSecretRefs.bearer('b'))).toBeNull();
    });

    it('create 撞名被拒：转 throw、不写任何密钥、KKV 不变（CR-02 的 store 级断言）', async () => {
        const existing = serverConfig('a');
        const h = await makeHarness({servers: [existing], secrets: {[McpSecretRefs.bearer('a')]: 'existing-key'}});

        await expect(h.mcp.create({...existing, auth: {type: 'bearer', secretRef: McpSecretRefs.bearer('a')}})).rejects.toThrow('MCP ID 已存在: a');

        expect(h.secretStore.set).not.toHaveBeenCalled();
        expect(serversJson(h.kkv)).toEqual([JSON.parse(JSON.stringify(existing))]);
        expect(await h.secretStore.get(McpSecretRefs.bearer('a'))).toBe('existing-key');
    });

    it('connect 直连 connectionManager.connect（作废由 core 负责，本层不再 invalidate）', async () => {
        const h = await makeHarness({servers: [serverConfig('a')]});

        await h.mcp.connect('a');

        expect(h.fakeManager.connect).toHaveBeenCalledWith('a');
        expect(h.fakeManager.invalidate).not.toHaveBeenCalled();
    });

    it('connectUnconnected 透传 connectionManager.connectUnconnected（进页面触发）', async () => {
        const h = await makeHarness({servers: [serverConfig('a')]});

        await h.mcp.connectUnconnected();

        expect(h.fakeManager.connectUnconnected).toHaveBeenCalledTimes(1);
    });

    it('setToolDisabled 落库并刷新镜像，连接管理器注入的 disabledTools 闭包即时反映', async () => {
        const h = await makeHarness({servers: [serverConfig('a')]});

        await h.mcp.setToolDisabled('a', 'x', true);
        expect(h.mcp.disabledTools('a')).toEqual(['x']);
        expect(disabledJson(h.kkv)).toEqual({a: ['x']});
        expect(h.managerDeps.disabledTools('a')).toEqual(['x']);

        await h.mcp.setToolDisabled('a', 'x', false);
        expect(h.mcp.disabledTools('a')).toEqual([]);
        expect(disabledJson(h.kkv)).toEqual({});
    });

    it('停用与删除只 invalidate 不连接（T-MO2）', async () => {
        const kept = serverConfig('b');
        const h = await makeHarness({servers: [serverConfig('a'), kept]});

        await h.mcp.setEnabled('a', false);
        expect(h.fakeManager.invalidate).toHaveBeenCalledWith('a');
        expect(h.fakeManager.connect).not.toHaveBeenCalled();
        expect(h.fakeManager.connectUnconnected).not.toHaveBeenCalled();

        await h.mcp.remove('a');
        expect(h.fakeManager.invalidate).toHaveBeenCalledWith('a');
        expect(h.fakeManager.connect).not.toHaveBeenCalled();
        expect(h.fakeManager.connectUnconnected).not.toHaveBeenCalled();
    });

    it('remove 后镜像与禁用表都清掉，SKSP 三 ref 一并清除', async () => {
        const kept = serverConfig('b');
        const h = await makeHarness({
            servers: [serverConfig('a'), kept],
            disabledTools: {a: ['x']},
            secrets: {[McpSecretRefs.bearer('a')]: 'key-a', [McpSecretRefs.oauth('a')]: '{"tokens":{}}'},
        });

        await h.mcp.remove('a');

        expect(h.mcp.servers().map(config => config.id)).toEqual(['b']);
        expect(h.mcp.disabledTools('a')).toEqual([]);
        expect(disabledJson(h.kkv)).toEqual({});
        expect(serversJson(h.kkv)).toEqual([JSON.parse(JSON.stringify(kept))]);
        expect(h.secretStore.delete).toHaveBeenCalledWith(McpSecretRefs.bearer('a'));
        expect(h.secretStore.delete).toHaveBeenCalledWith(McpSecretRefs.headers('a'));
        expect(h.secretStore.delete).toHaveBeenCalledWith(McpSecretRefs.oauth('a'));
        expect(h.fakeManager.invalidate).toHaveBeenCalledWith('a');
    });
});
