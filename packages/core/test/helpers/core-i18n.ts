/**
 * core 测试侧的默认 translator（spec G0.8）：node fs 读 catalog YAML +
 * parseCoreCatalog，不依赖任何 bundler 特性。catalogs 按 localeRule 的
 * 对象键序约束构造——zh-CN 必须在前，同语言前缀回退依赖键序。
 * 模块加载即建单例；测试文件按需 import `tCore`。
 *
 * @module test/helpers/core-i18n
 */
import { readFileSync } from "node:fs";
import { createTranslator } from "../../src/common/i18n.js";
import { parseCoreCatalog } from "../../src/i18n/catalog.js";
import type { CoreMessageKey } from "../../src/i18n/keys.js";

const CATALOG_DIR = new URL("../../src/i18n/catalog/", import.meta.url);

function loadCatalog(locale: string) {
  return parseCoreCatalog(readFileSync(new URL(`${locale}.yaml`, CATALOG_DIR), "utf8"));
}

/** zh-CN 在前；en-US 为部分骨架，缺 key 时由回退链落到 zh-CN。 */
export const tCore = createTranslator<CoreMessageKey>({"zh-CN": loadCatalog("zh-CN"), "en-US": loadCatalog("en-US")}, "zh-CN");
