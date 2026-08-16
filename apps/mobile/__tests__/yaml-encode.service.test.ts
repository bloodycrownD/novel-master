import {describe, expect, it, jest} from '@jest/globals';

jest.mock('react-native-blob-util', () => ({
  fs: {
    dirs: {CacheDir: '/tmp'},
    writeFile: jest.fn(),
    unlink: jest.fn(),
    readFile: jest.fn(),
  },
}));

jest.mock('@react-native-documents/picker', () => ({}));

jest.mock('@novel-master/core', () => ({
  agentDefinitionSchema: {toWire: (x: any) => x},
  encode: (_value: unknown, schema: {toWire: (v: unknown) => unknown}) =>
    schema.toWire(_value),
  stringifyText: (_doc: unknown, _format: string) => 'yaml-out',
  parseText: () => ({}),
  decode: () => ({}),
}));

// 实现从 @novel-master/core/agent 子路径导入 schema（jest moduleNameMapper 指向真实 dist），
// 须单独 mock，否则真实 toWire 要求完整 AgentDefinition 结构。
jest.mock('@novel-master/core/agent', () => ({
  agentDefinitionSchema: {toWire: (x: any) => x},
}));

import {encodeAgentYamlText} from '../src/services/agent-yaml.service';

describe('yaml encode helpers', () => {
  it('encodes agent definition to YAML text', () => {
    expect(encodeAgentYamlText({name: 'a'})).toBe('yaml-out');
  });
});

