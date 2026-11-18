/**
 * Markdown front matter 通用纯工具：按 `---` 切出头部与正文、把头部行拆成展示用
 * `key: value` 行。不认识任何业务实体，三端共用。
 *
 * @module common/front-matter
 *
 * 裸导出而非 object namespace：`splitMarkdownFrontMatter` 是
 * `@novel-master/core/workplace` 的既有公开契约名（mobile 预览与 package-exports
 * 快照按此名消费），保留原名才能让 public/workplace 只改转发来源一行。
 */

const FRONT_MATTER_DELIMITER = /^---\s*$/;

/** Result of splitting a Markdown file into optional front matter and body. */
export interface MarkdownFrontMatterSplit {
    /** Lines between opening and closing `---` (excludes delimiters). */
    frontMatterLines: string[] | null;
    /** Markdown body after the closing delimiter, or full file when no front matter. */
    body: string;
    /** `closed` is kept for signature compatibility but is always `true` after the
     * unclosed-as-no-front-matter change — an opening `---` without a closing one
     * is treated as "no front matter". New code should not branch on this field. */
    closed: boolean;
}

/** Simple `key: value` row from YAML-style front matter lines (display only). */
export interface FrontMatterField {
    key: string;
    value: string;
}

/**
 * Splits YAML front matter between `---` lines from the Markdown body.
 *
 * @remarks 未闭合的起始 `---` 按「无 front matter」处理，正文取原文。
 */
export function splitMarkdownFrontMatter(content: string): MarkdownFrontMatterSplit {
    const lines = content.split(/\r?\n/);
    if (lines.length === 0 || !FRONT_MATTER_DELIMITER.test(lines[0] ?? "")) {
        return { frontMatterLines: null, body: content, closed: true };
    }
    const frontMatterLines: string[] = [];
    let closed = false;
    let endIndex = 1;
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (FRONT_MATTER_DELIMITER.test(line)) {
            closed = true;
            endIndex = i + 1;
            break;
        }
        frontMatterLines.push(line);
    }
    if (!closed) {
        return { frontMatterLines: null, body: content, closed: true };
    }
    return { frontMatterLines, body: lines.slice(endIndex).join("\n"), closed: true };
}

/**
 * Splits front matter lines into `key: value` display rows.
 *
 * @remarks 空行与 `#` 注释行跳过；首个 `:` 前为非空 key 才拆成 key/value，
 * 否则整行落在 value（key 为空串）。不解析引号 / 数组 / 嵌套结构。
 */
export function parseFrontMatterFields(lines: readonly string[]): FrontMatterField[] {
    const fields: FrontMatterField[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }
        const colon = trimmed.indexOf(":");
        fields.push(colon > 0 ? { key: trimmed.slice(0, colon).trim(), value: trimmed.slice(colon + 1).trim() } : { key: "", value: trimmed });
    }
    return fields;
}
