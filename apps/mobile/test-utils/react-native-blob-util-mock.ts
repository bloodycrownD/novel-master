/**
 * Jest 全局 stub for react-native-blob-util。
 *
 * 真实模块在顶层 `new NativeEventEmitter(...)`，测试环境里原生模块为 null
 * 会直接抛 Invariant Violation，导致整个套件无法加载。此 stub 仅保证
 * 「不 mock 也能 import」；需要具体行为的测试应自行 `jest.mock` 覆盖
 * （moduleNameMapper 之下，测试文件内的 jest.mock 依然优先生效）。
 */

/** 常用目录的占位路径，与各测试局部 mock 的取值保持一致。 */
export const MOCK_DIRS = {
  CacheDir: '/cache',
  DocumentDir: '/documents',
  DatabasesDir: '/db',
  LibraryDir: '/library',
  MainBundleDir: '/bundle',
};

/** 假 fs 实现：全部为 jest.fn()，默认返回 undefined，仅保证可调用。 */
export const fs = {
  dirs: MOCK_DIRS,
  exists: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  appendFile: jest.fn(),
  cp: jest.fn(),
  mv: jest.fn(),
  unlink: jest.fn(),
  ls: jest.fn(),
  stat: jest.fn(),
  mkdir: jest.fn(),
  isDir: jest.fn(),
  createFile: jest.fn(),
};

export default {
  fs,
  config: jest.fn(),
  fetch: jest.fn(),
  session: jest.fn(),
};
