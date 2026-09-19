// v1.5.16 批次 B3：case-skill-rename——技能可重命名、描述可编辑 + 导出 ZIP 菜单
// 断言：
//   SK-NEW——UI 新建全局测试技能（新建弹窗 → 创建并编辑 → 跳详情）
//   SK-RENAME——行菜单「编辑信息」改名+改描述一次提交 → 列表显示新名新描述；
//             重开编辑信息弹窗 name/description 为新值（技能存 VFS（sqlite），
//             userData 下无技能磁盘目录 → 持久断言退化为弹窗回读，UI 级验证）
//   SK-DOLLAR——描述含美元符号序列「价格是$$100 && $&x」→ 保存 → 重开弹窗逐字
//             保留（v1.5.16 修复项：描述不再被 string.replace 特殊替换模式吃掉）
//   SK-BUILTIN——内置技能 agent-config：名称框 readOnly + label「内置技能不可改名」；
//             描述可改（改完还原，避免污染 seed 文案）
//   SK-CONFLICT——重命名撞已有技能名 → 提交被拒 + 错误「已存在同名技能：xxx」
//   SK-INVALID——非法名（含空白 / 以 . 开头）→ 内联校验提示 + 保存按钮禁用
//   SE-MENU——技能行菜单含「导出 ZIP」入口（🔧 实际导出走原生保存对话框，
//             自动化不可控，跳过点击——仅断言菜单项存在 + 截图）
// 预期依据：CHANGELOG v1.5.16 + SkillInfoEditModal.tsx / skills.service.ts
//   （builtin 双保险：UI readOnly + core BUILTIN_SKILL_RENAME；文案见 skill-errors.ts）
import { waitForAppReady, launchApp, shutdown, shot, waitForToast } from "./lib.mjs";

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
const SKILL_A = `e2e改名源${RUN}`;
const SKILL_A2 = `e2e改名后${RUN}`;
const SKILL_B = `e2e撞名靶${RUN}`;
const DOLLAR_DESC = "价格是$$100 && $&x";

// ===== 定位器 =====
const view = page.locator(".settings-view");
// SettingsListItem 渲染 .settings-list-item-row（主按钮 + ⋮ 菜单按钮）；
// 技能名互不为前缀时 hasText 子串匹配即可唯一定位
const skillRow = (name) => view.locator(".settings-list-item").filter({ hasText: name }).first();
// SkillInfoEditModal / NewSkillModal 共用 text-prompt-modal 结构；编辑信息弹窗标题区分
const infoModal = page.locator(".text-prompt-modal").filter({ hasText: "编辑信息" });
const infoNameInput = infoModal.locator("input.text-prompt-modal__input").first();
const infoDescInput = infoModal.locator("textarea.new-skill-modal__desc").first();
const infoSaveBtn = infoModal.locator(".text-prompt-modal__btn--primary").first();

async function openRowMenu(name) {
  const row = skillRow(name);
  await row.scrollIntoViewIfNeeded();
  // ⋮ 菜单按钮与 .settings-list-item 同在 .settings-list-item-row 内
  const btn = view.locator(".settings-list-item-row").filter({ hasText: name })
    .locator('button[aria-label="更多"]').first();
  if (!(await btn.count())) throw new Error("行菜单按钮未找到: " + name);
  await btn.click();
  await page.locator(".context-menu").waitFor({ state: "visible", timeout: 5000 });
  return page.locator(".context-menu");
}

// ContextMenu 只靠「菜单外 mousedown」关闭（无 Escape 绑定）：点管理页标题区
// （span，非按钮）触发 document mousedown 收起菜单，无副作用
async function closeRowMenu() {
  await view.locator(".list-manage-header__title").first().click({ force: true });
  await sleep(500);
}

async function openInfoEdit(name) {
  await openRowMenu(name);
  await sleep(300);
  await page.locator(".context-menu button").filter({ hasText: "编辑信息" }).first().click();
  await infoModal.waitFor({ state: "visible", timeout: 5000 });
  await sleep(400); // useEffect 重置表单值
}

async function closeInfoEdit() {
  const cancel = infoModal.locator(".text-prompt-modal__btn").filter({ hasText: "取消" }).first();
  if (await cancel.count()) { await cancel.click(); await sleep(500); }
  else { await page.keyboard.press("Escape"); await sleep(400); }
}

// 提交编辑信息并等 toast（成功「已保存技能信息」）
async function saveInfoEdit() {
  await infoSaveBtn.click();
  const toast = await waitForToast(page, "已保存技能信息");
  await sleep(1200); // reload 刷新列表
  return toast;
}

