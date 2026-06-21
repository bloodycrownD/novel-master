/**
 * S10 (spec §测试策略): repository / sqlite sources must not use MyBatis `${…}`
 * string interpolation in SQL templates. Only `#{…}` bound placeholders are allowed.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const SRC_ROOT = join(import.meta.dirname, "../../../src");

/** Escaped MyBatis `${path}` embedded in a JS template literal. */
const ESCAPED_MYBATIS_DOLLAR = /\\\$\{/;

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkTsFiles(full, out);
      continue;
    }
    if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function collectTargetFiles(): string[] {
  const domainRoot = join(SRC_ROOT, "domain");
  const repoFiles = walkTsFiles(domainRoot).filter((f) =>
    f.replace(/\\/g, "/").includes("/repositories/"),
  );
  const sqliteFiles = walkTsFiles(SRC_ROOT).filter((f) => {
    const base = f.replace(/\\/g, "/").split("/").pop() ?? "";
    return base.startsWith("sqlite-") && base.endsWith(".ts");
  });
  return [...new Set([...repoFiles, ...sqliteFiles])];
}

function extractTemplateLiterals(src: string): string[] {
  const literals: string[] = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] !== "`") {
      i++;
      continue;
    }
    i++;
    const start = i;
    while (i < src.length) {
      if (src[i] === "\\") {
        i += 2;
        continue;
      }
      if (src[i] === "`") {
        literals.push(src.slice(start, i));
        i++;
        break;
      }
      i++;
    }
  }
  return literals;
}

/**
 * Strips JS `${expr}` interpolations, preserving escaped `\$` sequences.
 */
function stripJsInterpolations(body: string): string {
  let result = "";
  let i = 0;
  while (i < body.length) {
    if (body[i] === "\\") {
      result += body.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (body.startsWith("${", i)) {
      let depth = 1;
      i += 2;
      while (i < body.length && depth > 0) {
        const ch = body[i];
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === "`") {
          i++;
          while (i < body.length) {
            if (body[i] === "\\") {
              i += 2;
              continue;
            }
            if (body[i] === "`") {
              i++;
              break;
            }
            if (body.startsWith("${", i)) {
              depth++;
              i += 2;
              continue;
            }
            i++;
          }
          continue;
        }
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        i++;
      }
      continue;
    }
    result += body[i];
    i++;
  }
  return result;
}

function findViolations(src: string, relPath: string): string[] {
  const violations: string[] = [];

  for (const literal of extractTemplateLiterals(src)) {
    if (!/#{/.test(literal)) {
      continue;
    }
    if (ESCAPED_MYBATIS_DOLLAR.test(literal)) {
      violations.push(`${relPath}: MyBatis \\$\\{…} in SQL template literal`);
    }
    const staticSql = stripJsInterpolations(literal);
    if (/\$\{/.test(staticSql)) {
      violations.push(
        `${relPath}: literal \${…} in SQL template after JS interpolation stripped`,
      );
    }
  }

  const quotedRe = /(['"])(?:(?!\1)[^\\]|\\.)*\1/g;
  let match: RegExpExecArray | null;
  while ((match = quotedRe.exec(src)) !== null) {
    const quoted = match[0];
    if (/#{/.test(quoted) && /\$\{/.test(quoted)) {
      violations.push(`${relPath}: quoted SQL string contains both #{} and \${}`);
    }
  }

  return violations;
}

describe("repository SQL template guard", () => {
  it("forbids MyBatis ${…} string interpolation (only #{…} bindings)", () => {
    const violations: string[] = [];
    for (const file of collectTargetFiles()) {
      const relPath = relative(SRC_ROOT, file).replace(/\\/g, "/");
      violations.push(...findViolations(readFileSync(file, "utf8"), relPath));
    }
    assert.equal(
      violations.length,
      0,
      violations.length > 0 ? violations.join("\n") : undefined,
    );
  });
});
