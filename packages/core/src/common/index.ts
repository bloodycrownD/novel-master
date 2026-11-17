/**
 * 跨端通用工具命名空间 barrel。
 *
 * 每个类别导出为一个 object namespace（`Coerce.xxx()` / `Guards.xxx()` 形态），
 * 通过 `@novel-master/core/common` 子路径暴露给三端（desktop main、desktop
 * renderer、mobile）共享。文件按类别组织（encoding / errors / json / release…），
 * 新工具优先并进已有类别文件。
 *
 * 例外：断言原语（assert / assertNever / AssertionError）与 i18n 工厂 + 类型族
 * 保持裸导出，不包命名空间。
 */
export {Coerce} from "./coerce.js";
export {Guards} from "./guards.js";
export {Json} from "./json.js";
export {Text} from "./text.js";
export type {DecodeHtmlEntitiesOptions} from "./text.js";
export {Number, STORAGE_BYTES} from "./number.js";
export type {BytesFormat, BytesUnit} from "./number.js";
export {DateTime} from "./datetime.js";
export {Encoding} from "./encoding.js";
export {Xml} from "./xml.js";
export {Hash} from "./hash.js";
export {Errors} from "./errors.js";
export {Kkv} from "./kkv.js";
export {Release} from "./release.js";
export {
    UpdateCheck,
    type FetchFn,
    type LatestRelease,
    type UpdateCheckData,
    type UpdateCheckStatus,
} from "./update-check.js";
export {
    TokenFormat,
    // token-source-label：badge 参数契约随 namespace 一起转出
    // （infra/tokenizer 与 public/provider 经 common/index 再导出）。
    type TokenSourceBadge,
} from "./token-format.js";

export {assert, assertNever, AssertionError} from "./assert.js";
export {
    createTranslator,
    type MessageCatalog,
    type MessageDescriptor,
    type MessageLike,
    type MessageParams,
} from "./i18n.js";
