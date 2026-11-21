/**
 * Mobile YAML 导入导出的公共编排。
 *
 * 选择器的 save/pick/keepLocalCopy 编排统一走 `document-io`；
 * 具体每个 schema 的 decode/encode 和落库逻辑交给调用方以回调注入，避免
 * 把业务知识塞进这层。错误归一由 core 的 `Errors.normalizeYaml` 提供，
 * 调用方直接从 `@novel-master/core/common` 取。
 */
import {Result, AppError} from '@novel-master/core/errors';
import {DocumentIo, type PickLocalFileOptions} from './document-io';
import {RnFileIo} from './rn-file-io';
import {YamlDocumentPick} from './yaml-document-pick';

export namespace YamlShared {
  /**
   * 把 YAML 文本通过文档选择器保存到用户指定位置。
   *
   * 内部先写入 CacheDir 的临时文件，再走 `saveDocuments` 弹出系统保存 UI；
   * 不管保存成功还是取消，都会在 finally 里清理临时文件，避免污染缓存。
   *
   * 命名与 desktop 的 `yaml-shared` 对齐（`xxxWithDialog`）：两端 UI 形态不同
   * （Electron dialog vs 文档选择器），但都是「弹系统 UI + 回调注入」的编排层。
   */
  export async function exportWithDialog(yaml: string, fileName: string): Promise<'saved' | 'cancelled'> {
    return DocumentIo.exportBytes({
      fileName,
      mimeType: 'application/yaml',
      write: tmpPath => RnFileIo.blobFs().writeFile(tmpPath, yaml, 'utf8'),
    });
  }

  /**
   * 通过文档选择器挑选一个 YAML 文件，把内容读出来交给 `consume` 回调。
   *
   * 流程是：pick → 校验文件名 → keepLocalCopy 落到 caches 目录 →
   * 通过 blobUtil 读出 UTF-8 文本。decode/validate/persist 的逻辑
   * 全部由调用方在 `consume` 里完成，方便按各 schema 自己处理。
   *
   * 失败通道（与 desktop 对齐）：consume 的已知失败沿 `Result.err` 接力给
   * 调用方；pick/读文件的平台异常仍走 reject（调用方 catch 收口）。
   * ⚠️ 载荷是 `Error` 而非 `AppError`：core `Errors.normalizeYaml` 的字符串前缀
   * 分支产出普通 `Error`，`normalizeSmartSortImport` 还可能原样透传 `TdbcError`；
   * 强改成 AppError 会改掉 formatError 的 messageKey 分派与文案（见本轮 notes）。
   */
  export async function importWithDialog(consume: (yamlText: string) => Promise<Result<void, Error>>): Promise<Result<void, Error>> {
    const pickOptions: PickLocalFileOptions = {
      mimeTypes: YamlDocumentPick.importPickTypes(),
      fallbackLocalFileName: 'yaml-import.yaml',
      // assertFileName 槽位只认 throw：校验失败从 Result 原样解包成 throw 中止导入。
      assertFileName: name => {
        const check = YamlDocumentPick.assertFileName(name);
        if (!check.ok) {
          // nm-throw: keep — 校验槽位契约只认 throw（zod preprocess 同款例外）：Result 失败位原样解包中止导入
          throw check.error;
        }
      },
      buildCopyError: copyError => new Error(copyError ?? '无法读取 YAML 文件'),
    };
    const yaml = await DocumentIo.pickAndReadText(pickOptions);
    if (yaml == null) {
      return Result.ok(undefined);
    }
    return consume(yaml);
  }
}
