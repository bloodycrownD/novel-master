import {nativeBuildVfsZip} from '../src/native/vfs-zip-native';

const mockZip = jest.fn();
const mockWriteFile = jest.fn();
const mockReadFile = jest.fn();
const mockExists = jest.fn();
const mockMkdir = jest.fn();
const mockUnlink = jest.fn();
const mockLs = jest.fn();
const mockStat = jest.fn();

jest.mock('react-native-zip-archive', () => ({
  zip: (...args: unknown[]) => mockZip(...args),
}));

jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    fs: {
      dirs: {CacheDir: '/cache'},
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
      readFile: (...args: unknown[]) => mockReadFile(...args),
      exists: (...args: unknown[]) => mockExists(...args),
      mkdir: (...args: unknown[]) => mockMkdir(...args),
      unlink: (...args: unknown[]) => mockUnlink(...args),
      ls: (...args: unknown[]) => mockLs(...args),
      stat: (...args: unknown[]) => mockStat(...args),
    },
  },
}));

describe('nativeBuildVfsZip', () => {
  beforeEach(() => {
    mockZip.mockReset();
    mockWriteFile.mockReset();
    mockReadFile.mockReset();
    mockExists.mockReset();
    mockMkdir.mockReset();
    mockUnlink.mockReset();
    mockLs.mockReset();
    mockStat.mockReset();

    mockExists.mockResolvedValue(false);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockZip.mockResolvedValue('/cache/vfs-export-test.zip');
    mockReadFile.mockResolvedValue('ZGF0YQ==');
    mockLs.mockResolvedValue([]);
    mockStat.mockResolvedValue({type: 'file'});
    mockUnlink.mockResolvedValue(undefined);
  });

  it('M-native-2: writes entries, zips work dir with STORE, returns bytes', async () => {
    const bytes = await nativeBuildVfsZip({
      files: new Map([
        ['a.md', 'A'],
        ['dir/b.md', 'B'],
      ]),
      directoryEntryNames: ['empty/'],
    });

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringMatching(/\/cache\/vfs-export-[^/]+\/a\.md$/),
      'A',
      'utf8',
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringMatching(/\/cache\/vfs-export-[^/]+\/dir\/b\.md$/),
      'B',
      'utf8',
    );
    expect(mockZip).toHaveBeenCalledWith(
      expect.stringMatching(/\/cache\/vfs-export-[^/]+$/),
      expect.stringMatching(/\/cache\/vfs-export-[^/]+\.zip$/),
      0,
    );
    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringMatching(/\/cache\/vfs-export-[^/]+\.zip$/),
      'base64',
    );
    expect(bytes).toEqual(new Uint8Array([0x64, 0x61, 0x74, 0x61]));
  });

  it('cleans temp work dir and zip in finally', async () => {
    await nativeBuildVfsZip({
      files: new Map([['x.md', 'x']]),
      directoryEntryNames: [],
    });

    expect(mockUnlink).toHaveBeenCalled();
  });
});
