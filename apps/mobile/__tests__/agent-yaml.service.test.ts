import {describe, expect, it, jest} from '@jest/globals';
jest.mock('react-native-blob-util', () => ({default: {fs: {}}}));
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
