/**
 * core 测试侧的默认 translator（spec G0.8）：node fs 读 catalog YAML +
 * Catalog.parseCore，不依赖任何 bundler 特性。catalogs 按 localeRule 的
 * 对象键序约束构造——zh-CN 必须在前，同语言前缀回退依赖键序。
 * 模块加载即建单例；测试文件按需 import `tCore`。
 *
 * @module test/helpers/core-i18n
 */
import {  readFileSync, readdirSync  } from "node:fs";
import * as YAML from "yaml";
import {  createTranslator  } from "../../src/common/i18n.js";
import {  Catalog  } from "../../src/i18n/catalog.js";
import type { CoreMessageKey } from "../../src/i18n/keys.js";

const CATALOG_DIR = new URL("../../resources/i18n/", import.meta.url);

/** i18n 按域拆分后 core 组 = error/label/ui 三文件；取 locale 段合并回单棵 mapping 喂 parseCore。 */
function loadCatalog(locale: string) {
    const merged: Record<string, unknown> = {};
    // 单文件域 = 文件名承载域层；ui/ 子目录域 = 域层+locale 目录双承载、分片按文件名序合并（与 gen-i18n-catalog 同款）。
    for (const domain of ["error", "label", "ui"]) {
        let segment: Record<string, unknown>;
        if (domain === "ui") {
            const dir = new URL(`ui/${locale}/`, CATALOG_DIR);
            segment = {};
            for (const f of readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
                Object.assign(segment, YAML.parse(readFileSync(new URL(f, dir), "utf8")) as Record<string, unknown>);
            }
        } else {
            const doc = YAML.parse(readFileSync(new URL(`${domain}.yaml`, CATALOG_DIR), "utf8")) as Record<string, Record<string, unknown>>;
            segment = doc[locale];
        }
        if (segment == null || typeof segment !== "object") throw new Error(`${domain} 分片缺 ${locale} 段`);
        // locale 段下直接是域内容（域层由文件名承载），整体即该域子树。
        merged[domain] = segment;
    }
    return Catalog.parseCore(YAML.stringify(merged));
}

/** zh-CN 在前；en-US 为部分骨架，缺 key 时由回退链落到 zh-CN。 */
export const tCore = createTranslator<CoreMessageKey>({"zh-CN": loadCatalog("zh-CN"), "en-US": loadCatalog("en-US")}, "zh-CN");
