import {describe, expect, it, jest} from '@jest/globals';

const mockDecode = jest.fn(() => {
  throw new Error('decode failed');
});
// 四期签名：parseText 沿 Result 回传——默认实现按 Ok 形态给出。
const mockParseText = jest.fn(() => ({ok: true as const, value: {}}));
const mockStringifyText = jest.fn(() => 'yaml');
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
  agentDefinitionSchema: {toWire: (x: any) => x},
  encode: (value: unknown, schema: {toWire: (v: unknown) => unknown}) =>
    schema.toWire(value),
  decode: (...args: any[]) => mockDecode(...args),
  parseText: (...args: any[]) => mockParseText(...args),
  registerBuiltinTools: () => undefined,
  stringifyText: (...args: any[]) => mockStringifyText(...args),
  ToolRegistry: class ToolRegistry {
    list() {
      return [];
    }
  },
  validateAgentDefinition: (...args: any[]) =>
    mockValidateAgentDefinition(...args),
}));

// 实现从 @novel-master/core/agent 子路径导入 schema/校验（jest moduleNameMapper 指向真实 dist），
// 须单独 mock，根入口 mock 拦不住子路径导入。requireActual 展开保住
// AppError 等真实导出（错误通道迁移后 yaml-document-pick 会构造 AppError）。
jest.mock('@novel-master/core/agent', () => ({
  ...jest.requireActual('@novel-master/core/agent'),
  agentDefinitionSchema: {toWire: (x: any) => x},
  validateAgentDefinition: (...args: any[]) =>
    mockValidateAgentDefinition(...args),
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
  decodeAgentYamlText,
  exportAgentYaml,
  importAgentYaml,
} from '@/services/agent-yaml.service';

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
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/tmp/a1.agent.yaml',
      'yaml',
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
    mockReadFile.mockResolvedValueOnce('name: imported');
    // 四期签名：decode 沿 Result 回传——fake 与真实契约同语义。
    mockDecode.mockImplementationOnce(() => ({
      ok: true as const,
      value: {
        name: 'imported',
        prompts: {persist: [], dynamic: []},
      },
    }));
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
    // 四期签名：parseText 失败沿 Result.err 回传（decodeAgentYamlText 不再抛错）。
    mockParseText.mockImplementationOnce(() => ({
      ok: false as const,
      error: new Error('bad yaml'),
    }));
    const decoded = decodeAgentYamlText('name: [oops');
    expect(decoded.ok).toBe(false);
    expect(decoded.ok ? undefined : decoded.error.message).toBe('bad yaml');
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
    expect(() => decodeAgentYamlText(yaml)).toThrow();
  });
});
