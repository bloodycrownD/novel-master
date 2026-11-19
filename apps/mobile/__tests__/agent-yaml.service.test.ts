import {describe, expect, it, jest} from '@jest/globals';

const mockValidateAgentDefinition = jest.fn(async () => ({
  ok: true,
  value: undefined,
}));
const mockSaveDocuments = jest.fn(async () => undefined);
const mockPick = jest.fn(async () => []);
const mockKeepLocalCopy = jest.fn(async () => []);
const mockWriteFile = jest.fn(async () => undefined);
const mockUnlink = jest.fn(async () => undefined);
const mockReadFile = jest.fn(async () => '');

jest.mock('@novel-master/core', () => ({
  BuiltinTools: {register: () => undefined},
  ToolRegistry: class ToolRegistry {
    list() {
      return [];
    }
  },
}));

// 实现从 @novel-master/core/agent 子路径导入编解码/校验（jest moduleNameMapper
// 指向真实 dist），须单独 mock，根入口 mock 拦不住子路径导入。requireActual
// 展开保住 AppError 等真实导出与 AgentYamlCodec 真编解码（错误通道迁移后
// yaml-document-pick 会构造 AppError）。
jest.mock('@novel-master/core/agent', () => ({
  ...jest.requireActual('@novel-master/core/agent'),
  AgentDefinitionValidator: {
    ...jest.requireActual('@novel-master/core/agent')
      .AgentDefinitionValidator,
    validate: (...args: any[]) => mockValidateAgentDefinition(...args),
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

jest.mock('@react-native-documents/picker', () => ({
  errorCodes: {OPERATION_CANCELED: 'OPERATION_CANCELED'},
  isErrorWithCode: (error: any) => Boolean(error?.code),
  isKnownType: () => ({mimeType: null, uti: null}),
  keepLocalCopy: (...args: any[]) => mockKeepLocalCopy(...args),
  pick: (...args: any[]) => mockPick(...args),
  saveDocuments: (...args: any[]) => mockSaveDocuments(...args),
  types: {plainText: 'text/plain'},
}));

import {
  exportAgentYaml,
  importAgentYaml,
} from '@/services/agent-yaml.service';
import {AgentYamlCodec} from '@novel-master/core/agent';

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
    await expect(exportAgentYaml(runtime, 'a1')).resolves.toBe('saved');
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
    await expect(importAgentYaml(runtime, 'a1')).rejects.toThrow(/\.yaml/);
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
    await importAgentYaml(runtime, 'a1');
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
