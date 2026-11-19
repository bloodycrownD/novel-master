/**
 * 跨端通用工具命名空间 barrel。
 *
 * 每个类别导出为一个 object namespace（`Coerce.xxx()` / `Guards.xxx()` 形态），
 * 通过 `@novel-master/core/common` 子路径暴露给三端（desktop main、desktop
 * renderer、mobile）共享。文件按类别组织（encoding / errors / json / release…），
 * 新工具优先并进已有类别文件。
 *
 * 例外：断言原语（assert / AssertionError）与 i18n 工厂 + 类型族
 * （createTranslator）按 skill 5.3 豁免保持裸导出。
 */
export {Coerce} from "./coerce.js";
export {Guards} from "./guards.js";
export {Concurrency} from "./concurrency.js";
export {Json} from "./json.js";
export {Text} from "./text.js";
export type {DecodeHtmlEntitiesOptions} from "./text.js";
export {Number, STORAGE_BYTES} from "./number.js";
export {DateTime} from "./datetime.js";
export {Path} from "./path.js";
export {Encoding} from "./encoding.js";
export {Xml} from "./xml.js";
export {Hash} from "./hash.js";
export {Errors} from "./errors.js";
export {Kkv} from "./kkv.js";
export {Random} from "./random.js";
export {Release} from "./release.js";
export {
    UpdateCheck,
    type FetchFn,
    type UpdateCheckData,
} from "./update-check.js";
export {
    TokenFormat,
    // token-source-label：badge 参数契约随 namespace 一起转出
    // （infra/tokenizer 与 public/provider 经 common/index 再导出）。
    type TokenSourceBadge,
} from "./token-format.js";

// Markdown front matter：namespace 形态（FrontMatter.splitMarkdown / parseFields）。
export {FrontMatter} from "./front-matter.js";

export {assert, AssertionError} from "./assert.js";
export {
    createTranslator,
    type MessageCatalog,
    type MessageDescriptor,
    type MessageLike,
    type MessageParams,
} from "./i18n.js";
