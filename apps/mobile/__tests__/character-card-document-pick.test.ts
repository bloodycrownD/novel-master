import {describe, expect, it, jest} from '@jest/globals';

jest.mock('@react-native-documents/picker', () => ({
  isKnownType: jest.fn(() => ({mimeType: 'image/png', uti: 'public.png'})),
  types: {
    images: 'image/*',
    json: 'application/json',
    plainText: 'text/plain',
  },
}));

import {isKnownType} from '@react-native-documents/picker';
import {
  assertCharacterCardFileName,
  characterCardImportPickTypes,
} from '@/services/character-card-document-pick';

describe('character-card-document-pick', () => {
  it('includes PNG/JSON MIME types and isKnownType results', () => {
    const pickTypes = characterCardImportPickTypes();
    expect(pickTypes).toContain('image/*');
    expect(pickTypes).toContain('application/json');
    expect(pickTypes).toContain('application/octet-stream');
    expect(isKnownType).toHaveBeenCalled();
  });

  it('assertCharacterCardFileName accepts .png and .json', () => {
    expect(assertCharacterCardFileName('card.png').ok).toBe(true);
    expect(assertCharacterCardFileName('card.JSON').ok).toBe(true);
  });

  it('assertCharacterCardFileName rejects other names', () => {
    const zip = assertCharacterCardFileName('card.zip');
    expect(zip.ok).toBe(false);
    if (!zip.ok) {
      expect(zip.error.key).toBe('INFRA_VALIDATION_FAILED');
      expect(zip.error.message).toMatch(/\.png/);
    }
    const txt = assertCharacterCardFileName('notes.txt');
    expect(txt.ok).toBe(false);
    if (!txt.ok) {
      expect(txt.error.key).toBe('INFRA_VALIDATION_FAILED');
      expect(txt.error.message).toMatch(/\.json/);
    }
  });
});
