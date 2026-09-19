// v1.5.17 批次 B2：case-filename-validation——新建/重命名文件名校验（中文提示 + 树不出现非法条目）
// D-17 修复后口径（对齐移动端）：TextPromptModal 接入 validateVfsEntryName，非法名在弹窗层
// 行内中文提示（.text-prompt-modal__error）+「确定」禁用，不再静默 trim、不再等服务层 toast。
// 断言：
//   FV-CONTROL——正向对照：正常名文件可创建（拒绝断言非空洞）
//   FV-DOT——新建文件夹 "." / ".." → 行内「文件名不能为 . 或 ..」+ 确定禁用，树不出现条目
//   FV-BLANK——纯空白名 → 行内「文件名不能为空或纯空白」+ 确定禁用，树不出现条目
//   FV-SPACE——首尾空格名「 xx 」→ 行内「文件名不能以空格开头或结尾」+ 确定禁用，
//              树中既无原样名也无 trim 后名字（修复前：静默 trim 创建）
//   FV-RENAME——重命名为 "." → 行内提示、旧名保留；重命名纯空白/首尾空格 → 同款拦截、旧名保留
// 预期依据：validate-entry-name.ts 中文文案 + 移动端 VfsPromptModal 同源行为
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

// 弹窗层拒绝状态：行内错误文案 + 确定按钮禁用（D-17 修复后的统一拒绝形态）
const promptRejection = () => page.evaluate(() => ({
  error: document.querySelector(".text-prompt-modal__error")?.textContent?.trim() ?? null,
  confirmDisabled: (() => {
    const btns = [...document.querySelectorAll(".text-prompt-modal button")];
    const c = btns.find((b) => /^(确定|创建)$/.test(b.textContent.trim()));
    return c ? c.disabled : null;
  })(),
}));

// 打开「新建 xx」弹窗（在根目录行上）并填入 name；返回拒绝状态
async function openCreatePrompt(kind, name) {
  await rightClickNode("/");
  await sleep(450);
  await menuAction(kind === "file" ? "create-file" : "create-folder");
  await sleep(700);
  await page.locator(".text-prompt-modal input").first().fill(name);
  await sleep(300);
  return promptRejection();
}
// 打开「重命名」弹窗：右击树节点 nodeName，弹窗内填入 newName；返回拒绝状态
async function openRenamePrompt(nodeName, newName) {
  await rightClickNode(nodeName);
  await sleep(450);
  await menuAction("rename");
  await sleep(700);
  await page.locator(".text-prompt-modal input").first().fill(newName);
  await sleep(300);
  return promptRejection();
}
async function closePrompt() {
  if (!(await page.evaluate(() => !!document.querySelector(".text-prompt-modal")))) return;
  await cancelBtn().click();
  await sleep(500);
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

  // ===== FV-DOT：新建文件夹 "." / ".." → 行内提示 + 禁提交 + 树无条目 =====
  await step("FV-DOT", async () => {
    const before = await panelNodeCount();
    const states = [];
    for (const dot of [".", ".."]) {
      const r = await openCreatePrompt("folder", dot);
      if (!r.confirmDisabled) await confirmBtn().click().catch(() => {}); // 禁用态点了也不应提交
      await sleep(500);
      await closePrompt();
      await sleep(400);
      states.push(r);
    }
    const after = await panelNodeCount();
    const noEntry = (await nodeCountOf(".")) === 0 && (await nodeCountOf("..")) === 0 && after === before;
    const allRejected = states.every((s) => s.error === "文件名不能为 . 或 .." && s.confirmDisabled);
    await shot(page, "868", "dot-name-inline-error", 300);
    record("FV-DOT", noEntry && allRejected,
      `拒绝=${JSON.stringify(states)} 树条目数 ${before}→${after}`);
  });

  // ===== FV-BLANK：纯空白名 → 行内提示 + 禁提交 + 树无条目 =====
  await step("FV-BLANK", async () => {
    const before = await panelNodeCount();
    const states = [];
    for (const kind of ["file", "folder"]) {
      const r = await openCreatePrompt(kind, "   ");
      if (!r.confirmDisabled) await confirmBtn().click().catch(() => {});
      await sleep(500);
      await closePrompt();
      await sleep(300);
      states.push(r);
    }
    const after = await panelNodeCount();
    const noEntry = after === before;
    const allRejected = states.every((s) => s.error === "文件名不能为空或纯空白" && s.confirmDisabled);
    await shot(page, "866", "blank-name-inline-error", 300);
    record("FV-BLANK", noEntry && allRejected,
      `拒绝=${JSON.stringify(states)} 树条目数 ${before}→${after}`);
  });

  // ===== FV-SPACE：首尾空格名 → 行内提示 + 禁提交 + 原样/trim 名均未创建 =====
  await step("FV-SPACE", async () => {
    const before = await panelNodeCount();
    const r = await openCreatePrompt("file", SPACED);
    if (!r.confirmDisabled) await confirmBtn().click().catch(() => {});
    await sleep(600);
    await shot(page, "867", "spaced-name-inline-error", 300);
    await closePrompt();
    await sleep(400);
    const trimmedCreated = (await nodeCountOf(SPACED_TRIMMED)) === 1;
    const rawCreated = (await nodeCountOf(SPACED)) === 1;
    const after = await panelNodeCount();
    const rejected = r.error === "文件名不能以空格开头或结尾" && r.confirmDisabled;
    record("FV-SPACE", rejected && !trimmedCreated && !rawCreated && after === before,
      `拒绝=${JSON.stringify(r)} trimmed创建=${trimmedCreated} 原样创建=${rawCreated} 树条目数 ${before}→${after}`);
  });

  // ===== FV-RENAME：重命名 "." / 纯空白 / 首尾空格 → 行内拦截、旧名保留 =====
  await step("FV-RENAME", async () => {
    const cases = [];
    // 重命名为 "." → 行内提示，旧名保留
    let r = await openRenamePrompt(NORMAL, ".");
    await sleep(400);
    await shot(page, "869", "rename-dot-inline-error", 300);
    await closePrompt();
    await sleep(300);
    cases.push({ name: ".", r, kept: (await nodeCountOf(NORMAL)) === 1 });
    // 重命名纯空白 → 行内提示 + 禁提交，旧名保留
    r = await openRenamePrompt(NORMAL, "   ");
    await sleep(300);
    await closePrompt();
    await sleep(300);
    cases.push({ name: "空白", r, kept: (await nodeCountOf(NORMAL)) === 1 });
    // 重命名首尾空格 → 行内提示 + 禁提交，旧名保留（修复前会静默 trim 改名）
    r = await openRenamePrompt(NORMAL, ` ${NORMAL} `);
    await sleep(300);
    await closePrompt();
    await sleep(300);
    const spacedOldKept = (await nodeCountOf(NORMAL)) === 1;
    cases.push({ name: "首尾空格", r, kept: spacedOldKept });

    const dotOk = cases[0].r.error === "文件名不能为 . 或 .." && cases[0].r.confirmDisabled && cases[0].kept;
    const blankOk = cases[1].r.error === "文件名不能为空或纯空白" && cases[1].r.confirmDisabled && cases[1].kept;
    const spacedOk = cases[2].r.error === "文件名不能以空格开头或结尾" && cases[2].r.confirmDisabled && cases[2].kept;
    record("FV-RENAME", dotOk && blankOk && spacedOk,
      `dot=${JSON.stringify(cases[0].r)} 空白=${JSON.stringify(cases[1].r)} 首尾空格=${JSON.stringify(cases[2].r)} 旧名保留=${cases.map((c) => c.kept)}`);
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