async function createSkill(name, desc) {
  // ManageHeader normalActions 的主按钮（class 区分，避免撞别的「新建」文本）
  await view.locator(".list-manage-header__btn--primary").filter({ hasText: "新建" }).first().click();
  const modal = page.locator(".text-prompt-modal").filter({ hasText: "新建技能" });
  await modal.waitFor({ state: "visible", timeout: 5000 });
  await modal.locator("input.text-prompt-modal__input").first().fill(name);
  await modal.locator("textarea.new-skill-modal__desc").first().fill(desc);
  // 存储域默认全局（管理页 tab=global 时 defaultDomain=global），不动
  await modal.locator(".text-prompt-modal__btn--primary").first().click();
  // 创建成功自动跳技能详情页（onCreated → openDetail）
  await sleep(1800);
}

// 详情页返回技能管理列表
async function backToList() {
  const back = view.locator("button").filter({ hasText: "返回" }).first();
  if (await back.count()) { await back.click(); await sleep(1000); }
}

async function deleteSkill(name) {
  await openRowMenu(name);
  await sleep(300);
  await page.locator(".context-menu button").filter({ hasText: "删除" }).first().click();
  await sleep(700);
  const ok = page.locator(".confirm-modal button").filter({ hasText: /删除|确定/ }).first();
  if (await ok.count()) { await ok.click(); await sleep(1200); }
}

const listHas = async (name) => (await skillRow(name).count()) > 0;

