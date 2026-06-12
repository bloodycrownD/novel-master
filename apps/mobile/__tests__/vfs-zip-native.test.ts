import {parseVfsZip} from '../../../packages/core/dist/domain/vfs/logic/vfs-zip-parse.js';
import {buildVfsZip} from '../../../packages/core/dist/domain/vfs/logic/vfs-zip-build.js';
import {nativeBuildVfsZip} from '../src/native/vfs-zip-native';

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return globalThis.btoa(binary);
}

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

  it('native zip STORE packs gather payload', async () => {
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

  it('preserves non-ASCII entry names parseable by parseVfsZip', async () => {
    const input = {
      files: new Map([['笔记/第一章.md', '正文']]),
      directoryEntryNames: ['空目录/'],
    };

    mockZip.mockImplementation(async () => {
      const zipBytes = buildVfsZip(input.files, input.directoryEntryNames);
      mockReadFile.mockResolvedValue(bytesToBase64(zipBytes));
      return '/cache/vfs-export-test.zip';
    });

    const bytes = await nativeBuildVfsZip(input);
    const entries = parseVfsZip(bytes);

    expect(entries.has('空目录/')).toBe(true);
    expect(entries.get('笔记/第一章.md')).toEqual(
      new TextEncoder().encode('正文'),
    );
  });

  it('includes empty directory entry parseable by parseVfsZip', async () => {
    const input = {
      files: new Map([['a.md', 'A']]),
      directoryEntryNames: ['empty/'],
    };

    mockZip.mockImplementation(async () => {
      const zipBytes = buildVfsZip(input.files, input.directoryEntryNames);
      mockReadFile.mockResolvedValue(bytesToBase64(zipBytes));
      return '/cache/vfs-export-test.zip';
    });

    const bytes = await nativeBuildVfsZip(input);
    const entries = parseVfsZip(bytes);

    expect(entries.has('empty/')).toBe(true);
    expect(entries.get('a.md')).toEqual(new TextEncoder().encode('A'));
  });

  it('cleans temp work dir and zip in finally', async () => {
    await nativeBuildVfsZip({
      files: new Map([['x.md', 'x']]),
      directoryEntryNames: [],
    });

    expect(mockUnlink).toHaveBeenCalled();
  });
});
