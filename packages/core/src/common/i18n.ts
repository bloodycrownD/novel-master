/**
 * 平台无关的 i18n 运行时：typed descriptor + 字符串直传双通道。
 *
 * 本文件不包含任何业务文案或 key；catalog 由调用方从 JSON 加载。
 * 新代码用 `MessageDescriptor`，旧代码仍可直接传字符串，二者并存。
 *
 * @module common/i18n
 */

/** 可序列化的消息描述（可跨 IPC / RN bridge）。 */
export interface MessageDescriptor<K extends string = string> {
  readonly key: K;
  readonly params?: MessageParams;
}

/** 新 descriptor 与旧字符串并存。 */
export type MessageLike<K extends string = string> = string | MessageDescriptor<K>;

/** 参数值支持嵌套 descriptor；数组按行拼接。 */
type MessageParamValue = string | number | boolean | null | undefined | MessageLike | readonly MessageLike[];

/** 模板参数；复杂列表可用 descriptor 数组。 */
type MessageParams = Readonly<Record<string, MessageParamValue>>;

/** 字符串模板或接收参数的函数模板。 */
type MessageTemplate = string | ((params: MessageParams) => string);

/** 单语言 catalog。 */
export type MessageCatalog<K extends string> = Readonly<Record<K, MessageTemplate>>;

/** locale → catalog。 */
type LocaleCatalogs<K extends string> = Readonly<Record<string, MessageCatalog<K>>>;

type Translator<K extends string> = (message: MessageLike<K>, locale?: string) => string;

export function createTranslator<K extends string>(catalogs: LocaleCatalogs<K>, defaultLocale: string): Translator<K> {
  return function translateMessage(message: MessageLike<K>, locale = defaultLocale): string {
    if (typeof message === "string") {
      return message;
    }
    if (message == null || typeof message !== "object" || Array.isArray(message) || typeof (message as { key?: unknown }).key !== "string") {
      return String(message);
    }
    const exact = catalogs[locale];
    const language = locale.split("-")[0]?.toLowerCase();
    const matched = exact == null && language != null ? Object.keys(catalogs).find((candidate) => candidate.toLowerCase() === language || candidate.toLowerCase().startsWith(`${language}-`)) : undefined;
    const catalog = exact ?? (matched == null ? catalogs[defaultLocale] : catalogs[matched]);
    const template = catalog?.[message.key] ?? catalogs[defaultLocale]?.[message.key];
    if (template == null) {
      return message.key;
    }
    if (typeof template === "function") {
      return template(message.params ?? {});
    }
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = message.params?.[name];
      if (value == null) {
        return match;
      }
      if (Array.isArray(value)) {
        return value.map((item) => translateMessage(item, locale)).join("\n");
      }
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }
      return translateMessage(value as MessageLike<K>, locale);
    });
  };
}
