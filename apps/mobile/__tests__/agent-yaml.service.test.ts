import {describe, expect, it, jest} from '@jest/globals';

const mockDecode = jest.fn(() => {
  throw new Error('decode failed');
});
const mockParseText = jest.fn(() => ({}));
const mockStringifyText = jest.fn(() => 'yaml');
const mockValidateAgentDefinition = jest.fn(async () => undefined);
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
  registerVfsTools: () => undefined,
  stringifyText: (...args: any[]) => mockStringifyText(...args),
  ToolRegistry: class ToolRegistry {
    list() {
      return [];
    }
  },
  validateAgentDefinition: (...args: any[]) => mockValidateAgentDefinition(...args),
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
} from '../src/services/agent-yaml.service';

describe('agent-yaml.service', () => {
  it('exports yaml via temp file + picker save flow', async () => {
    const runtime = {
      agentRegistry: {
        get: jest.fn(async () => ({name: 'A', prompts: [{name: 'c', type: 'chat'}]})),
      },
    } as any;
    await expect(exportAgentYaml(runtime, 'a1')).resolves.toBe('saved');
    expect(mockWriteFile).toHaveBeenCalledWith('/tmp/a1.agent.yaml', 'yaml', 'utf8');
    expect(mockSaveDocuments).toHaveBeenCalled();
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/a1.agent.yaml');
  });

  it('rejects non-yaml file names from picker', async () => {
    mockPick.mockResolvedValueOnce([{uri: 'file:///sdcard/readme.txt', name: 'readme.txt'}]);
    const runtime = {agentRegistry: {upsert: jest.fn()}} as any;
    await expect(importAgentYaml(runtime, 'a1')).rejects.toThrow(/\.yaml/);
    expect(mockKeepLocalCopy).not.toHaveBeenCalled();
  });

  it('imports yaml via picker/copy/read and persists agent', async () => {
    mockPick.mockResolvedValueOnce([{uri: 'file:///sdcard/a1.agent.yaml', name: 'a1.agent.yaml'}]);
    mockKeepLocalCopy.mockResolvedValueOnce([
      {status: 'success', localUri: 'file:///tmp/local-a1.agent.yaml'},
    ]);
    mockReadFile.mockResolvedValueOnce('name: imported');
    mockDecode.mockImplementationOnce(() => ({name: 'imported', prompts: [{name: 'c', type: 'chat'}]}));
    const runtime = {
      agentRegistry: {
        upsert: jest.fn(async () => undefined),
      },
    } as any;
    await importAgentYaml(runtime, 'a1');
    expect(mockPick).toHaveBeenCalled();
    expect(mockKeepLocalCopy).toHaveBeenCalled();
    expect(mockReadFile).toHaveBeenCalledWith('/tmp/local-a1.agent.yaml', 'utf8');
    expect(mockValidateAgentDefinition).toHaveBeenCalled();
    expect(runtime.agentRegistry.upsert).toHaveBeenCalled();
  });

  it('rejects invalid yaml text', () => {
    mockParseText.mockImplementationOnce(() => {
      throw new Error('bad yaml');
    });
    expect(() => decodeAgentYamlText('name: [oops')).toThrow();
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
