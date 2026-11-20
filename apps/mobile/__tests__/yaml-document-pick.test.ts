import {describe, expect, it, jest} from '@jest/globals';

jest.mock('@react-native-documents/picker', () => ({
  isKnownType: jest.fn(() => ({
    mimeType: 'application/yaml',
    uti: 'public.yaml',
  })),
  types: {plainText: 'text/plain'},
}));

import {isKnownType} from '@react-native-documents/picker';
import {YamlDocumentPick} from '@/services/yaml-document-pick';

describe('yaml-document-pick', () => {
  it('includes common YAML MIME types and isKnownType results', () => {
    const types = YamlDocumentPick.importPickTypes();
    expect(types).toContain('text/plain');
    expect(types).toContain('application/x-yaml');
    expect(types).toContain('application/octet-stream');
    expect(isKnownType).toHaveBeenCalled();
  });

  it('assertYamlFileName accepts .yaml and .yml', () => {
    expect(YamlDocumentPick.assertFileName('a.agent.yaml').ok).toBe(true);
    expect(YamlDocumentPick.assertFileName('events.config.yml').ok).toBe(true);
  });

  it('assertYamlFileName rejects non-yaml names', () => {
    const rejected = YamlDocumentPick.assertFileName('notes.txt');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.key).toBe('INFRA_VALIDATION_FAILED');
      expect(rejected.error.message).toMatch(/\.yaml/);
    }
  });
});
