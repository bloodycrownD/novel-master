import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const mockValidateAgentDefinition = jest.fn(async (..._args: unknown[]) => ({
    ok: true,
    value: undefined,
}));
const mockSaveDocuments = jest.fn(async (..._args: unknown[]) => undefined);
const mockPick = jest.fn(async (..._args: unknown[]): Promise<Array<{uri: string; name: string}>> => []);
const mockKeepLocalCopy = jest.fn(async (..._args: unknown[]): Promise<Array<{status: string; localUri: string}>> => []);
const mockWriteFile = jest.fn(async (..._args: unknown[]) => undefined);
const mockUnlink = jest.fn(async (..._args: unknown[]) => undefined);
const mockReadFile = jest.fn(async (..._args: unknown[]) => '');

// 根入口用 shim 的真实导出（含真实 BuiltinTools / ToolRegistry）：importYaml 内部
// 用 BuiltinTools.register 装配探针拿 registeredToolNames，`mcp` 占位也在册——
// 假 registry（list() → []）会让工具名单校验失真，mcp 往返用例跑不了真校验。
jest.mock('@novel-master/core', () => ({
    ...(jest.requireActual('@novel-master/core') as Record<string, unknown>),
}));

// 实现从 @novel-master/core/agent 子路径导入编解码/校验（jest moduleNameMapper
// 指向真实 dist），须单独 mock，根入口 mock 拦不住子路径导入。requireActual
// 展开保住 AppError 等真实导出与 AgentYamlCodec 真编解码（错误通道迁移后
// yaml-document-pick 会构造 AppError）。mcp 往返用例经 mockValidateOverride
// 切到真校验器（见下方 describe 的 beforeEach）。
let mockValidateOverride: ((...args: any[]) => Promise<unknown>) | undefined;
jest.mock('@novel-master/core/agent', () => ({
    ...(jest.requireActual('@novel-master/core/agent') as Record<string, unknown>),
    AgentDefinitionValidator: {
        ...(jest.requireActual('@novel-master/core/agent') as Record<string, unknown>)
            .AgentDefinitionValidator as Record<string, unknown>,
        validate: (...args: any[]) =>
            (mockValidateOverride ?? mockValidateAgentDefinition)(...args),
    },
}));

jest.mock('react-native-blob-util', () => ({
    fs: {
        dirs: {CacheDir: '/tmp'},
        writeFile: (...args: any[]) => mockWriteFile(...args),
        unlink: (...args: any[]) => mockUnlink(...args),
        readFile: (...args: any[]) => mockReadFile(...args),
    },
}));

// 真校验器（requireActual 绕过上方 mock）：mcp 往返用例要跑真实
// AgentDefinitionValidator，证明 `mcp` 在注册表名单内被接受、未知名仍被拒。
const realValidateAgentDefinition = (
    jest.requireActual('@novel-master/core/agent') as {
        AgentDefinitionValidator: {validate: (...args: any[]) => Promise<unknown>};
    }
).AgentDefinitionValidator.validate;

jest.mock('@react-native-documents/picker', () => ({
    errorCodes: {OPERATION_CANCELED: 'OPERATION_CANCELED'},
    isErrorWithCode: (error: any) => Boolean(error?.code),
    isKnownType: () => ({mimeType: null, uti: null}),
    keepLocalCopy: (...args: any[]) => mockKeepLocalCopy(...args),
    pick: (...args: any[]) => mockPick(...args),
    saveDocuments: (...args: any[]) => mockSaveDocuments(...args),
    types: {plainText: 'text/plain'},
}));

import {AgentYamlService} from '@/services/agent-yaml.service';
import {AgentYamlCodec} from '@novel-master/core/agent';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

