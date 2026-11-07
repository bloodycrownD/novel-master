/**
 * core catalog 解析器：YAML 文本 → 展平的 dotted-key catalog。
 *
 * 这是各宿主「启动加载一次」入口的边界校验器（spec §2.4）：结构、叶子类型、
 * key 格式任何一处不合法都当场 throw（fail fast），绝不静默降级——catalog
 * 写坏最迟在测试/启动当轮失败。yaml.parse 自身的 YAMLParseError（如裸值含
 * 半角 ": "）原样抛出，自带行号定位。
 *
 * @module i18n/catalog
 */

import { parse as parseYaml } from "yaml";
import type { MessageCatalog } from "@/common/i18n.js";
import { CORE_MESSAGE_KEY_PATTERN, ERROR_KEY_DOMAINS, LABEL_KEY_DOMAINS, type CoreMessageKey } from "./keys.js";

// nm-style: keep-public — spec §2.4 指定的宿主加载契约（经 `@novel-master/core/i18n` 子入口暴露，宿主 load YAML 后 parse）；当前实现改走构建期内嵌 CORE_CATALOGS，故生产调用为 0，撤销即违背 spec 的公开子入口契约。
export function parseCoreCatalog(text: string): MessageCatalog<CoreMessageKey> {
  const root: unknown = parseYaml(text);
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    throw new Error("[parseCoreCatalog] 根节点必须是对象映射（error / label 两棵子树）");
  }
  const flat: Record<string, string> = {};
  // 迭代式深度展平：[节点, dotted 前缀] 入栈，替代递归私有函数。
  const pending: Array<[Record<string, unknown>, string]> = [[root as Record<string, unknown>, ""]];
  while (pending.length > 0) {
    const [node, prefix] = pending.pop()!;
    for (const [name, value] of Object.entries(node)) {
      const key = prefix === "" ? name : `${prefix}.${name}`;
      if (typeof value === "string") {
        flat[key] = value;
        continue;
      }
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`[parseCoreCatalog] ${key || "<根>"} 的中间节点必须是对象映射、叶子必须是字符串（形似数字/布尔的裸值必须加引号），实际是 ${value === null ? "null" : Array.isArray(value) ? "数组" : typeof value}`);
      }
      pending.push([value as Record<string, unknown>, key]);
    }
  }
  for (const key of Object.keys(flat)) {
    if (!CORE_MESSAGE_KEY_PATTERN.test(key)) {
      throw new Error(`[parseCoreCatalog] key 不匹配 keyRule（^(error|label)\\.域.名字段，全小写 snake_case，3-5 段）：${key}`);
    }
    const [area, domain] = key.split(".") as [string, string];
    const domains: readonly string[] = area === "error" ? ERROR_KEY_DOMAINS : LABEL_KEY_DOMAINS;
    if (!domains.includes(domain)) {
      throw new Error(`[parseCoreCatalog] key 的域不在词表内（${area}.* 只允许 ${domains.join(" / ")}）：${key}`);
    }
  }
  return flat as MessageCatalog<CoreMessageKey>;
}
