import {importCharacterCard} from '@/services/vfs-character-card.service';
import {CharacterCardError} from '@novel-master/core/vfs';

const mockImportFromBytes = jest.fn();
const mockCreateCharacterCardImportService = jest.fn();
const mockPick = jest.fn();
const mockKeepLocalCopy = jest.fn();
const mockReadFile = jest.fn();
const mockExists = jest.fn();

jest.mock('@novel-master/core/vfs', () => ({
  ...jest.requireActual('@novel-master/core/vfs'),
  createCharacterCardImportService: (...args: unknown[]) =>
    mockCreateCharacterCardImportService(...args),
}));

jest.mock('@react-native-documents/picker', () => ({
  pick: (...args: unknown[]) => mockPick(...args),
  keepLocalCopy: (...args: unknown[]) => mockKeepLocalCopy(...args),
  isKnownType: () => ({mimeType: 'image/png'}),
  types: {
    images: 'image/*',
    json: 'application/json',
    plainText: 'text/plain',
  },
}));

jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    fs: {
      dirs: {CacheDir: '/cache'},
      readFile: (...args: unknown[]) => mockReadFile(...args),
      exists: (...args: unknown[]) => mockExists(...args),
    },
  },
}));

/** Minimal UTF-8 JSON character card (description only). */
const CARD_JSON = JSON.stringify({
  spec: 'chara_card_v2',
  data: {description: 'hello'},
});
const CARD_BASE64 = globalThis.btoa(CARD_JSON);

describe('vfs-character-card.service', () => {
  const runtime = {conn: {}} as never;
  const scope = {kind: 'session', projectId: 'p', sessionId: 's'} as const;

  beforeEach(() => {
    mockImportFromBytes.mockReset();
    mockCreateCharacterCardImportService.mockReset();
    mockPick.mockReset();
    mockKeepLocalCopy.mockReset();
    mockReadFile.mockReset();
    mockExists.mockReset();
    mockCreateCharacterCardImportService.mockReturnValue({
      importFromBytes: mockImportFromBytes,
    });
    mockImportFromBytes.mockResolvedValue(undefined);
    mockKeepLocalCopy.mockResolvedValue([
      {
        status: 'success',
        localUri: 'file:///cache/card.json',
        sourceUri: 'content://picked',
      },
    ]);
    mockExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(CARD_BASE64);
  });

  it('uses createCharacterCardImportService(conn) and importFromBytes', async () => {
    mockPick.mockResolvedValue([
      {uri: 'content://downloads/card.json', name: 'card.json'},
    ]);
    await importCharacterCard(runtime, scope, {confirmed: true});
    expect(mockCreateCharacterCardImportService).toHaveBeenCalledTimes(1);
    expect(mockCreateCharacterCardImportService).toHaveBeenCalledWith(
      runtime.conn,
    );
    expect(mockImportFromBytes).toHaveBeenCalledWith(
      scope,
      expect.any(Uint8Array),
      {confirmed: true, directoryPath: '/'},
    );
  });

  it('imports via keepLocalCopy and blob read', async () => {
    mockPick.mockResolvedValue([
      {uri: 'content://downloads/card.json', name: 'card.json'},
    ]);
    await importCharacterCard(runtime, scope, {confirmed: true});
    expect(mockKeepLocalCopy).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [{uri: 'content://downloads/card.json', fileName: 'card.json'}],
        destination: 'cachesDirectory',
      }),
    );
    expect(mockReadFile).toHaveBeenCalledWith('/cache/card.json', 'base64');
  });

  it('passes directoryPath to Core importFromBytes', async () => {
    mockPick.mockResolvedValue([
      {uri: 'content://downloads/card.png', name: 'card.png'},
    ]);
    await importCharacterCard(runtime, scope, {
      confirmed: true,
      directoryPath: '/角色',
    });
    expect(mockImportFromBytes).toHaveBeenCalledWith(
      scope,
      expect.any(Uint8Array),
      {confirmed: true, directoryPath: '/角色'},
    );
  });

  it('rejects non png/json file names before Core import', async () => {
    mockPick.mockResolvedValue([
      {uri: 'content://downloads/x.zip', name: 'x.zip'},
    ]);
    await expect(
      importCharacterCard(runtime, scope, {confirmed: true}),
    ).rejects.toThrow(/\.png/);
    expect(mockKeepLocalCopy).not.toHaveBeenCalled();
    expect(mockImportFromBytes).not.toHaveBeenCalled();
  });

  it('surfaces CharacterCardError from Core without retry', async () => {
    mockPick.mockResolvedValue([
      {uri: 'content://downloads/card.json', name: 'card.json'},
    ]);
    const cardErr = new CharacterCardError(
      'NOT_CHARACTER_CARD',
      '无法识别为角色卡',
    );
    mockImportFromBytes.mockRejectedValue(cardErr);

    await expect(
      importCharacterCard(runtime, scope, {confirmed: true}),
    ).rejects.toThrow('无法识别为角色卡');
    expect(mockCreateCharacterCardImportService).toHaveBeenCalledTimes(1);
  });

  it('skips import when picker cancelled', async () => {
    mockPick.mockResolvedValue([]);
    await importCharacterCard(runtime, scope, {confirmed: true});
    expect(mockKeepLocalCopy).not.toHaveBeenCalled();
    expect(mockImportFromBytes).not.toHaveBeenCalled();
  });
});
