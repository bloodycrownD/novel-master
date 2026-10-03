/**
 * Mobile VFS 单文件导入/导出的 typed error。
 *
 * WHY 单独一个本地类（不改 core 导出面）：双端 ZIP / 角色卡导入的错误都走
 * core 的 `VfsZipError` / `CharacterCardError`，而单文件链路（picker 读字节、
 * 32MB 上限、误传目录）完全是 mobile 侧本地编排，core 里没有对应物。
 * 裸 `new Error` 无法与 core 错误做 instanceof 区分，这里补一个本地类把形态对齐。
 *
 * 对用户可见文案无影响：`formatError` 末尾的 `error instanceof Error →
 * error.message` 兜底对子类同样成立，输出逐字不变。
 */
export class VfsSingleFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VfsSingleFileError';
  }
}