try {
  await waitForAppReady(page);

  // ===== 进技能管理页（全局 tab）=====
  await page.click('button[aria-label="打开设置"]');
  await sleep(800);
  await page.locator('[data-settings-nav="skillsManage"]').click();
  await sleep(1200);
  await shot(page, "888", "skills-manage-ready");

  // ===== SK-NEW：新建测试技能 A =====
  console.log("PHASE", "sk-new");
  await step("SK-NEW", async () => {
    await createSkill(SKILL_A, "旧描述");
    await shot(page, "889", "skill-a-detail");
    const detailName = await page.evaluate(() => document.querySelector(".skill-detail__name")?.textContent ?? null);
    await backToList();
    const inList = await listHas(SKILL_A);
    record("SK-NEW", detailName === SKILL_A && inList,
      `detail=${detailName} list=${inList}`);
  });

  // ===== SE-MENU：行菜单含「导出 ZIP」（🔧 原生保存对话框，跳过实际导出）=====
  console.log("PHASE", "se-menu");
  await step("SE-MENU", async () => {
    const menu = await openRowMenu(SKILL_A);
    const labels = await menu.locator("button").allTextContents();
    await shot(page, "890", "row-menu-export-zip");
    const has = labels.map((l) => l.trim()).includes("导出 ZIP");
    record("SE-MENU", has, `菜单项=[${labels.map((l) => l.trim()).join(", ")}] 🔧 实际导出走原生保存对话框，自动化跳过`);
    await closeRowMenu();
  });

  // ===== SK-RENAME：改名 + 改描述一次提交 =====
  console.log("PHASE", "sk-rename");
  await step("SK-RENAME", async () => {
    await openInfoEdit(SKILL_A);
    await infoNameInput.fill(SKILL_A2);
    await infoDescInput.fill("新描述内容");
    await shot(page, "891", "info-edit-filled");
    const toast = await saveInfoEdit();
    const renamed = await listHas(SKILL_A2);
    const rowText = renamed ? await skillRow(SKILL_A2).textContent() : "";
    await shot(page, "892", "skill-renamed-list");
    // 持久回读：重开编辑信息弹窗，name/description 应为新值（VFS 落库的 UI 级验证）
    let reopenName = null, reopenDesc = null;
    await openInfoEdit(SKILL_A2);
    reopenName = await infoNameInput.inputValue();
    reopenDesc = await infoDescInput.inputValue();
    await closeInfoEdit();
    record("SK-RENAME",
      !!toast && renamed && (rowText ?? "").includes("新描述内容") && reopenName === SKILL_A2 && reopenDesc === "新描述内容",
      `toast=${!!toast} list=${renamed} reopen=${reopenName}/${reopenDesc}`);
  });

  // ===== SK-DOLLAR：美元符号序列描述逐字保留 =====
  console.log("PHASE", "sk-dollar");
  await step("SK-DOLLAR", async () => {
    await openInfoEdit(SKILL_A2);
    await infoDescInput.fill(DOLLAR_DESC);
    const toast = await saveInfoEdit();
    await openInfoEdit(SKILL_A2);
    const saved = await infoDescInput.inputValue();
    await shot(page, "893", "dollar-desc-reopen");
    await closeInfoEdit();
    record("SK-DOLLAR",
      !!toast && saved === DOLLAR_DESC,
      `saved=${JSON.stringify(saved)} expect=${JSON.stringify(DOLLAR_DESC)}`);
  });

  // ===== SK-BUILTIN：内置技能名称只读、描述可改（改完还原）=====
  console.log("PHASE", "sk-builtin");
  await step("SK-BUILTIN", async () => {
    if (!(await listHas("agent-config"))) {
      record("SK-BUILTIN", false, "agent-config 不在全局技能列表");
      return;
    }
    await openInfoEdit("agent-config");
    const readonly = await infoNameInput.evaluate((el) => el.readOnly === true);
    const label = await infoModal.locator(".text-prompt-modal__label").filter({ hasText: "内置技能不可改名" }).count();
    await shot(page, "894", "builtin-name-readonly");
    const originalDesc = await infoDescInput.inputValue();
    // 仅改描述（名称只读改不了）→ 保存应成功
    await infoDescInput.fill(`e2e临时描述${RUN}`);
    const toast1 = await saveInfoEdit();
    await openInfoEdit("agent-config");
    const changed = await infoDescInput.inputValue();
    // 还原描述，避免污染 seed 文案
    await infoDescInput.fill(originalDesc);
    const toast2 = await saveInfoEdit();
    await openInfoEdit("agent-config");
    const restored = await infoDescInput.inputValue();
    await closeInfoEdit();
    await shot(page, "895", "builtin-desc-restored");
    record("SK-BUILTIN",
      readonly && label > 0 && !!toast1 && changed === `e2e临时描述${RUN}` && !!toast2 && restored === originalDesc,
      `readOnly=${readonly} label=${label > 0} 改描述=${!!toast1 && changed === `e2e临时描述${RUN}`} 还原=${!!toast2 && restored === originalDesc}`);
  });

  // ===== SK-CONFLICT：重命名撞已有技能名 =====
  console.log("PHASE", "sk-conflict");
  await step("SK-CONFLICT", async () => {
    await createSkill(SKILL_B, "靶子技能描述");
    await backToList();
    await openInfoEdit(SKILL_A2);
    await infoNameInput.fill(SKILL_B);
    await infoSaveBtn.click();
    // 后端拒绝：弹窗内错误行（非 toast）
    let errText = null;
    for (let i = 0; i < 20; i++) {
      errText = await infoModal.locator(".new-skill-modal__error").first().textContent().catch(() => null);
      if (errText && errText.trim()) break;
      await sleep(300);
    }
    await shot(page, "896", "rename-conflict-rejected");
    const stillOld = await listHas(SKILL_A2);
    await closeInfoEdit();
    await sleep(500);
    record("SK-CONFLICT",
      (errText ?? "").includes("已存在同名技能") && stillOld,
      `err=${(errText ?? "").trim()} 原名保留=${stillOld}`);
  });

  // ===== SK-INVALID：非法名内联校验 + 保存禁用 =====
  console.log("PHASE", "sk-invalid");
  await step("SK-INVALID", async () => {
    await openInfoEdit(SKILL_A2);
    // 含空白
    await infoNameInput.fill("非法 名字");
    await sleep(400);
    const errBlank = (await infoModal.locator(".new-skill-modal__error").first().textContent().catch(() => "")) ?? "";
    const disabledBlank = await infoSaveBtn.isDisabled();
    // 以 . 开头
    await infoNameInput.fill(".dotname");
    await sleep(400);
    const errDot = (await infoModal.locator(".new-skill-modal__error").first().textContent().catch(() => "")) ?? "";
    const disabledDot = await infoSaveBtn.isDisabled();
    await shot(page, "897", "invalid-name-inline");
    await closeInfoEdit();
    record("SK-INVALID",
      errBlank.includes("技能名不能包含空白字符") && disabledBlank
        && errDot.includes("技能名不能以 . 开头") && disabledDot,
      `空白:[${errBlank}] disabled=${disabledBlank} 点开头:[${errDot}] disabled=${disabledDot}`);
  });

  // ===== 清理：删除两个测试技能 =====
  console.log("PHASE", "cleanup");
  await step("CLEANUP", async () => {
    await deleteSkill(SKILL_A2);
    await deleteSkill(SKILL_B);
    const a = await listHas(SKILL_A2), b = await listHas(SKILL_B);
    const builtin = await listHas("agent-config");
    await shot(page, "898", "cleanup-done");
    record("CLEANUP", !a && !b && builtin, `A2=${!a} B=${!b} 内置保留=${builtin}`);
  });

  // ===== 汇总 =====
  console.log("SUMMARY", JSON.stringify(results));
  const allPass = results.every((r) => r.pass);
  console.log("ALL_PASS", allPass);
  if (!allPass) process.exitCode = 1;

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 500));
  process.exitCode = 1;
  try { await page.screenshot({ path: "/tmp/sk-err.png" }); } catch {}
}
await shutdown(app, vite);
console.log("SK_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 5)));
