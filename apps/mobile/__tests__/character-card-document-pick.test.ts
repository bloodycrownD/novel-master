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
} from '../src/services/character-card-document-pick';

describe('character-card-document-pick', () => {
  it('includes PNG/JSON MIME types and isKnownType results', () => {
    const pickTypes = characterCardImportPickTypes();
    expect(pickTypes).toContain('image/*');
    expect(pickTypes).toContain('application/json');
    expect(pickTypes).toContain('application/octet-stream');
    expect(isKnownType).toHaveBeenCalled();
  });

  it('assertCharacterCardFileName accepts .png and .json', () => {
    expect(() => assertCharacterCardFileName('card.png')).not.toThrow();
    expect(() => assertCharacterCardFileName('card.JSON')).not.toThrow();
  });

  it('assertCharacterCardFileName rejects other names', () => {
    expect(() => assertCharacterCardFileName('card.zip')).toThrow(/\.png/);
    expect(() => assertCharacterCardFileName('notes.txt')).toThrow(/\.json/);
  });
});
