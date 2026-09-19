// v1.5.17 批次 B2：case-smart-sort-basic——目录规则「智能排序」的文件树 DOM 顺序
// 断言：
//   SS-DEFAULT——默认（文件名称）排序下 第10章.md 排在第2章.md 前面（字典序基线，
//               证明后面的差异确实来自智能排序而非建序）
//   SS-SMART——切「智能排序」后子级 DOM 顺序 = [序章, 第1章, 第一章, 第2章, 第10章, 番外, 大纲]：
//               中文数字/阿拉伯数字按数值排序、序章置顶、番外沉到有序号之后
//   SS-TIE——第1章.md 与 第一章.md 序号同为 1，按原文件名决胜（第1章 在前）
//   SS-SINK——未命中序号的大纲.md 沉底（排在固定最大档 番外.md 之后）
//   SS-PERSIST——规则保存后重开弹窗，active chip 仍为「智能排序」
// 预期依据：CHANGELOG v1.5.17 + core compareSmartBasenames 全序五条
//   （有序号 vs 无序号：有序号在前；fixed_max=[∞] 也是序号，故 番外 在 大纲 前）
import { waitForAppReady, launchApp, shutdown, shot, goToProjects } from "./lib.mjs";

const errors = [];
const results = [];
const record = (id, pass, detail = "") => {
  results.push({ id, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}${detail ? " " + detail : ""}`);
};
const step = async (id, fn) => {
  try { await fn(); } catch (e) { record(id, false, `EXCEPTION ${String(e).slice(0, 200)}`); }
};

const { app, page, vite } = await launchApp({ errors });
const sleep = (ms) => page.waitForTimeout(ms);

const RUN = String(Date.now() % 10000);
const FOLDER = `智排${RUN}`;
const FILES = ["序章.md", "第1章.md", "第一章.md", "第2章.md", "第10章.md", "番外.md", "大纲.md"];
const SMART_EXPECTED = ["序章.md", "第1章.md", "第一章.md", "第2章.md", "第10章.md", "番外.md", "大纲.md"];

const PANEL = '.workspace-tree-panel[data-workspace-panel="session"]';
const sessNodeCount = async (name) => page.evaluate(({ p, n }) =>
  [...document.querySelectorAll(p + " .tree-node")]
    .filter((el) => el.querySelector(".tree-node__label")?.textContent?.trim() === n).length, { p: PANEL, n: name });

// 采 parent 直接子级的 DOM label 序（树为扁平列表，缩进 = 10 + depth*14px）
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

// 根域新建：右键根目录行「/」（dir 行菜单含 新建文件夹，parentPath="/"）——
// 面板空白处右键在树上内容变多后会命中文件行（其菜单无 create-folder），不可靠
async function sessBlankMenu() {
  return rightClickNode("/");
}

async function createFolder(name) {
  await sessBlankMenu();
  await sleep(500);
  await menuAction("create-folder");
  await sleep(700);
  await page.locator(".text-prompt-modal input").first().fill(name);
  await page.locator(".text-prompt-modal button").filter({ hasText: /^确定$|^创建$/ }).first().click();
  await sleep(1100);
}

async function createFileIn(parent, name) {
  await rightClickNode(parent);
  await sleep(450);
  await menuAction("create-file");
  await sleep(700);
  await page.locator(".text-prompt-modal input").first().fill(name);
  await page.locator(".text-prompt-modal button").filter({ hasText: /^确定$|^创建$/ }).first().click();
  await sleep(1000);
}

// 打开目录规则弹窗（等 loading 消失），返回第一个 chips 组的 active 文案
async function openDirRule(parent) {
  await rightClickNode(parent);
  await sleep(450);
  await menuAction("rule-config");
  for (let i = 0; i < 10; i++) {
    if (await page.evaluate(() => !document.querySelector(".dir-rule-modal__loading"))) break;
    await sleep(400);
  }
  await sleep(400);
  return page.evaluate(() => {
    const chips = document.querySelectorAll(".dir-rule-modal .dir-rule-modal__chips")[0];
    return chips?.querySelector(".config-dep-chip.is-active")?.textContent?.trim() ?? null;
  });
}

async function closeDirRule() {
  if (!(await page.evaluate(() => !!document.querySelector(".dir-rule-modal")))) return;
  await page.locator(".dir-rule-modal .text-prompt-modal__actions button").filter({ hasText: "取消" }).first().click();
  await sleep(600);
}

try {
  await waitForAppReady(page);
  await goToProjects(page);
  await page.locator("li:visible").filter({ hasText: "回归项目A" }).first().click();
  await sleep(1000);
  await shot(page, "840", "session-panel-ready");

  // ===== 前置：建目录 + 7 个章节类文件 =====
  console.log("PHASE", "setup");
  await createFolder(FOLDER);
  if (!((await sessNodeCount(FOLDER)) > 0)) throw new Error(FOLDER + " 未创建");
  for (const f of FILES) await createFileIn(FOLDER, f);
  let children = await childrenOf(FOLDER);
  console.log("CHILDREN_AFTER_CREATE", JSON.stringify(children));
  if (!children || children.length !== FILES.length) throw new Error("前置文件未建齐: " + JSON.stringify(children));

  // ===== SS-DEFAULT：字典序基线（第10章 在 第2章 前）=====
  await step("SS-DEFAULT", async () => {
    await shot(page, "841", "files-name-order-baseline");
    const i10 = children.indexOf("第10章.md");
    const i2 = children.indexOf("第2章.md");
    record("SS-DEFAULT", i10 >= 0 && i2 >= 0 && i10 < i2,
      `名称排序下 第10章@${i10} < 第2章@${i2}（字典序基线） order=${JSON.stringify(children)}`);
  });

  // ===== 切「智能排序」=====
  console.log("PHASE", "smart-sort");
  const sortBefore = await openDirRule(FOLDER);
  console.log("RULE_SORT_BEFORE", JSON.stringify(sortBefore));
  await page.locator(".dir-rule-modal .config-dep-chip").filter({ hasText: "智能排序" }).first().click();
  await sleep(400);
  await page.locator(".dir-rule-modal .text-prompt-modal__actions button").filter({ hasText: "保存" }).first().click();
  await sleep(1400); // 弹窗自动关 + onSaved → notifyWorkspaceMutated → 树刷新
  await closeDirRule();
  await sleep(600);
  children = await childrenOf(FOLDER);
  console.log("CHILDREN_SMART", JSON.stringify(children));
  await shot(page, "842", "smart-order-result");

  await step("SS-SMART", async () => {
    const eq = JSON.stringify(children) === JSON.stringify(SMART_EXPECTED);
    record("SS-SMART", eq, `实际=${JSON.stringify(children)} 预期=${JSON.stringify(SMART_EXPECTED)}`);
  });
  await step("SS-TIE", async () => {
    const i1 = children.indexOf("第1章.md");
    const iZh1 = children.indexOf("第一章.md");
    const i2 = children.indexOf("第2章.md");
    record("SS-TIE", i1 >= 0 && iZh1 === i1 + 1 && i2 === iZh1 + 1,
      `第1章@${i1} → 第一章@${iZh1} → 第2章@${i2}（同序号按文件名决胜 + 数值序 1<2）`);
  });
  await step("SS-SINK", async () => {
    const iFan = children.indexOf("番外.md");
    const iDa = children.indexOf("大纲.md");
    const i10 = children.indexOf("第10章.md");
    record("SS-SINK", i10 >= 0 && iFan === i10 + 1 && iDa === children.length - 1,
      `第10章@${i10} → 番外@${iFan}（fixed_max 沉到有序号之后）→ 大纲@${iDa}（无序号自然序沉底）`);
  });

  // ===== SS-PERSIST：重开弹窗 active chip 仍为 智能排序 =====
  await step("SS-PERSIST", async () => {
    const active = await openDirRule(FOLDER);
    await shot(page, "843", "rule-modal-smart-active");
    await closeDirRule();
    record("SS-PERSIST", active === "智能排序", `重开弹窗 active=${JSON.stringify(active)} 初始=${JSON.stringify(sortBefore)}`);
  });

  // ===== 汇总 =====
  await shot(page, "844", "done");
  console.log("SUMMARY", JSON.stringify(results));
  const allPass = results.every((r) => r.pass);
  console.log("ALL_PASS", allPass);
  if (!allPass) process.exitCode = 1;

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 500));
  process.exitCode = 1;
  try { await page.screenshot({ path: "/tmp/ss-err.png" }); } catch {}
}
await shutdown(app, vite);
console.log("SS_BASIC_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 5)));
