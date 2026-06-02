import {describe, expect, it, jest} from '@jest/globals';

const mockDecode = jest.fn(() => {
  throw new Error('decode failed');
});
const mockParseText = jest.fn(() => ({}));
const mockStringifyText = jest.fn(() => 'yaml');
const mockSaveDocuments = jest.fn(async () => undefined);
const mockPick = jest.fn(async () => []);
const mockKeepLocalCopy = jest.fn(async () => []);
const mockWriteFile = jest.fn(async () => undefined);
const mockUnlink = jest.fn(async () => undefined);
const mockReadFile = jest.fn(async () => '');

const mockEncode = jest.fn((config: unknown) => config);

jest.mock('@novel-master/core', () => ({
  eventsConfigSchema: {toWire: (x: unknown) => x},
  decode: (...args: any[]) => mockDecode(...args),
  encode: (...args: any[]) => mockEncode(...args),
  parseText: (...args: any[]) => mockParseText(...args),
  stringifyText: (...args: any[]) => mockStringifyText(...args),
}));

jest.mock('react-native-blob-util', () => ({
  fs: {
    dirs: {CacheDir: '/tmp'},
    writeFile: (...args: any[]) => mockWriteFile(...args),
    unlink: (...args: any[]) => mockUnlink(...args),
    readFile: (...args: any[]) => mockReadFile(...args),
  },
}));
jest.mock('@react-native-documents/picker', () => ({
  errorCodes: {OPERATION_CANCELED: 'OPERATION_CANCELED'},
  isErrorWithCode: (error: any) => Boolean(error?.code),
  isKnownType: () => ({mimeType: null, uti: null}),
  keepLocalCopy: (...args: any[]) => mockKeepLocalCopy(...args),
  pick: (...args: any[]) => mockPick(...args),
  saveDocuments: (...args: any[]) => mockSaveDocuments(...args),
  types: {plainText: 'text/plain'},
}));

import {
  decodeEventsYamlText,
  exportEventsYaml,
  importEventsYaml,
} from '../src/services/events-yaml.service';

describe('events-yaml.service', () => {
  it('exports events yaml via temp file and save picker', async () => {
    const runtime = {
      eventsConfig: {
        getConfig: jest.fn(async () => ({schemaVersion: 2, events: {}})),
      },
    } as any;
    await expect(exportEventsYaml(runtime)).resolves.toBe('saved');
    expect(mockEncode).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledWith('/tmp/events.config.yaml', 'yaml', 'utf8');
    expect(mockSaveDocuments).toHaveBeenCalled();
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/events.config.yaml');
  });

  it('imports events yaml via picker/copy/read and persists config', async () => {
    mockPick.mockResolvedValueOnce([{uri: 'file:///sdcard/events.config.yaml', name: 'events.config.yaml'}]);
    mockKeepLocalCopy.mockResolvedValueOnce([
      {status: 'success', localUri: 'file:///tmp/local-events.config.yaml'},
    ]);
    mockReadFile.mockResolvedValueOnce('schemaVersion: 2');
    mockDecode.mockImplementationOnce(() => ({schemaVersion: 2, events: {}}));
    const runtime = {
      eventsConfig: {
        setConfig: jest.fn(async () => undefined),
      },
    } as any;
    await importEventsYaml(runtime);
    expect(mockPick).toHaveBeenCalled();
    expect(mockKeepLocalCopy).toHaveBeenCalled();
    expect(mockReadFile).toHaveBeenCalledWith('/tmp/local-events.config.yaml', 'utf8');
    expect(runtime.eventsConfig.setConfig).toHaveBeenCalledWith({schemaVersion: 2, events: {}});
  });

  it('rejects malformed yaml', () => {
    mockParseText.mockImplementationOnce(() => {
      throw new Error('bad yaml');
    });
    expect(() => decodeEventsYamlText('schemaVersion: [2')).toThrow();
  });

  it('rejects invalid events schema', () => {
    const yaml = `
schemaVersion: 2
events:
  app.start:
    - run-agent: {}
`;
    expect(() => decodeEventsYamlText(yaml)).toThrow();
  });
});
