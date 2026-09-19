// v1.5.17 批次 B2：case-sort-rule-manager——「设置 → 智能排序」规则管理页
// 断言：
//   SR-LIST——内置七条规则可见（序章/开篇、终章/收尾、番外/外传、中文卷章复合、中文序号章节、
//             英文章节、数字序号开头），带「内置」标记，四操作按钮（导入/导出 YAML、恢复默认、新建规则）在位
//   SR-TOGGLE——禁用「番外/外传」后工作区智能排序行为变化（番外探.md 失去序号沉入自然序），
//               重新启用后行为恢复
//   SR-BUILTIN-NODELETE——内置规则行菜单无「删除」项（仅可禁用不可删除）
//   SR-RESET——「恢复默认」重灌内置规则（被禁用的恢复启用）、不影响自定义规则（DB 预置的自定义行保留）
//   SR-DELETE——自定义规则可删除，删除后列表不再出现
//   SR-EDIT-TEST / SR-EDIT-FIXED / SR-CREATE——编辑页正则测试（高亮+元组+计数）、固定档哨兵元组、新建规则
//   🔧 SR-YAML——导入/导出 YAML 走系统文件对话框，自动化不可控，跳过（按钮存在性并入 SR-LIST）
//
// ⚠ 产品缺陷（v1.5.17 即存在，worktree 与 tag v1.5.17 同码）：SettingsViews.tsx 的
//   SmartSortRuleEditorView 使用 <SettingsSection>（L2176/L2246）但 import 列表未引入——
//   打开「编辑规则」或「新建规则」即抛 ReferenceError: SettingsSection is not defined，
//   React 树整棵崩溃、界面白屏。因此本 case 把编辑页场景放在最后（crash 探针），
//   前面的场景不受影响；SR-EDIT-TEST/SR-EDIT-FIXED/SR-CREATE 记 FAIL（产品缺陷）。
//   自定义规则改由 DB 预置（python3 sqlite3 写 smart_sort_rule 表，测试数据准备，不改产品码）。
import { waitForAppReady, launchApp, shutdown, shot, goToProjects } from "./lib.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const errors = [];
const results = [];
const record = (id, pass, detail = "") => {
  results.push({ id, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}${detail ? " " + detail : ""}`);
};
const step = async (id, fn) => {
  try { await fn(); } catch (e) { record(id, false, `EXCEPTION ${String(e).slice(0, 200)}`); }
};

const RUN = String(Date.now() % 10000);
const SEEDED = `预置自定义${RUN}`; // DB 预置自定义规则名（SR-RESET/SR-DELETE 消费）
const BUILTIN_NAMES = ["序章/开篇", "终章/收尾", "番外/外传", "中文卷章复合", "中文序号章节", "英文章节", "数字序号开头"];

// ---------- 预置自定义规则（app 启动前写库；DB 由序列上游 bootstrap 建好）----------
const DB_PATH = path.join(path.dirname(new URL(import.meta.url).pathname), "data", "novel.db");
let seededOk = false;
if (fs.existsSync(DB_PATH)) {
  try {
    const out = execFileSync("python3", ["-c", [
      "import sqlite3, sys, time",
      "db, rid, name = sys.argv[1], sys.argv[2], sys.argv[3]",
      "now = int(time.time() * 1000)",
      "con = sqlite3.connect(db)",
      "con.execute(",
      "  'INSERT OR REPLACE INTO smart_sort_rule '",
      "  '(rule_id,name,pattern,flags,capture_kind,description,enabled,sort_order,created_at_ms,updated_at_ms) '",
      "  'VALUES (?,?,?,?,?,?,1,100,?,?)',",
      "  (rid, name, r'第(\\d+)章', '', 'smart', 'e2e 预置自定义规则', now, now))",
      "con.commit()",
      "print('SEEDED', rid)",
    ].join("\n"), DB_PATH, `e2e-custom-${RUN}`, SEEDED], { encoding: "utf8" });
    console.log(out.trim());
    seededOk = true;
  } catch (e) {
    console.log("SEED_FAILED", String(e).slice(0, 200));
  }
} else {
  console.log("SEED_SKIP", "data/novel.db 不存在（需先跑 bootstrap 建库）");
}

const { app, page, vite } = await launchApp({ errors });
const sleep = (ms) => page.waitForTimeout(ms);

// ---------- toast ----------
const toastText = () => page.evaluate(() =>
  document.querySelector(".shell-toast.is-visible .shell-toast__message")?.textContent
  ?? document.querySelector(".shell-toast.is-visible")?.textContent ?? null);
async function waitToast(ms = 2500) {
  const t0 = Date.now();
  let t = null;
  while (Date.now() - t0 < ms) {
    t = await toastText();
    if (t) return t;
    await sleep(200);
  }
  return t;
}

// ---------- 设置页 ----------
// 幂等归位：设置未开则开；不在规则列表页则点导航（各 step 不假设设置开闭状态）
async function ensureRulesPage() {
  const visible = await page.locator("#settings-page").isVisible().catch(() => false);
  if (!visible) {
    await page.locator('button[aria-label="打开设置"]').first().click();
    await page.locator("#settings-page").waitFor({ state: "visible", timeout: 8000 });
  }
  const rowsVisible = await page.locator("#settings-page .settings-list-item-row").first().isVisible().catch(() => false);
  if (!rowsVisible) {
    await page.locator('[data-settings-nav="smartSortRules"]').first().click();
    await page.locator("#settings-page .settings-list-item-row").first().waitFor({ state: "visible", timeout: 8000 });
  }
  await sleep(400);
}
const openSettingsToRules = ensureRulesPage;
async function closeSettings() {
  const visible = await page.locator("#settings-page").isVisible().catch(() => false);
  if (!visible) return;
  await page.locator('button[aria-label="关闭设置"]').first().click();
  await sleep(700);
}

const ruleRow = (name) => page.locator("#settings-page .settings-list-item-row").filter({
  has: page.locator(".settings-list-item__meta-row", { hasText: name }),
}).first();
async function ruleNames() {
  return page.evaluate(() =>
    [...document.querySelectorAll("#settings-page .settings-list-item__meta-row")]
      .map((el) => el.childNodes[0]?.textContent?.trim() ?? el.textContent?.trim() ?? ""));
}
async function rowTags(name) {
  const row = ruleRow(name);
  if (!(await row.count())) return null;
  return row.locator(".settings-tag").allTextContents();
}
// Switch 原生 checkbox 被样式隐藏（滑块 UI），check()/uncheck() 会因 input 不可见超时——
// 改为点 label（.settings-switch）触发切换，状态读 input.isChecked()
async function toggleRule(name, enable) {
  const row = ruleRow(name);
  const input = row.locator('.smart-sort-rule__switch input[type="checkbox"]');
  const checked = await input.isChecked();
  if (checked !== enable) {
    await row.locator(".smart-sort-rule__switch .settings-switch").first().click();
    await sleep(900);
  }
}
async function rowMenu(name, action) {
  const row = ruleRow(name);
  await row.locator('button[aria-label="更多"]').first().click();
  const menu = page.locator(".context-menu");
  await menu.waitFor({ state: "visible", timeout: 5000 });
  await sleep(300);
  const items = await menu.locator("button").allTextContents();
  if (action) {
    // 菜单为 fixed 定位，靠下的行会溢出小视口导致真实点击不可达——DOM click
    // 直接触发同一 React onClick（菜单项无 hover/坐标依赖逻辑）
    await menu.locator("button").filter({ hasText: action }).first().evaluate((el) => el.click());
    await sleep(500);
  }
  return items;
}
async function closeRowMenu() {
  await page.locator(".settings-main__title").first().click();
  await sleep(400);
}
async function confirmModal() {
  await page.locator(".confirm-modal button").filter({ hasText: "确定" }).first().click();
  await sleep(900);
}

// ---------- 工作区探测（SR-TOGGLE 行为验证）----------
const PANEL = '.workspace-tree-panel[data-workspace-panel="session"]';
async function childrenOf(parentLabel) {
  return page.evaluate(({ p, parent }) => {
    const nodes = [...document.querySelectorAll(p + " .tree-node")];
    const idx = nodes.findIndex((n) => n.querySelector(".tree-node__label")?.textContent?.trim() === parent);
    if (idx < 0) return null;
    const indentOf = (el) => parseInt(el.style.paddingLeft || "0", 10) || 0;
    const base = indentOf(nodes[idx]);
    const out = [];
    for (let j = idx + 1; j < nodes.length; j++) {
      const ind = indentOf(nodes[j]);
      if (ind <= base) break;
      if (ind <= base + 14) out.push(nodes[j].querySelector(".tree-node__label")?.textContent?.trim() ?? "");
    }
    return out;
  }, { p: PANEL, parent: parentLabel });
}
async function rightClickNode(name) {
  const node = page.locator(PANEL + " .tree-node").filter({
    has: page.locator(".tree-node__label", { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }),
  }).first();
  // 滚到视口中心：贴底节点的右键菜单（fixed 定位）会溢出视口
  await node.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sleep(200);
  const box = await node.boundingBox();
  if (!box) throw new Error("树节点不可见: " + name);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  const menu = page.locator("#workspace-context-menu");
  await menu.waitFor({ state: "visible", timeout: 5000 });
  return menu;
}
// 菜单动作统一 DOM click（fixed 菜单溢出小视口时真实点击不可达；处理器是纯 onClick）
const menuAction = (action) =>
  page.locator(`[data-workspace-action="${action}"]`).first().evaluate((el) => el.click());
async function goSessionPanel() {
  await goToProjects(page);
  await page.locator("li:visible").filter({ hasText: "回归项目A" }).first().click();
  await sleep(1100);
}

try {
  await waitForAppReady(page);
  await openSettingsToRules();

  // ===== 归一化（防上轮残留，不计分）：删光历史自定义规则（保留本轮预置行）+ 恢复默认 =====
  for (let i = 0; i < 5; i++) {
    const customs = await page.evaluate((keep) =>
      [...document.querySelectorAll("#settings-page .settings-list-item-row")]
        .filter((row) => !row.textContent?.includes("内置"))
        .map((row) => row.querySelector(".settings-list-item__meta-row")?.childNodes[0]?.textContent?.trim() ?? "")
        .filter((n) => n && n !== keep), SEEDED);
    if (customs.length === 0) break;
    console.log("CLEANUP_CUSTOM", JSON.stringify(customs));
    await rowMenu(customs[0], "删除");
    await confirmModal();
    await sleep(600);
  }
  await page.locator("#settings-page button").filter({ hasText: "恢复默认" }).first().click();
  await sleep(400);
  await confirmModal();
  await sleep(900);

  // ===== SR-LIST =====
  await step("SR-LIST", async () => {
    await sleep(500);
    const names = await ruleNames();
    console.log("RULE_NAMES", JSON.stringify(names));
    await shot(page, "850", "rules-list");
    const allBuiltin = BUILTIN_NAMES.every((n) => names.some((x) => x === n));
    const tags = await rowTags("序章/开篇");
    const pageText = await page.locator("#settings-page").textContent();
    const btnOk = ["导入 YAML", "导出 YAML", "恢复默认", "新建规则"].every((b) => pageText?.includes(b));
    const seededVisible = !seededOk || names.includes(SEEDED); // 预置失败时不算分
    record("SR-LIST", allBuiltin && (tags?.includes("内置") ?? false) && btnOk && seededVisible,
      `内置7条=${allBuiltin}(${names.length}行) 内置标记=${JSON.stringify(tags)} 按钮=${btnOk} 预置行可见=${seededVisible}`);
  });

  // ===== SR-TOGGLE：禁用「番外/外传」→ 工作区行为变化 → 启用恢复 =====
  await step("SR-TOGGLE", async () => {
    await toggleRule("番外/外传", false);
    const tagsOff = await rowTags("番外/外传");
    await shot(page, "851", "extra-rule-disabled");
    const disabledTag = tagsOff?.includes("已禁用") ?? false;

    // 工作区探测：建目录 + 两个文件（番外探 / 无序探），规则设智能排序
    await closeSettings();
    await goSessionPanel();
    const PROBE = `探测${RUN}`;
    await rightClickNode("/");
    await sleep(450);
    await menuAction("create-folder");
    await sleep(700);
    await page.locator(".text-prompt-modal input").first().fill(PROBE);
    await page.locator(".text-prompt-modal button").filter({ hasText: /^确定$|^创建$/ }).first().click();
    await sleep(1100);
    for (const f of ["番外探.md", "无序探.md"]) {
      await rightClickNode(PROBE);
      await sleep(450);
      await menuAction("create-file");
      await sleep(700);
      await page.locator(".text-prompt-modal input").first().fill(f);
      await page.locator(".text-prompt-modal button").filter({ hasText: /^确定$|^创建$/ }).first().click();
      await sleep(1000);
    }
    await rightClickNode(PROBE);
    await sleep(450);
    await menuAction("rule-config");
    for (let i = 0; i < 10; i++) {
      if (await page.evaluate(() => !document.querySelector(".dir-rule-modal__loading"))) break;
      await sleep(400);
    }
    await sleep(400);
    await page.locator(".dir-rule-modal .config-dep-chip").filter({ hasText: "智能排序" }).first().click();
    await sleep(400);
    await page.locator(".dir-rule-modal .text-prompt-modal__actions button").filter({ hasText: "保存" }).first().click();
    await sleep(1400);
    const orderDisabled = await childrenOf(PROBE);
    console.log("PROBE_ORDER_DISABLED", JSON.stringify(orderDisabled));
    await shot(page, "852", "probe-order-rule-disabled");

    // 重新启用 → 行为恢复
    await openSettingsToRules();
    await toggleRule("番外/外传", true);
    const tagsOn = await rowTags("番外/外传");
    const enabledBack = !(tagsOn?.includes("已禁用") ?? true);
    await closeSettings();
    await goSessionPanel();
    const orderEnabled = await childrenOf(PROBE);
    console.log("PROBE_ORDER_ENABLED", JSON.stringify(orderEnabled));
    await shot(page, "853", "probe-order-rule-enabled");

    const offOk = JSON.stringify(orderDisabled) === JSON.stringify(["无序探.md", "番外探.md"]);
    const onOk = JSON.stringify(orderEnabled) === JSON.stringify(["番外探.md", "无序探.md"]);
    record("SR-TOGGLE", disabledTag && enabledBack && offOk && onOk,
      `禁用后序=${JSON.stringify(orderDisabled)}(预期 无序探先) 启用后序=${JSON.stringify(orderEnabled)}(预期 番外探先) 已禁用标记=${disabledTag} 恢复启用=${enabledBack}`);
  });

  // ===== SR-BUILTIN-NODELETE：内置规则行菜单无「删除」 =====
  await step("SR-BUILTIN-NODELETE", async () => {
    await openSettingsToRules();
    const items = await rowMenu("序章/开篇", null);
    await shot(page, "854", "builtin-row-menu");
    console.log("BUILTIN_MENU_ITEMS", JSON.stringify(items));
    const noDelete = !items.some((t) => t.trim() === "删除");
    await closeRowMenu();
    record("SR-BUILTIN-NODELETE", noDelete, `菜单项=${JSON.stringify(items)}`);
  });

  // ===== SR-RESET：禁用一条内置 → 恢复默认 → 内置恢复启用、预置自定义保留 =====
  await step("SR-RESET", async () => {
    await toggleRule("序章/开篇", false);
    const offTags = await rowTags("序章/开篇");
    const disabledBefore = offTags?.includes("已禁用") ?? false;

    await page.locator("#settings-page button").filter({ hasText: "恢复默认" }).first().click();
    await sleep(500);
    const msg = await page.locator(".confirm-modal").textContent();
    const msgOk = msg?.includes("自定义规则不受影响") ?? false;
    await confirmModal();
    const toast = await waitToast(2500);
    await sleep(1200);

    const names = await ruleNames();
    const customKept = !seededOk || names.includes(SEEDED);
    const tagsAfter = await rowTags("序章/开篇");
    const reEnabled = !(tagsAfter?.includes("已禁用") ?? true);
    const allBuiltin = BUILTIN_NAMES.every((n) => names.includes(n));
    await shot(page, "855", "after-reset-defaults");
    record("SR-RESET", disabledBefore && msgOk && customKept && reEnabled && allBuiltin && toast === "已恢复默认规则",
      `重置前已禁用=${disabledBefore} 确认文案=${msgOk} 自定义保留=${customKept} 内置恢复启用=${reEnabled} 内置7条=${allBuiltin} toast=${JSON.stringify(toast)}`);
  });

  // ===== SR-DELETE：预置自定义规则可删除 =====
  await step("SR-DELETE", async () => {
    if (!seededOk) return record("SR-DELETE", false, "预置自定义规则未写入 DB，场景不可达");
    await rowMenu(SEEDED, "删除");
    await confirmModal();
    const toast = await waitToast(2500);
    await sleep(800);
    const names = await ruleNames();
    const gone = !names.includes(SEEDED);
    const builtinKept = BUILTIN_NAMES.every((n) => names.includes(n));
    await shot(page, "856", "custom-rule-deleted");
    record("SR-DELETE", gone && builtinKept && toast === "已删除规则",
      `已删除=${gone} 内置仍在=${builtinKept} toast=${JSON.stringify(toast)}`);
  });

  // ===== 汇总（非编辑页部分）=====
  console.log("SUMMARY_NON_EDITOR", JSON.stringify(results));

  // ===== 编辑页场景（放最后：当前版本打开编辑页即触发产品缺陷崩溃）=====
  await step("SR-EDIT-TEST", async () => {
    await ruleRow("中文序号章节").locator(".settings-list-item").first().click();
    await sleep(2500); // 留渲染/崩溃时间
    const state = await page.evaluate(() => ({
      editorFields: !!document.querySelector("#settings-page .settings-field"),
      settingsAlive: !!document.querySelector("#settings-page"),
      appAlive: !!document.querySelector("#app #chat-rail, #app"),
    }));
    const crashErr = errors.find((e) => e.includes("SettingsSection")) ?? null;
    console.log("EDITOR_STATE", JSON.stringify(state), "crashErr=", JSON.stringify(crashErr));
    await shot(page, "857", "editor-crash");
    const editorOk = state.editorFields;
    record("SR-EDIT-TEST", editorOk,
      editorOk ? "编辑页渲染正常" : `产品缺陷：打开编辑页抛 ReferenceError: SettingsSection is not defined，React 树崩溃白屏（${JSON.stringify(crashErr)}）`);
  });
  // SR-CREATE / SR-EDIT-FIXED：同一缺陷阻断（新建规则同样进入 SmartSortRuleEditorView；崩溃后应用树已死，重试无意义）
  record("SR-CREATE", false, "产品缺陷阻断：新建规则入口与编辑页同一组件（SmartSortRuleEditorView），打开即崩溃，无法经 UI 创建规则");
  record("SR-EDIT-FIXED", false, "产品缺陷阻断：固定档元组测试依赖编辑页，同上");

  // 🔧 SR-YAML：导入/导出走系统文件对话框，e2e 不可控——跳过（按钮存在性已并入 SR-LIST）
  console.log("SKIP SR-YAML 导入/导出 YAML 走原生文件对话框，自动化不可控，标 🔧 跳过");

  // ===== 汇总 =====
  console.log("SUMMARY", JSON.stringify(results));
  const allPass = results.every((r) => r.pass);
  console.log("ALL_PASS", allPass);
  if (!allPass) process.exitCode = 1;

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 500));
  process.exitCode = 1;
  try { await page.screenshot({ path: "/tmp/sr-err.png" }); } catch {}
}
await shutdown(app, vite);
console.log("SR_MGR_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 5)));
