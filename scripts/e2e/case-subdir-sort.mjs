// v1.5.17 批次 B2：case-subdir-sort——子目录排序遵循目录规则 + 「排序方式」文案更名
// 断言：
//   SD-NAME——默认（文件名称）下子目录按 locale 字典序排列，与卷序数值无关（本机实测拼音序）
//   SD-TIME——切「创建时间」后子目录按 mtime（=创建顺序 第十卷→第三卷→第一卷→第二卷）排列
//   SD-SMART——切「智能排序」后按卷序数值排列：第一卷, 第二卷, 第三卷, 第十卷
//   SD-LABEL——目录规则弹窗字段名是「排序方式」（v1.5.17 由「排序字段」更名），且有「智能排序」选项
// 预期依据：CHANGELOG v1.5.17 修复条目「子目录排序遵循目录规则」+ 变更条目（桌面端同步文案更名）
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
const FOLDER = `卷序${RUN}`;
// 创建顺序故意 ≠ 字典序 ≠ 卷序：mtime 序 = 第十卷, 第三卷, 第一卷, 第二卷
const SUBDIRS = ["第十卷", "第三卷", "第一卷", "第二卷"];
const MTIME_EXPECTED = ["第十卷", "第三卷", "第一卷", "第二卷"];
const SMART_EXPECTED = ["第一卷", "第二卷", "第三卷", "第十卷"];

const PANEL = '.workspace-tree-panel[data-workspace-panel="session"]';
const sessNodeCount = async (name) => page.evaluate(({ p, n }) =>
  [...document.querySelectorAll(p + " .tree-node")]
    .filter((el) => el.querySelector(".tree-node__label")?.textContent?.trim() === n).length, { p: PANEL, n: name });

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

async function createFolderIn(parentOrNull, name) {
  if (parentOrNull == null) {
    await sessBlankMenu();
  } else {
    await rightClickNode(parentOrNull);
  }
  await sleep(500);
  await menuAction("create-folder");
  await sleep(700);
  await page.locator(".text-prompt-modal input").first().fill(name);
  await page.locator(".text-prompt-modal button").filter({ hasText: /^确定$|^创建$/ }).first().click();
  await sleep(1100);
}

// 打开目录规则弹窗，返回 { activeSort, activeOrder, labels }
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
    const groups = document.querySelectorAll(".dir-rule-modal .dir-rule-modal__chips");
    const active = (g) => g?.querySelector(".config-dep-chip.is-active")?.textContent?.trim() ?? null;
    return {
      activeSort: active(groups[0]),
      activeOrder: active(groups[1]),
      labels: [...document.querySelectorAll(".dir-rule-modal .dir-rule-modal__label")].map((el) => el.textContent?.trim()),
      sortChips: groups[0] ? [...groups[0].querySelectorAll(".config-dep-chip")].map((c) => c.textContent?.trim()) : [],
    };
  });
}

async function saveDirRule() {
  await page.locator(".dir-rule-modal .text-prompt-modal__actions button").filter({ hasText: "保存" }).first().click();
  await sleep(1400);
  if (await page.evaluate(() => !!document.querySelector(".dir-rule-modal"))) {
    await page.locator(".dir-rule-modal .text-prompt-modal__actions button").filter({ hasText: "取消" }).first().click();
    await sleep(600);
  }
}

async function setRule(parent, chipText) {
  const info = await openDirRule(parent);
  await page.locator(".dir-rule-modal .config-dep-chip").filter({ hasText: chipText }).first().click();
  await sleep(400);
  await saveDirRule();
  await sleep(600);
  return info;
}

try {
  await waitForAppReady(page);
  await goToProjects(page);
  await page.locator("li:visible").filter({ hasText: "回归项目A" }).first().click();
  await sleep(1000);

  // ===== 前置：父目录 + 4 个子目录（按 SUBDIRS 顺序创建）=====
  await createFolderIn(null, FOLDER);
  if (!((await sessNodeCount(FOLDER)) > 0)) throw new Error(FOLDER + " 未创建");
  for (const d of SUBDIRS) await createFolderIn(FOLDER, d);
  let children = await childrenOf(FOLDER);
  console.log("CHILDREN_AFTER_CREATE", JSON.stringify(children));
  if (!children || children.length !== 4) throw new Error("前置子目录未建齐: " + JSON.stringify(children));

  // ===== SD-NAME：默认字典序（与卷序数值无关）=====
  await step("SD-NAME", async () => {
    await shot(page, "860", "subdirs-name-order");
    // 名称模式走 localeCompare（本机 zh 环境实测为拼音序 二<三<十<一），不同 locale
    // 排序可能不同，硬编码具体序不可移植——回归点是「名称序 ≠ 卷序数值序」
    const notNumeric = JSON.stringify(children) !== JSON.stringify(SMART_EXPECTED);
    record("SD-NAME", notNumeric,
      `名称排序实际=${JSON.stringify(children)}（locale 字典序，非卷序数值序；卷序预期=${JSON.stringify(SMART_EXPECTED)}）`);
  });

  // ===== SD-LABEL + SD-TIME：创建时间 =====
  await step("SD-LABEL", async () => {
    const info = await setRule(FOLDER, "创建时间");
    await shot(page, "861", "rule-created-time");
    const hasLabel = info.labels.includes("排序方式");
    const noOldLabel = !info.labels.some((t) => (t ?? "").includes("排序字段"));
    const hasSmartChip = info.sortChips.includes("智能排序");
    record("SD-LABEL", hasLabel && noOldLabel && hasSmartChip,
      `labels=${JSON.stringify(info.labels)} 排序chips=${JSON.stringify(info.sortChips)}`);
  });
  await step("SD-TIME", async () => {
    children = await childrenOf(FOLDER);
    console.log("CHILDREN_TIME", JSON.stringify(children));
    await shot(page, "862", "subdirs-time-order");
    record("SD-TIME", JSON.stringify(children) === JSON.stringify(MTIME_EXPECTED),
      `创建时间排序实际=${JSON.stringify(children)} 预期(mtime序)=${JSON.stringify(MTIME_EXPECTED)}`);
  });

  // ===== SD-SMART：智能排序 =====
  await step("SD-SMART", async () => {
    const info = await setRule(FOLDER, "智能排序");
    console.log("RULE_BEFORE_SMART", JSON.stringify({ sort: info.activeSort, order: info.activeOrder }));
    await shot(page, "863", "rule-smart");
    children = await childrenOf(FOLDER);
    console.log("CHILDREN_SMART", JSON.stringify(children));
    await shot(page, "864", "subdirs-smart-order");
    record("SD-SMART", JSON.stringify(children) === JSON.stringify(SMART_EXPECTED),
      `智能排序实际=${JSON.stringify(children)} 预期=${JSON.stringify(SMART_EXPECTED)}`);
  });

  // ===== 汇总 =====
  console.log("SUMMARY", JSON.stringify(results));
  const allPass = results.every((r) => r.pass);
  console.log("ALL_PASS", allPass);
  if (!allPass) process.exitCode = 1;

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 500));
  process.exitCode = 1;
  try { await page.screenshot({ path: "/tmp/sd-err.png" }); } catch {}
}
await shutdown(app, vite);
console.log("SD_SORT_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 5)));
