import {describe, expect, it, jest} from '@jest/globals';

jest.mock('@react-native-documents/picker', () => ({
  isKnownType: jest.fn(() => ({mimeType: 'application/yaml', uti: 'public.yaml'})),
  types: {plainText: 'text/plain'},
}));

import {isKnownType} from '@react-native-documents/picker';
import {
  assertYamlFileName,
  yamlImportPickTypes,
} from '../src/services/yaml-document-pick';

describe('yaml-document-pick', () => {
  it('includes common YAML MIME types and isKnownType results', () => {
    const types = yamlImportPickTypes();
    expect(types).toContain('text/plain');
    expect(types).toContain('application/x-yaml');
    expect(types).toContain('application/octet-stream');
    expect(isKnownType).toHaveBeenCalled();
  });

  it('assertYamlFileName accepts .yaml and .yml', () => {
    expect(() => assertYamlFileName('a.agent.yaml')).not.toThrow();
    expect(() => assertYamlFileName('events.config.yml')).not.toThrow();
  });

  it('assertYamlFileName rejects non-yaml names', () => {
    expect(() => assertYamlFileName('notes.txt')).toThrow(/\.yaml/);
  });
});
