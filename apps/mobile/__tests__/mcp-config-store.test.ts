/**
 * McpRuntimeStore 薄镜像（spec mcp-support Step 13/14 / CR-09 / CR-02）：
 *
 * - 写路径全部委托 core（McpConfigStoreFactory 的 store + McpToolRefs.renameWithRewrite），
 *   连接管理器工厂被 mock 以便观测 connect 的 invalidate → snapshotTools 次序
 *   与注入的 disabledTools 闭包；KKV / SKSP / agentRegistry 用内存实现跑真链路
 * - rename 成功（引用改写 + 密钥迁移 + afterRename 落点）与失败回滚（不留半截状态）
 * - create 撞名被拒转 throw 且不写任何密钥（CR-02 的 store 级断言）
 * - setToolDisabled 落库并刷新镜像；remove 连带清镜像、禁用表与 SKSP refs
 */
import type {AgentRegistryService} from '@novel-master/core/agent';
import {AppError, Result} from '@novel-master/core/errors';
import type {KkvService} from '@novel-master/core/kkv';
import {McpConfigStoreFactory, McpConnectionManagerFactory, McpSecretRefs, type McpConnectionManagerDeps, type McpRequestFn, type McpServerConfig} from '@novel-master/core/mcp';
import type {SecretStore} from '@novel-master/core/sksp';
import {McpRuntimeFactory, type McpRuntimeSlice} from '@/services/mcp-config.store';

