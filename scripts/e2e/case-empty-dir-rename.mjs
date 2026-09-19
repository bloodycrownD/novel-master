// v1.5.20 修复批次：case-empty-dir-rename——空目录重命名 + 目录改名后旧目录（幽灵目录）不残留 + 规则跟随迁移
// 域：sessions 列表视图的「会话工作区」面板（workspaceScope=session → project scope）
// 断言：
//   ER-EMPTY——空目录立即改名成功（此前版本必失败）
//   ER-GHOST——含文件目录改名后旧名目录从树上消失、新名目录在、内部文件保留
//   ER-RULE——规则跟随迁移：改名前把排序方式改为「创建时间」并保存，改名后新路径规则弹窗仍为「创建时间」；
//             旧名重建目录的规则为默认「文件名称」（旧路径无规则残留）
import { waitForAppReady, launchApp, shutdown, shot, goToProjects, openWorkspaceContextMenu } from "./lib.mjs";

const errors = [];
const results = [];
const record = (id, pass, detail = "") => {
  results.push({ id, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}${detail ? " " + detail : ""}`);
};
const step = async (id, fn) => {
  try { await fn(); } catch (e) { record(id, false, `EXCEPTION ${String(e).slice(0, 200)}`); }
};

const RUN = String(Date.now() % 10000); // 每轮唯一后缀，规避上一轮残留同名目录
const NAME_A = `空目录甲${RUN}`;
const NAME_A2 = `空目录甲改${RUN}`;
const NAME_A3 = `空目录甲改2${RUN}`;
const NAME_B = `含文件目录乙${RUN}`;
const NAME_B2 = `含文件目录乙改${RUN}`;

const { app, page, vite } = await launchApp({ errors });
const sleep = (ms) => page.waitForTimeout(ms);

// session 域（project scope）面板内定位树节点——按 label 精确匹配。
// 勿用 filter hasText 计数：子串匹配下「空目录甲改」会命中「空目录甲」，旧名残留断言必误报
const sessNode = (name) =>
  page.locator('.workspace-tree-panel[data-workspace-panel="session"] .tree-node').filter({
    has: page.locator(".tree-node__label", { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }),
  }).first();
const sessNodeCount = async (name) => page.evaluate((n) =>
  [...document.querySelectorAll('.workspace-tree-panel[data-workspace-panel="session"] .tree-node')]
    .filter((el) => el.querySelector(".tree-node__label")?.textContent?.trim() === n).length, name);

// 右键 session 面板空白 → 工作区菜单
async function sessBlankMenu() {
  const panel = page.locator('.workspace-tree-panel[data-workspace-panel="session"]').first();
  const box = await panel.boundingBox();
  if (!box) throw new Error("session 面板不可见");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  const menu = page.locator("#workspace-context-menu");
  await menu.waitFor({ state: "visible", timeout: 5000 });
  return menu;
}

// 右键树节点 → 行菜单
async function rightClickNode(node) {
  const box = await node.boundingBox();
  if (!box) throw new Error("树节点不可见，无法右键");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  const menu = page.locator("#workspace-context-menu");
  await menu.waitFor({ state: "visible", timeout: 5000 });
  return menu;
}

const toastText = () => page.evaluate(() =>
  document.querySelector(".shell-toast.is-visible .shell-toast__message")?.textContent
  ?? document.querySelector(".shell-toast.is-visible")?.textContent ?? null);

// 新建文件夹（在 session 面板根）
async function createFolder(name) {
  await sessBlankMenu();
  await sleep(500);
  await page.locator('[data-workspace-action="create-folder"]').first().click();
  await sleep(700);
  await page.locator(".text-prompt-modal input").first().fill(name);
  await page.locator(".text-prompt-modal button").filter({ hasText: /^确定$|^创建$/ }).first().click();
  await sleep(1100);
}

// 重命名树节点
async function renameNode(node, newName) {
  await rightClickNode(node);
  await sleep(450);
  await page.locator('[data-workspace-action="rename"]').first().click();
  await sleep(700);
  await page.locator(".text-prompt-modal input").first().fill(newName);
  await page.locator(".text-prompt-modal button").filter({ hasText: "确定" }).first().click();
  await sleep(1300);
}

// 打开目录规则弹窗并读当前排序方式 active chip 文案
async function openDirRule(node) {
  await rightClickNode(node);
  await sleep(450);
  await page.locator('[data-workspace-action="rule-config"]').first().click();
  // 等 form 加载（loading 占位消失）
  for (let i = 0; i < 10; i++) {
    const loaded = await page.evaluate(() => !document.querySelector(".dir-rule-modal__loading"));
    if (loaded) break;
    await sleep(400);
  }
  await sleep(400);
  const sort = await page.evaluate(() => {
    const chips = [...document.querySelectorAll(".dir-rule-modal .dir-rule-modal__chips")][0];
    if (!chips) return null;
    const active = chips.querySelector(".config-dep-chip.is-active");
    return active?.textContent?.trim() ?? null;
  });
  return sort;
}

// 关闭规则弹窗（取消）——保存成功路径弹窗会自动关，先探测再点
async function closeDirRule() {
  const still = await page.evaluate(() => !!document.querySelector(".dir-rule-modal"));
  if (!still) return;
  await page.locator(".dir-rule-modal .text-prompt-modal__actions button").filter({ hasText: "取消" }).first().click();
  await sleep(600);
}

try {
  await waitForAppReady(page);
  // 归位到回归项目A 的 sessions 列表视图（右侧面板 = 会话工作区 project 域）
  await goToProjects(page);
  await page.locator("li:visible").filter({ hasText: "回归项目A" }).first().click();
  await sleep(1000);
  const panelVisible = await page.evaluate(() =>
    !!document.querySelector('.workspace-tree-panel[data-workspace-panel="session"]')?.offsetParent);
  console.log("SESS_PANEL_VISIBLE", panelVisible);
  await shot(page, "810", "session-panel-ready");

  // ===== Part 1：空目录立即重命名（此前版本必失败）=====
  console.log("PHASE", "empty-dir-rename");
  await createFolder(NAME_A);
  let nodeA = sessNode(NAME_A);
  const emptyCreated = (await nodeA.count()) > 0;
  console.log("EMPTY_DIR_CREATED", emptyCreated);
  if (!emptyCreated) throw new Error(NAME_A + " 未创建");
  await shot(page, "811", "empty-dir-created");

  await renameNode(nodeA, NAME_A2);
  const renamed = (await sessNodeCount(NAME_A2)) > 0;
  const oldGone = (await sessNodeCount(NAME_A)) === 0;
  const renameToast = await toastText();
  console.log("EMPTY_RENAME", { renamed, oldGone, toast: renameToast });
  await shot(page, "812", "empty-dir-renamed");
  record("ER-EMPTY", renamed && oldGone, `改名${renamed ? "成功" : "失败"} 旧名残留=${!oldGone} toast=${JSON.stringify(renameToast)}`);

  // ===== Part 2：规则跟随迁移 =====
  console.log("PHASE", "rule-migrate");
  nodeA = sessNode(NAME_A2);
  // 改名前：规则里把排序方式改为「创建时间」并保存
  const sortBefore = await openDirRule(nodeA);
  console.log("RULE_SORT_BEFORE", JSON.stringify(sortBefore));
  await shot(page, "813", "rule-before-rename");
  await page.locator(".dir-rule-modal .config-dep-chip").filter({ hasText: "创建时间" }).first().click();
  await sleep(400);
  await page.locator(".dir-rule-modal .text-prompt-modal__actions button").filter({ hasText: "保存" }).first().click();
  await sleep(1200);
  await closeDirRule();
  await sleep(400);

  // 改名
  await renameNode(sessNode(NAME_A2), NAME_A3);
  const renamed2 = (await sessNodeCount(NAME_A3)) > 0;
  console.log("RENAME2", renamed2);
  await shot(page, "814", "dir-renamed-again");

  // 新路径规则：仍为「创建时间」
  const sortAfter = await openDirRule(sessNode(NAME_A3));
  console.log("RULE_SORT_AFTER", JSON.stringify(sortAfter));
  await shot(page, "815", "rule-after-rename");
  await closeDirRule();
  await sleep(300);

  // 旧名重建目录：规则应回默认「文件名称」（旧路径无规则残留）
  await createFolder(NAME_A2);
  const oldNameSort = await openDirRule(sessNode(NAME_A2));
  console.log("RULE_SORT_OLDNAME", JSON.stringify(oldNameSort));
  await closeDirRule();
  await sleep(300);
  record("ER-RULE",
    sortBefore === "文件名称" && sortAfter === "创建时间" && oldNameSort === "文件名称",
    `改名前=${sortBefore} 改名后=${sortAfter} 旧名重建=${oldNameSort}`);

  // ===== Part 3：含文件目录改名（幽灵目录）=====
  console.log("PHASE", "ghost-dir");
  await createFolder(NAME_B);
  const dirB = sessNode(NAME_B);
  if (!((await dirB.count()) > 0)) throw new Error(NAME_B + " 未创建");
  // 目录下建文件：右键目录 → 新建文件
  await rightClickNode(dirB);
  await sleep(450);
  await page.locator('[data-workspace-action="create-file"]').first().click();
  await sleep(700);
  await page.locator(".text-prompt-modal input").first().fill("内容.md");
  await page.locator(".text-prompt-modal button").filter({ hasText: /^确定$|^创建$/ }).first().click();
  await sleep(1100);
  // 建完先看树实况（目录展开态 + 全部 label）
  const treeState0 = await page.evaluate(() => ({
    labels: [...document.querySelectorAll('.workspace-tree-panel[data-workspace-panel="session"] .tree-node')]
      .map((el) => ({ label: el.querySelector(".tree-node__label")?.textContent?.trim(), expanded: el.getAttribute("aria-expanded") })),
    toast: document.querySelector(".shell-toast.is-visible")?.textContent ?? null,
  }));
  console.log("TREE_AFTER_CREATE_FILE", JSON.stringify(treeState0));
  // 确保目录展开（未展开则点一下），再断言文件在
  const expanded0 = await page.evaluate((n) => {
    const el = [...document.querySelectorAll('.workspace-tree-panel[data-workspace-panel="session"] .tree-node')]
      .find((x) => x.querySelector(".tree-node__label")?.textContent?.trim() === n);
    return el?.getAttribute("aria-expanded") === "true";
  }, NAME_B);
  if (!expanded0) { await dirB.click(); await sleep(900); }
  const fileInOld = (await sessNodeCount("内容.md")) > 0;
  console.log("FILE_IN_OLD_DIR", fileInOld);
  await shot(page, "816", "dir-with-file-created");

  // 改名目录
  await renameNode(dirB, NAME_B2);
  const newB = (await sessNodeCount(NAME_B2)) > 0;
  const ghostOld = (await sessNodeCount(NAME_B)) > 0;
  // 展开新目录确认文件保留
  await sessNode(NAME_B2).click();
  await sleep(900);
  const fileInNew = (await sessNodeCount("内容.md")) > 0;
  console.log("GHOST_CHECK", { newB, ghostOld, fileInNew });
  await shot(page, "817", "dir-renamed-no-ghost");
  record("ER-GHOST", newB && !ghostOld && fileInNew && fileInOld,
    `新名在=${newB} 旧名残留=${ghostOld} 文件保留=${fileInNew}（改名前文件在=${fileInOld}）`);

  // ===== 汇总 =====
  await shot(page, "818", "done");
  console.log("SUMMARY", JSON.stringify(results));
  const allPass = results.every((r) => r.pass);
  console.log("ALL_PASS", allPass);
  if (!allPass) process.exitCode = 1;

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 500));
  process.exitCode = 1;
  try { await page.screenshot({ path: "/tmp/er-dir-err.png" }); } catch {}
}
await shutdown(app, vite);
console.log("ER_DIR_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 5)));
