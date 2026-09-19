// v1.5.17 批次 B2：case-filename-validation——新建/重命名文件名校验（中文提示 + 树不出现非法条目）
// 断言：
//   FV-CONTROL——正向对照：正常名文件可创建（拒绝断言非空洞）
//   FV-DOT——新建文件夹 "." / ".." → toast「文件名不能为 . 或 ..」，树不出现该条目（文件/目录两口径）
//   FV-BLANK——纯空白名（"   "）新建文件与文件夹：树不出现条目；提示形态=弹窗「确定」禁用
//              （TextPromptModal 对空提交直接拦，验证层文案不触达——记观察，不算失败）
//   FV-SPACE——首尾空格名「 xx 」：预期被拒绝并中文提示；实测桌面弹窗提交前静默 trim，
//              以去掉空格后的名字直接创建（CHANGELOG 声明与桌面实际不符）→ 记 FAIL 产品问题
//   FV-RENAME——重命名为 "." → toast 拒绝、旧名保留；重命名纯空白 → 弹窗禁用提交、旧名保留
// 预期依据：CHANGELOG v1.5.17「新建/重命名文件名校验」+ validate-entry-name.ts 中文文案
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
const NORMAL = `正常名${RUN}.md`;
const SPACED = ` 空格名${RUN}.md `; // 首尾空格
const SPACED_TRIMMED = `空格名${RUN}.md`;

const PANEL = '.workspace-tree-panel[data-workspace-panel="session"]';
const panelNodeCount = () => page.evaluate((p) =>
  document.querySelectorAll(p + " .tree-node").length, PANEL);
const nodeCountOf = (name) => page.evaluate(({ p, n }) =>
  [...document.querySelectorAll(p + " .tree-node")]
    .filter((el) => el.querySelector(".tree-node__label")?.textContent?.trim() === n).length, { p: PANEL, n: name });

async function rightClickNode(name) {
  const node = page.locator(PANEL + " .tree-node").filter({
    has: page.locator(".tree-node__label", { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }),
  }).first();
  await node.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sleep(200);
  const box = await node.boundingBox();
  if (!box) throw new Error("树节点不可见: " + name);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  const menu = page.locator("#workspace-context-menu");
  await menu.waitFor({ state: "visible", timeout: 5000 });
  return menu;
}
const menuAction = (action) =>
  page.locator(`[data-workspace-action="${action}"]`).first().evaluate((el) => el.click());

const confirmBtn = () => page.locator(".text-prompt-modal button").filter({ hasText: /^确定$|^创建$/ }).first();
const cancelBtn = () => page.locator(".text-prompt-modal button").filter({ hasText: "取消" }).first();

// 打开「新建 xx」弹窗（在根目录行上）并填入 name；返回确认按钮状态
async function openCreatePrompt(kind, name) {
  await rightClickNode("/");
  await sleep(450);
  await menuAction(kind === "file" ? "create-file" : "create-folder");
  await sleep(700);
  await page.locator(".text-prompt-modal input").first().fill(name);
  await sleep(200);
  return confirmBtn().isDisabled();
}
async function closePrompt() {
  if (!(await page.evaluate(() => !!document.querySelector(".text-prompt-modal")))) return;
  await cancelBtn().click();
  await sleep(500);
}

const toastText = () => page.evaluate(() =>
  document.querySelector(".shell-toast.is-visible .shell-toast__message")?.textContent
  ?? document.querySelector(".shell-toast.is-visible")?.textContent ?? null);
async function waitToast(ms = 2500) {
  const t0 = Date.now();
  let t = null;
  while (Date.now() - t0 < ms) {
    t = await toastText();
    if (t) return t;
    await sleep(150);
  }
  return t;
}
// toast 可见窗口极短（实测 ~0.5s 即从 DOM 移除）：以「元素存在」为最早触发信号，
// 同一轮先读文本再零延时截图（顺序反了文本必丢；截图晚了视觉必丢——两者都尽力，文本为准）
async function waitToastShoot(id, name, ms = 2500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = await page.evaluate(() => {
      const el = document.querySelector(".shell-toast");
      return el?.textContent ?? null;
    });
    if (t) {
      await shot(page, id, name, 0);
      return t.trim() || t;
    }
    await sleep(50);
  }
  return null;
}