describe('agent-yaml.service', () => {
    it('exports yaml via temp file + picker save flow', async () => {
        const runtime = {
            agentRegistry: {
                // 四期签名：registry.get 沿 Result 回传——fake 与真实 service 同语义。
                get: jest.fn(async () => ({
                    ok: true as const,
                    value: {
                        name: 'A',
                        prompts: {persist: [], dynamic: []},
                    },
                })),
            },
        } as any;
        await expect(AgentYamlService.exportYaml(runtime, 'a1')).resolves.toEqual({ok: true, value: 'saved'});
        // 编解码单源在 core：写出的是真实 YAML（不再是 mock 的 'yaml' 字面量）。
        expect(mockWriteFile).toHaveBeenCalledWith(
            '/tmp/a1.agent.yaml',
            expect.stringContaining('name: A'),
            'utf8',
        );
        expect(mockSaveDocuments).toHaveBeenCalled();
        expect(mockUnlink).toHaveBeenCalledWith('/tmp/a1.agent.yaml');
    });

    it('rejects non-yaml file names from picker', async () => {
        mockPick.mockResolvedValueOnce([
            {uri: 'file:///sdcard/readme.txt', name: 'readme.txt'},
        ]);
        const runtime = {agentRegistry: {upsert: jest.fn()}} as any;
        await expect(AgentYamlService.importYaml(runtime, 'a1')).rejects.toThrow(/\.yaml/);
        expect(mockKeepLocalCopy).not.toHaveBeenCalled();
    });

    it('imports yaml via picker/copy/read and persists agent', async () => {
        mockPick.mockResolvedValueOnce([
            {uri: 'file:///sdcard/a1.agent.yaml', name: 'a1.agent.yaml'},
        ]);
        mockKeepLocalCopy.mockResolvedValueOnce([
            {status: 'success', localUri: 'file:///tmp/local-a1.agent.yaml'},
        ]);
        mockReadFile.mockResolvedValueOnce(
            'schemaVersion: 1\nname: imported\nprompts: {}\n',
        );
        const runtime = {
            agentRegistry: {
                upsert: jest.fn(async () => ({ok: true as const, value: undefined})),
            },
        } as any;
        await AgentYamlService.importYaml(runtime, 'a1');
        expect(mockPick).toHaveBeenCalled();
        expect(mockKeepLocalCopy).toHaveBeenCalled();
        expect(mockReadFile).toHaveBeenCalledWith(
            '/tmp/local-a1.agent.yaml',
            'utf8',
        );
        expect(mockValidateAgentDefinition).toHaveBeenCalled();
        expect(runtime.agentRegistry.upsert).toHaveBeenCalled();
    });

    it('rejects invalid yaml text', () => {
        // 编解码单源在 core：parseText 失败沿 Result.err 回传（AppError 通道，不再抛错）。
        const decoded = AgentYamlCodec.decode('name: [oops');
        expect(decoded.ok).toBe(false);
        if (decoded.ok) return;
        expect(decoded.error.key).toBe('CONFIG_DECODE_INVALID_SCHEMA');
    });

    it('rejects schema-invalid agent yaml', () => {
        const yaml = `
schemaVersion: 1
name: test
prompts:
  blocks:
    bad:
      type: text
      role: system
`;
        const decoded = AgentYamlCodec.decode(yaml);
        expect(decoded.ok).toBe(false);
        if (decoded.ok) return;
        // schema 的 superRefine 把域 AppError 挂在 issue params 上原样带出，key 是 AGENT_INVALID_SCHEMA。
        expect(decoded.error.key).toBe('AGENT_INVALID_SCHEMA');
    });
});

