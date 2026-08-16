/**
 * Jest 全局 stub for @op-engineering/op-sqlite。
 *
 * RN resolver 会按包的 `react-native` 字段解析到 `src/index.ts`，其顶层
 * 访问原生 turbo module，测试环境里报「Base module not found」，导致整个
 * 套件无法加载。此 stub 覆盖 tdbc-driver-op-sqlite 静态 adapter 实际用到的
 * 导出（open / ANDROID_FILES_PATH / IOS_DOCUMENT_PATH）；需要真实行为的
 * 测试应自行 `jest.mock` 覆盖。
 */

export const ANDROID_FILES_PATH = '/mock-android-files';
export const IOS_DOCUMENT_PATH = '/mock-ios-documents';

/** 假连接对象：常用方法均为 jest.fn()，仅保证可加载、可调用。 */
export const MOCK_DB = {
  execute: jest.fn(),
  executeAsync: jest.fn(),
  close: jest.fn(),
  delete: jest.fn(),
  attach: jest.fn(),
  detach: jest.fn(),
  transaction: jest.fn(),
};

export const open = jest.fn(() => MOCK_DB);

export default {open, ANDROID_FILES_PATH, IOS_DOCUMENT_PATH};