jest.mock('@novel-master/core/mcp', () => {
    const actual = jest.requireActual<typeof import('@novel-master/core/mcp')>('@novel-master/core/mcp');
    return {
        ...actual,
        // 只 mock 连接管理器工厂（不发真请求、可观测调用次序）；store / renameWithRewrite / OAuth 走真实 core 实现。
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

/** 内存版 agent 注册表：只实现 renameWithRewrite 的窄接缝（listAgentIds / get / upsert）。 */
class InMemoryAgentRegistry {
    private defs = new Map<string, Record<string, unknown>>();
    private upsertGate: ((agentId: string) => boolean) | null = null;

    seed(agentId: string, def: Record<string, unknown>): void {
        this.defs.set(agentId, def);
    }

    /** 注入 upsert 拒绝（模拟写库失败），命中谓词的 agent 写不进去。 */
    rejectUpsertWhen(matches: (agentId: string) => boolean): void {
        this.upsertGate = matches;
    }

    raw(agentId: string): Record<string, unknown> | undefined {
        return this.defs.get(agentId);
    }

    async listAgentIds(): Promise<readonly string[]> {
        return [...this.defs.keys()];
    }

    async get(agentId: string): Promise<Result<Record<string, unknown>, AppError>> {
        const def = this.defs.get(agentId);
        return def == null ? Result.err(new AppError('INFRA_UNEXPECTED_ERROR', {detail: `agent 未找到: ${agentId}`})) : Result.ok(def);
    }

    async upsert(agentId: string, def: Record<string, unknown>): Promise<Result<void, AppError>> {
        if (this.upsertGate?.(agentId) === true) {
            return Result.err(new AppError('INFRA_UNEXPECTED_ERROR', {detail: `agent 写库失败: ${agentId}`}));
        }
        this.defs.set(agentId, def);
        return Result.ok(undefined);
    }
}

/** mock 版连接管理器（McpConnectionManager 五方法全数 jest.fn，不发真请求）。 */
function createFakeManager() {
    return {
        snapshotTools: jest.fn(async () => []),
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

/** 读内存 agent 的 tools 名单（断言用；agent 或 tools 缺失回空对象）。 */
function agentTools(registry: InMemoryAgentRegistry, agentId: string): {allow?: string[]; deny?: string[]} {
    const tools = registry.raw(agentId)?.tools;
    return (tools ?? {}) as {allow?: string[]; deny?: string[]};
}

interface SliceHarness {
    mcp: McpRuntimeSlice;
    kkv: InMemoryKkv;
    secretStore: ReturnType<typeof createSecretStore>;
    registry: InMemoryAgentRegistry;
    fakeManager: ReturnType<typeof createFakeManager>;
    managerDeps: McpConnectionManagerDeps;
}

async function makeHarness(seed: {servers?: McpServerConfig[]; disabledTools?: Record<string, readonly string[]>; secrets?: Record<string, string>; agents?: Array<[string, Record<string, unknown>]>} = {}): Promise<SliceHarness> {
    const kkv = new InMemoryKkv();
    if (seed.servers != null) kkv.inject(McpConfigStoreFactory.KKV_MODULE, McpConfigStoreFactory.KEY_SERVERS, JSON.stringify(seed.servers));
    if (seed.disabledTools != null) kkv.inject(McpConfigStoreFactory.KKV_MODULE, McpConfigStoreFactory.KEY_DISABLED_TOOLS, JSON.stringify(seed.disabledTools));
    const secretStore = createSecretStore(seed.secrets ?? {});
    const registry = new InMemoryAgentRegistry();
    for (const [agentId, def] of seed.agents ?? []) registry.seed(agentId, def);
    const fakeManager = createFakeManager();
    const managerCreate = McpConnectionManagerFactory.create as unknown as jest.Mock;
    managerCreate.mockReset();
    managerCreate.mockImplementation(() => fakeManager);
    const mcp = await McpRuntimeFactory.create({kkv, secretStore: secretStore as unknown as SecretStore, agentRegistry: registry as unknown as AgentRegistryService, requestFnFor: () => fakeRequestFn});
    const managerDeps = managerCreate.mock.calls[0][0] as McpConnectionManagerDeps;
    return {mcp, kkv, secretStore, registry, fakeManager, managerDeps};
}

describe('mcp-config.store 薄镜像（CR-09 / CR-02）', () => {
    it('rename 成功：agent 引用改写、KKV 原位替换、SKSP 密钥迁新 ref 清旧 ref、afterRename 落在新 ref、镜像刷新并 invalidate 新旧 ID', async () => {
        const oldConfig = serverConfig('a');
        const h = await makeHarness({
            servers: [oldConfig],
            secrets: {[McpSecretRefs.bearer('a')]: 'key-a'},
            agents: [['agent-1', {id: 'agent-1', tools: {allow: ['mcp__a__x'], deny: ['mcp__a__y']}}]],
        });
        const newConfig = {...oldConfig, id: 'b'};

        let afterRenameTarget = '';
        await h.mcp.rename('a', newConfig, async () => {
            afterRenameTarget = McpSecretRefs.bearer(newConfig.id);
            await h.secretStore.set(afterRenameTarget, 'key-new');
        });

        expect(h.mcp.servers().map(config => config.id)).toEqual(['b']);
        expect(serversJson(h.kkv)).toEqual([JSON.parse(JSON.stringify(newConfig))]);
        expect(agentTools(h.registry, 'agent-1').allow).toEqual(['mcp__b__x']);
        expect(agentTools(h.registry, 'agent-1').deny).toEqual(['mcp__b__y']);
        expect(afterRenameTarget).toBe(McpSecretRefs.bearer('b'));
        expect(await h.secretStore.get(McpSecretRefs.bearer('b'))).toBe('key-new');
        expect(await h.secretStore.get(McpSecretRefs.bearer('a'))).toBeNull();
        expect(h.fakeManager.invalidate).toHaveBeenCalledWith('a');
        expect(h.fakeManager.invalidate).toHaveBeenCalledWith('b');
    });

    it('rename 失败（afterRename 抛错）：转 throw 且回滚不留半截状态——配置回旧 ID、引用回旧前缀、旧密钥仍在旧 ref', async () => {
        const oldConfig = serverConfig('a');
        const h = await makeHarness({
            servers: [oldConfig],
            secrets: {[McpSecretRefs.bearer('a')]: 'key-a'},
            agents: [['agent-1', {id: 'agent-1', tools: {allow: ['mcp__a__x']}}]],
        });

        await expect(
            h.mcp.rename('a', {...oldConfig, id: 'b'}, async () => {
                throw new Error('写 bearer 失败');
            }),
        ).rejects.toThrow('写 bearer 失败');

        expect(h.mcp.servers().map(config => config.id)).toEqual(['a']);
        expect(agentTools(h.registry, 'agent-1').allow).toEqual(['mcp__a__x']);
        expect(await h.secretStore.get(McpSecretRefs.bearer('a'))).toBe('key-a');
        expect(await h.secretStore.get(McpSecretRefs.bearer('b'))).toBeNull();
    });

    it('rename 失败（agent 引用改写被拒）：转 throw 且 store 完全未动', async () => {
        const oldConfig = serverConfig('a');
        const h = await makeHarness({
            servers: [oldConfig],
            secrets: {[McpSecretRefs.bearer('a')]: 'key-a'},
            agents: [['agent-1', {id: 'agent-1', tools: {allow: ['mcp__a__x']}}]],
        });
        h.registry.rejectUpsertWhen(() => true);

        await expect(h.mcp.rename('a', {...oldConfig, id: 'b'})).rejects.toThrow('MCP 工具引用改写失败');

        expect(h.mcp.servers().map(config => config.id)).toEqual(['a']);
        expect(agentTools(h.registry, 'agent-1').allow).toEqual(['mcp__a__x']);
        expect(await h.secretStore.get(McpSecretRefs.bearer('a'))).toBe('key-a');
        expect(serversJson(h.kkv)).toEqual([JSON.parse(JSON.stringify(oldConfig))]);
    });

    it('create 撞名被拒：转 throw、不写任何密钥、KKV 不变（CR-02 的 store 级断言）', async () => {
        const existing = serverConfig('a');
        const h = await makeHarness({servers: [existing], secrets: {[McpSecretRefs.bearer('a')]: 'existing-key'}});

        await expect(h.mcp.create({...existing, auth: {type: 'bearer', secretRef: McpSecretRefs.bearer('a')}})).rejects.toThrow('MCP ID 已存在: a');

        expect(h.secretStore.set).not.toHaveBeenCalled();
        expect(serversJson(h.kkv)).toEqual([JSON.parse(JSON.stringify(existing))]);
        expect(await h.secretStore.get(McpSecretRefs.bearer('a'))).toBe('existing-key');
    });

    it('connect 先 invalidate 再 snapshotTools', async () => {
        const h = await makeHarness({servers: [serverConfig('a')]});

        await h.mcp.connect('a');

        expect(h.fakeManager.invalidate).toHaveBeenCalledWith('a');
        expect(h.fakeManager.snapshotTools).toHaveBeenCalledTimes(1);
        const [invalidateOrder] = h.fakeManager.invalidate.mock.invocationCallOrder;
        const [snapshotOrder] = h.fakeManager.snapshotTools.mock.invocationCallOrder;
        if (invalidateOrder == null || snapshotOrder == null) {
            throw new Error('connect 未触发 invalidate / snapshotTools');
        }
        expect(invalidateOrder).toBeLessThan(snapshotOrder);
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
