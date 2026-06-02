import {describe, expect, it, jest} from '@jest/globals';

jest.mock('@novel-master/core', () => ({
  agentDefinitionSchema: {encode: (x: any) => x},
  decode: (_raw: any, _schema: any) => {
    throw new Error('decode failed');
  },
  parseText: () => ({}),
  registerVfsTools: () => undefined,
  stringifyText: () => 'yaml',
  ToolRegistry: class ToolRegistry {
    list() {
      return [];
    }
  },
  validateAgentDefinition: async () => undefined,
}));

jest.mock('react-native-blob-util', () => ({
  fs: {dirs: {CacheDir: '/tmp'}, writeFile: jest.fn(), unlink: jest.fn(), readFile: jest.fn()},
}));

jest.mock('@react-native-documents/picker', () => ({}));

import {decodeAgentYamlText} from '../src/services/agent-yaml.service';

describe('agent-yaml.service', () => {
  it('rejects invalid yaml text', () => {
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
