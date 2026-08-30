/**
 * rn-file-io：URI/字节转换工具与 blobFs 双形态适配的单测。
 */
import {
  base64ToBytes,
  bytesToAsciiString,
  bytesToBase64,
  blobFs,
  localUriToFsPath,
  toFileUri,
} from '@/services/rn-file-io';

/** 通过 getter 延迟取值，绕开 jest.mock 提升与 const 初始化的时序问题。 */
const mockBlobUtilShape: {shape: unknown} = {shape: null};

jest.mock('react-native-blob-util', () => ({
  get fs() {
    return (mockBlobUtilShape.shape as {fs?: unknown} | null)?.fs;
  },
  get default() {
    return (mockBlobUtilShape.shape as {default?: unknown} | null)?.default;
  },
}));

describe('rn-file-io', () => {
  afterEach(() => {
    mockBlobUtilShape.shape = null;
  });

  describe('localUriToFsPath', () => {
    it('解码中文文件名的 percent-encoding', () => {
      expect(
        localUriToFsPath(
          'file:///storage/emulated/0/Download/%E6%88%91%E7%9A%84%E5%A4%87%E4%BB%BD.nmbackup',
        ),
      ).toBe('/storage/emulated/0/Download/我的备份.nmbackup');
    });

    it('无 file:// 前缀时原样解码', () => {
      expect(localUriToFsPath('/cache/%E8%A7%92%E8%89%B2/card.json')).toBe(
        '/cache/角色/card.json',
      );
    });

    it('普通 ascii 路径不受影响', () => {
      expect(localUriToFsPath('file:///cache/import.zip')).toBe(
        '/cache/import.zip',
      );
    });
  });

  describe('toFileUri', () => {
    it('补上缺失的 file:// 前缀', () => {
      expect(toFileUri('/cache/a.zip')).toBe('file:///cache/a.zip');
    });

    it('已有前缀时不再叠加', () => {
      expect(toFileUri('file:///cache/a.zip')).toBe('file:///cache/a.zip');
    });
  });

  describe('bytes ↔ base64', () => {
    it('roundtrip 还原任意字节（含 0x00 与 0xff）', () => {
      const bytes = new Uint8Array(512);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = i % 256;
      }
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    });

    it('空字节 roundtrip 为空', () => {
      expect(base64ToBytes(bytesToBase64(new Uint8Array(0)))).toEqual(
        new Uint8Array(0),
      );
    });
  });

  describe('bytesToAsciiString', () => {
    it('逐字节映射为 ascii 字符', () => {
      expect(bytesToAsciiString(new Uint8Array([0x41, 0x42, 0x43]))).toBe(
        'ABC',
      );
    });
  });

  describe('blobFs CJS/ESM 双形态', () => {
    it('CJS 形态（顶层 fs）直接返回', () => {
      const fs = {dirs: {CacheDir: '/cache'}, tag: 'cjs-fs'};
      mockBlobUtilShape.shape = {fs};
      expect(blobFs()).toBe(fs);
    });

    it('ESM 形态（default.fs）兜底返回', () => {
      const fs = {dirs: {CacheDir: '/cache'}, tag: 'esm-fs'};
      mockBlobUtilShape.shape = {default: {fs}};
      expect(blobFs()).toBe(fs);
    });

    it('两种形态都缺失时抛错', () => {
      mockBlobUtilShape.shape = {};
      expect(() => blobFs()).toThrow('react-native-blob-util.fs unavailable');
    });
  });
});
