import {importVfsZip} from '../src/services/vfs-zip.service';

const mockExport = jest.fn();
const mockImport = jest.fn();
const mockPick = jest.fn();

jest.mock('@novel-master/core', () => ({
  createVfsZipIoService: () => ({
    export: mockExport,
    import: mockImport,
  }),
}));

jest.mock('@react-native-documents/picker', () => ({
  pick: (...args: unknown[]) => mockPick(...args),
  types: {zip: 'application/zip'},
}));

jest.mock('react-native', () => ({
  Platform: {OS: 'ios'},
  Share: {share: jest.fn()},
}));

describe('vfs-zip.service', () => {
  const runtime = {conn: {}} as never;
  const scope = {kind: 'session', projectId: 'p', sessionId: 's'} as const;

  beforeEach(() => {
    mockExport.mockReset();
    mockImport.mockReset();
    mockPick.mockReset();
    globalThis.fetch = jest.fn().mockResolvedValue({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }) as never;
  });

  it('passes confirmed to core import', async () => {
    mockPick.mockResolvedValue([{uri: 'file:///tmp/x.zip'}]);
    await importVfsZip(runtime, scope, {confirmed: true});
    expect(mockImport).toHaveBeenCalledWith(
      scope,
      expect.any(Uint8Array),
      {confirmed: true},
    );
  });

  it('skips import when picker cancelled', async () => {
    mockPick.mockResolvedValue([]);
    await importVfsZip(runtime, scope, {confirmed: true});
    expect(mockImport).not.toHaveBeenCalled();
  });
});