describe('agent-yaml.service mcp 工具往返', () => {
    /** 本组用例统一走真校验器（默认 mock 恒 ok，锁不住名单语义）。 */
    beforeEach(() => {
        mockValidateOverride = realValidateAgentDefinition;
    });

    /** 与 encode(toWire) 应产出内容一致的手写 YAML（wire 形态）。 */
    const MCP_TOOLS_YAML = `schemaVersion: 1
name: mcp-agent
prompts:
  persistEnabled: false
  dynamicEnabled: false
  persist: {}
  dynamic: {}
tools:
  allow:
    - search
    - mcp
    - curl
`;

    const PLAIN_TOOLS_YAML = `schemaVersion: 1
name: plain-agent
prompts:
  persistEnabled: false
  dynamicEnabled: false
  persist: {}
  dynamic: {}
tools:
  allow:
    - search
    - curl
`;

    /** 经 exportYaml 真导出（写临时文件被 mock 捕获），回传 YAML 文本。 */
    async function exportYamlText(def: {
        name: string;
        prompts: {persist: unknown[]; dynamic: unknown[]};
        tools?: {allow: string[]};
    }): Promise<string> {
        const runtime = {
            agentRegistry: {
                get: jest.fn(async () => ({ok: true as const, value: def})),
            },
        } as unknown as MobileNovelMasterRuntime;
        const result = await AgentYamlService.exportYaml(runtime, 'a1');
        expect(result.ok).toBe(true);
        if (!result.ok) throw result.error;
        const call = mockWriteFile.mock.calls.at(-1);
        expect(call).toBeDefined();
        return String(call![1]);
    }

    /** 让 picker/keepLocalCopy/readFile 把 yamlText 喂进 importYaml。 */
    function stubPickRead(yamlText: string): void {
        mockPick.mockResolvedValueOnce([
            {uri: 'file:///sdcard/round-trip.agent.yaml', name: 'round-trip.agent.yaml'},
        ]);
        mockKeepLocalCopy.mockResolvedValueOnce([
            {status: 'success', localUri: 'file:///tmp/local-round-trip.agent.yaml'},
        ]);
        mockReadFile.mockResolvedValueOnce(yamlText);
    }

    function makeUpsertRuntime() {
        const upsert = jest.fn(async (..._args: unknown[]) => ({ok: true as const, value: undefined}));
        const runtime = {agentRegistry: {upsert}} as unknown as MobileNovelMasterRuntime;
        return {runtime, upsert};
    }

    it('工具列表含 mcp 的智能体导出后，mcp 出现在 YAML tools 下且可再解码', async () => {
        const yaml = await exportYamlText({
            name: 'mcp-agent',
            prompts: {persist: [], dynamic: []},
            tools: {allow: ['search', 'mcp', 'curl']},
        });
        expect(yaml).toContain('mcp');
        // 编解码单源在 core：导出物必须能被真实 decode 还原 tools.allow（形态与顺序一起锁）。
        const decoded = AgentYamlCodec.decode(yaml);
        expect(decoded.ok).toBe(true);
        if (!decoded.ok) return;
        expect(decoded.value.tools?.allow).toEqual(['search', 'mcp', 'curl']);
    });

    it('导入：mcp 与其余工具按原顺序进入落库定义（registeredToolNames 含 mcp）', async () => {
        // 导入侧先用手写 wire YAML 锁行为：导出侧 encode 目前带 Result 信封（生产缺陷，
        // 见上方导出用例的红），修复后本用例与导出用例合起来即完整往返。
        stubPickRead(MCP_TOOLS_YAML);
        const {runtime, upsert} = makeUpsertRuntime();
        const result = await AgentYamlService.importYaml(runtime, 'a1');
        expect(result.ok).toBe(true);
        const call = upsert.mock.calls[0];
        expect(call).toBeDefined();
        const savedDef = call![1] as {tools?: {allow?: string[]}};
        expect(savedDef.tools?.allow).toEqual(['search', 'mcp', 'curl']);
        const opts = call![2] as {registeredToolNames?: readonly string[]};
        expect(opts.registeredToolNames).toContain('mcp');
    });

    it('导入：不含 mcp 的定义落库后不会多出 mcp', async () => {
        stubPickRead(PLAIN_TOOLS_YAML);
        const {runtime, upsert} = makeUpsertRuntime();
        const result = await AgentYamlService.importYaml(runtime, 'a1');
        expect(result.ok).toBe(true);
        const call = upsert.mock.calls[0];
        expect(call).toBeDefined();
        const savedDef = call![1] as {tools?: {allow?: string[]}};
        expect(savedDef.tools?.allow).toEqual(['search', 'curl']);
    });

    it('tools 里的未知工具名仍被校验拒绝', async () => {
        stubPickRead(`schemaVersion: 1
name: unknown-tool-agent
prompts: {}
tools:
  allow:
    - search
    - no_such_tool_xyz
`);
        const {runtime, upsert} = makeUpsertRuntime();
        const result = await AgentYamlService.importYaml(runtime, 'a1');
        expect(result.ok).toBe(false);
        if (result.ok) return;
        // normalizeYaml 把原 AppError 的 detail（含未知名）拼进 message。
        expect(result.error.message).toContain('no_such_tool_xyz');
        expect(upsert).not.toHaveBeenCalled();
    });
});
