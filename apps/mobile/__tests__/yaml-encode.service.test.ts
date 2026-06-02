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
  agentDefinitionSchema: {encode: (x: any) => x},
  stringifyText: (_doc: any, _format: any) => 'yaml-out',
  eventsConfigSchema: {},
  parseText: () => ({}),
  decode: () => ({}),
}));

import {encodeAgentYamlText} from '../src/services/agent-yaml.service';
import {encodeEventsYamlText} from '../src/services/events-yaml.service';

describe('yaml encode helpers', () => {
  it('encodes agent definition to YAML text', () => {
    expect(encodeAgentYamlText({name: 'a'})).toBe('yaml-out');
  });

  it('encodes events config to YAML text', () => {
    expect(encodeEventsYamlText({schemaVersion: 2, events: {}})).toBe('yaml-out');
  });
});