try {
  await waitForAppReady(page);
  await goToProjects(page);
  await page.locator("li:visible").filter({ hasText: "回归项目A" }).first().click();
  await sleep(1000);

  // ===== FV-CONTROL：正常名可创建 =====
  await step("FV-CONTROL", async () => {
    await rightClickNode("/");
    await sleep(450);
    await menuAction("create-file");
    await sleep(700);
    await page.locator(".text-prompt-modal input").first().fill(NORMAL);
    await confirmBtn().click();
    await sleep(1100);
    const ok = (await nodeCountOf(NORMAL)) === 1;
    await shot(page, "865", "control-file-created");
    record("FV-CONTROL", ok, `正常名 ${NORMAL} 创建=${ok}`);
  });

  // ===== FV-DOT：新建文件夹 "." 与 ".." 被拒 + 中文 toast =====
  await step("FV-DOT", async () => {
    const before = await panelNodeCount();
    const toasts = [];
    for (const dot of [".", ".."]) {
      await openCreatePrompt("folder", dot);
      await confirmBtn().click();
      const t = await waitToastShoot("868", "dot-name-toast", 2200); // 出现瞬间截（B1 教训：晚了自动消失）
      toasts.push(t);
      await sleep(400);
      await closePrompt(); // 校验失败时弹窗不自动关
      await sleep(400);
    }
    const after = await panelNodeCount();
    const noEntry = (await nodeCountOf(".")) === 0 && (await nodeCountOf("..")) === 0 && after === before;
    const toastOk = toasts.every((t) => t === "文件名不能为 . 或 ..");
    record("FV-DOT", noEntry && toastOk,
      `toasts=${JSON.stringify(toasts)} 树条目数 ${before}→${after} 无 . / .. 条目=${noEntry}`);
  });

  // ===== FV-BLANK：纯空白名（弹窗层禁用提交）=====
  await step("FV-BLANK", async () => {
    const before = await panelNodeCount();
    const states = [];
    for (const kind of ["file", "folder"]) {
      const disabled = await openCreatePrompt(kind, "   ");
      states.push({ kind, disabled });
      // 确认禁用 → 点了也不提交；补一刀点按验证无副作用
      if (!disabled) await confirmBtn().click().catch(() => {});
      await sleep(500);
      await closePrompt();
      await sleep(300);
    }
    const after = await panelNodeCount();
    const noEntry = after === before;
    await shot(page, "866", "blank-name-submit-blocked", 300);
    const blocked = states.every((s) => s.disabled);
    record("FV-BLANK", noEntry && blocked,
      `文件/文件夹弹窗确定禁用=${JSON.stringify(states)} 树条目数 ${before}→${after}（拒绝成立；提示形态=禁用提交按钮，验证层中文文案不触达，记观察）`);
  });

  // ===== FV-SPACE：首尾空格名（预期拒绝；实测桌面静默 trim 创建）=====
  await step("FV-SPACE", async () => {
    await openCreatePrompt("file", SPACED);
    await confirmBtn().click();
    const t = await waitToast(2200);
    await sleep(900);
    await closePrompt().catch(async () => {});
    await sleep(300);
    const trimmedCreated = (await nodeCountOf(SPACED_TRIMMED)) === 1;
    const rawCreated = (await nodeCountOf(SPACED)) === 1;
    await shot(page, "867", "spaced-name-result");
    record("FV-SPACE", false,
      `预期=拒绝+中文提示；实际=弹窗提交前静默 trim，以「${SPACED_TRIMMED}」创建（trimmed创建=${trimmedCreated} 原样创建=${rawCreated} toast=${JSON.stringify(t)}）——产品问题：桌面端首尾空格名校验被弹窗 trim 短路`);
  });

  // ===== FV-RENAME：重命名 "." 被拒（toast+旧名保留）；纯空白被弹窗拦截 =====
  await step("FV-RENAME", async () => {
    // 重命名为 "." → 中文 toast，旧名保留
    await rightClickNode(NORMAL);
    await sleep(450);
    await menuAction("rename");
    await sleep(700);
    await page.locator(".text-prompt-modal input").first().fill(".");
    await confirmBtn().click();
    const t = await waitToastShoot("869", "rename-dot-toast", 2200);
    await sleep(400);
    await closePrompt();
    await sleep(300);
    const dotToastOk = t === "文件名不能为 . 或 ..";
    const oldKeptAfterDot = (await nodeCountOf(NORMAL)) === 1;

    // 重命名为纯空白 → 弹窗禁用提交，旧名保留
    await rightClickNode(NORMAL);
    await sleep(450);
    await menuAction("rename");
    await sleep(700);
    await page.locator(".text-prompt-modal input").first().fill("   ");
    await sleep(200);
    const disabled = await confirmBtn().isDisabled();
    await closePrompt();
    await sleep(300);
    const oldKeptAfterBlank = (await nodeCountOf(NORMAL)) === 1;
    record("FV-RENAME", dotToastOk && oldKeptAfterDot && disabled && oldKeptAfterBlank,
      `点号 toast=${JSON.stringify(t)} 旧名保留=${oldKeptAfterDot} 空白提交禁用=${disabled} 空白后旧名保留=${oldKeptAfterBlank}`);
  });

  // ===== 汇总 =====
  console.log("SUMMARY", JSON.stringify(results));
  const allPass = results.every((r) => r.pass);
  console.log("ALL_PASS", allPass);
  if (!allPass) process.exitCode = 1;

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 500));
  process.exitCode = 1;
  try { await page.screenshot({ path: "/tmp/fv-err.png" }); } catch {}
}
await shutdown(app, vite);
console.log("FV_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 5)));
