/**
 * Jest 全局 stub for @react-native-documents/picker。
 *
 * 真实模块经 babel transform 后顶层即 TurboModuleRegistry.getEnforcing
 * 取原生模块，测试环境里报 Invariant Violation，导致整个套件无法加载。
 * 此 stub 覆盖 mobile 源码实际用到的导出；需要具体行为的测试应自行
 * `jest.mock` 覆盖（测试文件内的 jest.mock 优先生效）。
 */

export const types = {
  images: 'image/*',
  json: 'application/json',
  plainText: 'text/plain',
  allFiles: '*/*',
};

export const errorCodes = {
  IN_PROGRESS: 'IN_PROGRESS',
  OPERATION_CANCELED: 'OPERATION_CANCELED',
  INVALID_TYPE: 'INVALID_TYPE',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
};

export function isErrorWithCode(error: unknown): error is {code?: string} {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in (error as Record<string, unknown>)
  );
}

/** 非测试关注路径下始终返回未知类型，与「无法识别」分支行为一致。 */
export function isKnownType(): {mimeType: string} | undefined {
  return undefined;
}

export const pick = jest.fn();
export const keepLocalCopy = jest.fn();
export const saveDocuments = jest.fn();
