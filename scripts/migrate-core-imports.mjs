/**
 * 将 `@novel-master/core` 主入口导入按符号拆分到领域子入口。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const SUB_ENTRIES = [
  "agent",
  "chat",
  "compaction",
  "events",
  "prompt",
  "provider",
  "regex",
  "session-fs",
  "vfs",
  "worktree",
];

/** @type {Map<string, string>} */
const symbolToSub = new Map();

function collectExportsFromSource(source, subPath) {
  const patterns = [
    /export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["'][^"']+["']/g,
    /export\s+(?:type\s+)?\{([^}]+)\}\s*;/g,
    /export\s+(?:type\s+)?(?:const|function|class)\s+(\w+)/g,
    /export\s+type\s+(\w+)/g,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(source)) !== null) {
      if (m[1].includes(",")) {
        for (const part of m[1].split(",")) {
          registerSymbol(part.trim(), subPath);
        }
      } else {
        registerSymbol(m[1].trim(), subPath);
      }
    }
  }
}

function registerSymbol(raw, subPath) {
  if (!raw) return;
  const aliasMatch = raw.match(/^(?:type\s+)?(\w+)(?:\s+as\s+(\w+))?$/);
  if (!aliasMatch) return;
  symbolToSub.set(aliasMatch[2] ?? aliasMatch[1], subPath);
}

collectExportsFromSource(
  readFileSync(join(ROOT, "packages/core/src/index.ts"), "utf8"),
  ".",
);
for (const sub of SUB_ENTRIES) {
  collectExportsFromSource(
    readFileSync(join(ROOT, `packages/core/src/public/${sub}.ts`), "utf8"),
    sub,
  );
}

const TARGET_DIRS = [
  "apps/cli",
  "apps/desktop",
  "apps/mobile",
  "packages/tokenizer-driver-node",
  "packages/core/test",
];

/** @type {string[]} */
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(full);
    } else if (/\.(ts|tsx)$/.test(name)) {
      files.push(full);
    }
  }
}
for (const d of TARGET_DIRS) {
  walk(join(ROOT, d));
}

/**
 * @param {string} content
 * @returns {{ start: number; end: number; typeOnly: boolean; specifiers: string; indent: string }[]}
 */
function findCoreNamedImports(content) {
  /** @type {{ start: number; end: number; typeOnly: boolean; specifiers: string; indent: string }[]} */
  const hits = [];
  const re = /^(\s*)import\s+(type\s+)?\{/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    const start = m.index;
    const indent = m[1] ?? "";
    const typeOnly = Boolean(m[2]);
    const braceStart = content.indexOf("{", start);
    let depth = 0;
    let i = braceStart;
    for (; i < content.length; i++) {
      const ch = content[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const afterBrace = content.slice(i + 1).match(/^\s*from\s+["']@novel-master\/core["'];?/);
    if (!afterBrace) continue;
    const end = i + 1 + afterBrace[0].length;
    const specifiers = content.slice(braceStart + 1, i);
    hits.push({ start, end, typeOnly, specifiers, indent });
  }
  return hits;
}

function formatImport(indent, items, pathKey) {
  const parts = items.map(({ name, alias, typeOnly }) => {
    const prefix = typeOnly ? "type " : "";
    return alias && alias !== name
      ? `${prefix}${name} as ${alias}`
      : `${prefix}${name}`;
  });
  return `${indent}import { ${parts.join(", ")} } from "${pathKey}";`;
}

function parseSpecifier(raw, defaultTypeOnly) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let localTypeOnly = defaultTypeOnly;
  let name = trimmed;
  let alias;

  const typePrefix = trimmed.match(/^type\s+(.+)$/);
  if (typePrefix) {
    localTypeOnly = true;
    name = typePrefix[1].trim();
  }

  const asMatch = name.match(/^(\w+)\s+as\s+(\w+)$/);
  if (asMatch) {
    name = asMatch[1];
    alias = asMatch[2];
  }

  const sub = symbolToSub.get(name);
  if (!sub) {
    return { error: name };
  }

  const pathKey = sub === "." ? "@novel-master/core" : `@novel-master/core/${sub}`;
  return { name, alias, typeOnly: localTypeOnly, pathKey };
}

/** @type {string[]} */
const migrated = [];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  if (!content.includes("@novel-master/core")) continue;

  const hits = findCoreNamedImports(content);
  if (hits.length === 0) continue;

  let next = content;
  let offset = 0;
  let changed = false;

  for (const hit of hits) {
    const start = hit.start + offset;
    const end = hit.end + offset;
    const full = next.slice(start, end);

    /** @type {Map<string, { name: string; alias?: string; typeOnly: boolean }[]>} */
    const byPath = new Map();
    const unknown = [];

    for (const part of hit.specifiers.split(",")) {
      const parsed = parseSpecifier(part, hit.typeOnly);
      if (!parsed) continue;
      if ("error" in parsed) {
        unknown.push(parsed.error);
        continue;
      }
      const { pathKey, name, alias, typeOnly } = parsed;
      if (!byPath.has(pathKey)) byPath.set(pathKey, []);
      byPath.get(pathKey).push({ name, alias, typeOnly });
    }

    if (unknown.length > 0) {
      console.warn(
        `[warn] ${relative(ROOT, file)}: unknown symbols ${unknown.join(", ")} in:\n${full}`,
      );
      continue;
    }

    if (byPath.size === 1) {
      const [pathKey] = [...byPath.keys()];
      if (pathKey === "@novel-master/core") continue;
    }

    const replacement = [...byPath.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pathKey, items]) => formatImport(hit.indent, items, pathKey))
      .join("\n");

    next = next.slice(0, start) + replacement + next.slice(end);
    offset += replacement.length - (end - start);
    changed = true;
  }

  if (changed) {
    writeFileSync(file, next, "utf8");
    migrated.push(relative(ROOT, file));
  }
}

console.log(`Migrated ${migrated.length} files`);
