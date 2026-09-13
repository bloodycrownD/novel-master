// 本迭代专属回归断言（fix/desktop-regression-fixes Step 9）：
// T-P1/P2/P3 PreviewPane 三修、T-S1/S2 设置两修、T-D1/D2 抽屉重置+返回、
// T-G1~G4 导航守卫四分发点、T-A1 附件双发守门（TA2 段收口进 results）、
// T-A2 下划线投影复核（spec 遗留观察，不 FAIL）。
// 依赖 bootstrap 产物（回归项目A + 会话 + 回归Provider/模型绑定）；技能在本脚本
// 自建 nav-guard-A/B 两个——命名刻意避开「回归技能」子串，不干扰后续
// case-models-skills 的「回归技能」行删除断言（hasText 子串匹配会误伤）。
import {
  waitForAppReady, launchApp, shutdown, startMock, shot, sendMessage,
  openWorkspaceContextMenu, closeOverlays, pickUsableSession, assertLastUserAttach,
} from "./lib.mjs";

const errors = [];
// 每断言一行 PASS/FAIL + 用例号；FAIL 不中断，收集到 SUMMARY 汇总
const results = [];
const record = (id, pass, detail = "") => {
  results.push({ id, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}${detail ? " " + detail : ""}`);
};

const mock = await startMock();
const { app, page, vite } = await launchApp({ errors });
const sleep = (ms) => page.waitForTimeout(ms);

// ===== 小工具 =====
// 读当前可见 ConfirmModal 的标题与可见性
const confirmState = () => page.evaluate(() => {
  const m = document.querySelector(".confirm-modal");
  return { visible: !!m && !!m.offsetParent, title: m?.querySelector(".confirm-modal__title")?.textContent ?? null };
});
const cancelConfirm = async () => {
  await page.locator(".confirm-modal button").filter({ hasText: "取消" }).first().click();
  await sleep(700);
};
const okConfirm = async () => {
  await page.locator(".confirm-modal button").filter({ hasText: "确定" }).first().click();
  await sleep(900);
};
// 残留弹窗清场（取消优先，无则 Escape）
const clearModals = async () => {
  for (let i = 0; i < 4; i++) {
    if (!(await page.evaluate(() => !!document.querySelector(".confirm-modal")))) break;
    const cb = page.locator(".confirm-modal button").filter({ hasText: "取消" }).first();
    if (await cb.count()) { await cb.click().catch(() => {}); await sleep(500); }
    else { await page.keyboard.press("Escape").catch(() => {}); await sleep(400); }
  }
};
// 用例包装：异常计 FAIL 继续跑
const step = async (id, fn) => {
  try { await fn(); } catch (e) { record(id, false, `EXCEPTION ${String(e).slice(0, 200)}`); }
};

// 进入可用会话：公共函数逐个尝试直至 composer 可用，未绑模型的会话自足绑定
// （C-3② 收敛——旧 ensureSession 只查会话存在，首个会话未绑模型时会静默空发）；
// 全不可用由公共函数抛出

// 当前可见视图是否 sessions 列表
const navViews = () => page.evaluate(() =>
  [...document.querySelectorAll(".chat-nav-view")].filter((v) => !v.hidden).map((v) => v.getAttribute("data-nav-view")));
// 从会话内逐层返回 sessions 列表
async function backToSessions() {
  for (let k = 0; k < 3; k++) {
    if ((await navViews()).includes("sessions")) return;
    const bk = page.locator('button[aria-label="返回"]:visible').first();
    if (await bk.count()) { await bk.click(); await sleep(600); } else break;
  }
}

// 抽屉默认视图探测：技能面板容器不在 + 「技能」入口在
const drawerState = () => page.evaluate(() => ({
  panel: !!document.querySelector("#session-skill-panel"),
  drawerDefault: !!document.querySelector('[data-session-detail-action="open-skills"]')?.offsetParent,
}));

try {
  // app 就绪条件等待（原固定 sleep(3500)，见 lib.mjs waitForAppReady 说明）
  await waitForAppReady(page);
  await pickUsableSession(page);

  // ===== Phase 1：工作区弹窗聚焦描边（T-S2）+ 空文件占位（T-P2）+ 空态文案（T-P3）=====
  console.log("PHASE", "preview-and-modal");
  await openWorkspaceContextMenu(page);
  await sleep(700);
  await page.locator('[data-workspace-action="create-file"]').first().click();
  await sleep(800);

  // T-S2：TextPromptModal 输入框 focus 描边应为 var(--primary-ring)（D-11 修复），非 Chromium 默认橙
  await step("T-S2", async () => {
    const input = page.locator(".text-prompt-modal input").first();
    await input.focus();
    await sleep(400);
    const style = await page.evaluate(() => {
      const el = document.querySelector(".text-prompt-modal input");
      const cs = getComputedStyle(el);
      const ring = getComputedStyle(document.documentElement).getPropertyValue("--primary-ring").trim();
      return { borderColor: cs.borderColor, ring, focused: document.activeElement === el };
    });
    await shot(page, "700", "ts2-focus-ring");
    const nums = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
    const a = nums(style.borderColor), b = nums(style.ring);
    const equals = a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.01);
    const blue = a.length >= 3 && a[2] > a[0]; // 蓝（b>r）；橙 (255,165,0) 为 b<r
    record("T-S2", equals && blue, JSON.stringify(style));
  });

  // 建空 .md 文件（不写内容，供 T-P2）
  await page.locator(".text-prompt-modal input").first().fill("空文件P2.md");
  await page.locator("button:visible").filter({ hasText: /^确定$|^创建$/ }).first().click();
  await sleep(1100);
  const emptyNode = page.locator(".tree-node").filter({ hasText: "空文件P2.md" }).first();
  if (!(await emptyNode.count())) throw new Error("空文件P2.md 未创建");
  await emptyNode.click();
  await sleep(1300);

  // T-P2：空 .md 预览显示「（空文件）」占位（D-7 修复，markdown 分支）
  await step("T-P2", async () => {
    const text = await page.evaluate(() => document.querySelector("#preview-body .preview-empty")?.textContent ?? null);
    await shot(page, "701", "tp2-empty-md");
    record("T-P2", text === "（空文件）", `占位=${text}`);
  });

  // T-P3：清空预览（关最后一个 tab）→ 手动切「编辑」→ 空态文案「在工作区选择文件以编辑」（D-8 修复）
  await step("T-P3", async () => {
    await page.locator(".preview-editor-tabs__close").first().click();
    await sleep(1000);
    await page.locator('[aria-label="预览模式"] button').filter({ hasText: "编辑" }).first().click();
    await sleep(700);
    const text = await page.evaluate(() => document.querySelector("#preview-body .preview-empty")?.textContent ?? null);
    await shot(page, "702", "tp3-empty-edit");
    record("T-P3", text === "在工作区选择文件以编辑", `文案=${text}`);
  });

  // ===== Phase 2：显式关 tab 回归（T-P1，断言在末尾汇总）=====
  console.log("PHASE", "tab-close");
  const noteNode = page.locator(".tree-node").filter({ hasText: "回归笔记.md" }).first();
  await noteNode.click();
  await sleep(1400);
  await page.locator(".preview-editor-tabs__close").first().click();
  await sleep(1400);
  await shot(page, "703", "tp1-tab-closed");

  // ===== Phase 3：T-A1 附件双发守门 + T-A2 下划线投影复核（T-A2 仍为观察记录，不 FAIL）=====
  console.log("PHASE", "annotate-projection");
  await noteNode.click();
  await sleep(1500);
  // 划词前确认 read 模式（.preview-markdown 在、无编辑器）
  const readMode = await page.evaluate(() => ({
    md: !!document.querySelector(".preview-markdown"),
    noEditor: !document.querySelector("#preview-body .cm-content"),
  }));
  console.log("TA2_READMODE", JSON.stringify(readMode));

  if (readMode.md) {
    // 划词（拖选正文前段）
    const para = await page.evaluate(() => {
      const el = [...document.querySelectorAll(".preview-markdown p")].find((e) => e.offsetParent && e.textContent?.includes("回归测试写入的正文"));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y + r.height / 2, w: r.width };
    });
    if (para) {
      await page.mouse.move(para.x + 6, para.y);
      await page.mouse.down();
      await page.mouse.move(para.x + Math.min(140, para.w * 0.55), para.y, { steps: 8 });
      await page.mouse.up();
      await sleep(1100);
      await shot(page, "704", "ta2-selected");
      const clicked = await page.evaluate(() => {
        const btn = document.querySelector("button.preview-annotate-floating__btn");
        if (btn) { btn.click(); return true; }
        return false;
      });
      console.log("TA2_FLOAT_CLICKED", clicked);
      await sleep(900);
      const ta = page.locator('textarea[placeholder="输入批注说明"]');
      if (await ta.count()) {
        await ta.fill("T-A2 下划线投影复核批注。");
        await page.locator(".text-prompt-modal button").filter({ hasText: "添加" }).last().click();
        await sleep(1200);
      }
      const chip = await page.evaluate(() => [...document.querySelectorAll("[class*=chip]")].filter((c) => c.offsetParent).map((c) => c.textContent?.slice(0, 30)).slice(0, 3));
      console.log("TA2_CHIP", JSON.stringify(chip));

      // 发送（单发结构，批注随首条落库）
      await sendMessage(page, "T-A2投影复核消息");
      await sleep(1500);
      await shot(page, "705", "ta2-sent");
      // 附件落库断言（公共函数重试式探测，C-3② 收敛）：结果收口进 T-A1 守门断言（A-1）——
      // 附件双发复发或探测不匹配时 FAIL，不再只 console.log 观察致 ALL_PASS 恒绿
      const attach = await assertLastUserAttach(page, "T-A2投影复核消息");
      record("T-A1", attach.matched && attach.hasAttach, JSON.stringify(attach));

      // 重开文件：切到另一文件再切回（触发 loadFile + annotator 重建）
      await emptyNode.click();
      await sleep(1200);
      await noteNode.click();
      await sleep(1600);
      const proj = await page.evaluate(() => {
        const root = document.querySelector(".preview-markdown");
        if (!root) return { root: false, items: [] };
        const items = [];
        const push = (via, e) => items.push({
          via, tag: e.tagName, cls: String(e.className).slice(0, 60),
          text: e.textContent?.slice(0, 40),
        });
        // ① 显式标记/批注元素（含 r6o 全系）
        for (const sel of ["mark", "u", "[data-annotator-id]", ".r6o-annotation", "[class*=r6o]", "[class*=annotat]"]) {
          for (const e of [...root.querySelectorAll(sel)].filter((x) => x.offsetParent).slice(0, 5)) push("sel:" + sel, e);
        }
        // ② 下划线样式元素（text-decoration / border-bottom），限含正文关键词的文本节点容器
        for (const e of root.querySelectorAll("*")) {
          if (!e.offsetParent) continue;
          const cs = getComputedStyle(e);
          const td = cs.textDecorationLine ?? "none";
          const bbStyled = cs.borderBottomStyle !== "none" && cs.borderBottomWidth !== "0px";
          if ((td.includes("underline") || bbStyled) && e.textContent?.includes("回归测试写入的正文")) {
            push("style", e);
          }
        }
        return {
          root: true,
          bodyHas: root.textContent?.includes("回归测试写入的正文") ?? false,
          items: items.slice(0, 30),
        };
      });
      console.log("TA2_PROJECTION", JSON.stringify(proj));
      const n = proj.items?.length ?? 0;
      console.log(`OBS T-A2 投影元素${n ? "命中 " + n + " 个" : "未找到（已落库批注不回投影，草稿 store 发送后清空——新遗留观察）"}`);
      await shot(page, "706", "ta2-reopen-scan");
    } else {
      console.log("OBS T-A2 正文段落未定位到，跳过划词");
    }
  } else {
    console.log("OBS T-A2 预览非 read 模式，跳过");
  }

  // ===== Phase 4：设置域——自建技能 A/B（T-D1/T-G4 前置）+ Provider 表单（T-S1）=====
  console.log("PHASE", "settings-prep");
  await page.locator("#settings-open").click();
  await sleep(900);
  await page.locator('[data-settings-nav="skillsManage"]').click();
  await sleep(1000);

  // 建技能：新建 → 填名/描述 → 「创建并编辑」→ onCreated 直进详情
  async function createSkill(name, desc) {
    await page.locator(".settings-view button").filter({ hasText: "新建" }).first().click();
    await sleep(800);
    await page.locator(".text-prompt-modal input").first().fill(name);
    await page.locator(".text-prompt-modal textarea").first().fill(desc);
    await page.locator(".text-prompt-modal button").filter({ hasText: "创建并编辑" }).click();
    await sleep(1600);
  }
  await createSkill("nav-guard-A", "导航守卫回归用技能A");
  // 技能 A 里补一个辅助文件（T-G3 点「另一文件」需要）
  await page.locator('button[aria-label="新建辅助文件"]').click();
  await sleep(700);
  await page.locator(".text-prompt-modal input").first().fill("notes.md");
  await page.locator(".text-prompt-modal button").filter({ hasText: "创建并编辑" }).click();
  await sleep(1300);
  // 回 SKILL.md（clean，无弹窗）再 header 返回出详情
  await page.locator(".skill-detail__file-open").filter({ hasText: "SKILL.md" }).first().click();
  await sleep(900);
  await page.locator('[data-action="settings-back"]').click();
  await sleep(900);
  await createSkill("nav-guard-B", "导航守卫回归用技能B");
  await page.locator('[data-action="settings-back"]').click();
  await sleep(900);
  const skillsReady = await page.evaluate(() => ({
    a: [...document.querySelectorAll(".settings-list-item")].some((e) => e.textContent?.includes("nav-guard-A")),
    b: [...document.querySelectorAll(".settings-list-item")].some((e) => e.textContent?.includes("nav-guard-B")),
  }));
  console.log("SKILLS_READY", JSON.stringify(skillsReady));
  await shot(page, "707", "skills-created");

  // T-S1：Provider 表单 input[type="text"] 稳定命中 Base URL 与服务商名称（D-4 修复）
  await step("T-S1", async () => {
    await page.locator('[data-settings-nav="providers"]').click();
    await sleep(900);
    await page.locator(".settings-view button").filter({ hasText: "新建服务商" }).first().click();
    await sleep(1100);
    const s1 = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('.settings-view input[type="text"]')].filter((i) => i.offsetParent);
      return {
        count: inputs.length,
        fields: inputs.map((i) => i.closest(".settings-field")?.textContent?.slice(0, 20) ?? "?"),
      };
    });
    await shot(page, "708", "ts1-provider-form");
    const hitBase = s1.fields.some((f) => f.includes("Base URL"));
    const hitName = s1.fields.some((f) => f.includes("服务商名称"));
    record("T-S1", s1.count >= 2 && hitBase && hitName, JSON.stringify(s1));
    // 退出表单（无 dirty 无弹窗）
    await page.locator('[data-action="settings-back"]').click();
    await sleep(800);
  });

  // ===== Phase 5：导航守卫（T-G1~T-G4）=====
  console.log("PHASE", "nav-guard");

  // T-G1：SKILL.md 脏编辑 → 侧导航切走 → 弹「未保存的更改」；取消留在原页内容不丢；确认后切走
  await step("T-G1", async () => {
    await page.locator('[data-settings-nav="skillsManage"]').click();
    await sleep(900);
    await page.locator(".settings-view .settings-list-item").filter({ hasText: "nav-guard-A" }).first().click();
    await sleep(1300);
    await page.locator('[aria-label="技能文件模式"] button').filter({ hasText: "编辑" }).first().click();
    await sleep(900);
    const cm = page.locator("#skill-editor .cm-content").first();
    await cm.click();
    await page.keyboard.type("G1脏标记内容", { delay: 3 });
    await sleep(900);
    await page.locator('[data-settings-nav="providers"]').click();
    await sleep(1000);
    const g1a = await confirmState();
    await shot(page, "709", "tg1-confirm");
    if (!(g1a.visible && g1a.title === "未保存的更改")) return record("T-G1", false, `弹窗=${JSON.stringify(g1a)}`);
    await cancelConfirm();
    const g1b = await page.evaluate(() => ({
      name: document.querySelector(".skill-detail__name")?.textContent ?? null,
      dirty: document.querySelector("#skill-editor .cm-content")?.textContent ?? "",
    }));
    const keep = g1b.name === "nav-guard-A" && g1b.dirty.includes("G1脏标记内容");
    if (!keep) return record("T-G1", false, `取消后留存异常=${JSON.stringify({ name: g1b.name, hasDirty: g1b.dirty.includes("G1脏标记内容") })}`);
    // 再切 → 确认 → 切到服务商
    await page.locator('[data-settings-nav="providers"]').click();
    await sleep(800);
    await okConfirm();
    const g1c = await page.evaluate(() => ({
      navActive: document.querySelector('[data-settings-nav="providers"]')?.classList.contains("is-active") ?? false,
      skillGone: !document.querySelector(".skill-detail__name"),
    }));
    record("T-G1", g1c.navActive && g1c.skillGone, JSON.stringify(g1c));
  });

  // T-G2：脏态下 header「‹返回上一级」与「×关闭设置」两路径同弹确认（取消路径验证）
  await step("T-G2", async () => {
    // 重建脏态
    await page.locator('[data-settings-nav="skillsManage"]').click();
    await sleep(800);
    await page.locator(".settings-view .settings-list-item").filter({ hasText: "nav-guard-A" }).first().click();
    await sleep(1200);
    await page.locator('[aria-label="技能文件模式"] button').filter({ hasText: "编辑" }).first().click();
    await sleep(800);
    await page.locator("#skill-editor .cm-content").first().click();
    await page.keyboard.type("G2脏标记", { delay: 3 });
    await sleep(800);
    // 路径①：header 返回上一级
    await page.locator('[data-action="settings-back"]').click();
    await sleep(900);
    const g2a = await confirmState();
    await cancelConfirm();
    const g2aName = await page.evaluate(() => document.querySelector(".skill-detail__name")?.textContent ?? null);
    // 路径②：× 关闭设置
    await page.locator(".settings-main__close").click();
    await sleep(900);
    const g2b = await confirmState();
    await shot(page, "710", "tg2-close-guard");
    await cancelConfirm();
    const g2c = await page.evaluate(() => ({
      pageHidden: document.querySelector("#settings-page")?.hidden ?? null,
      name: document.querySelector(".skill-detail__name")?.textContent ?? null,
    }));
    record("T-G2",
      g2a.visible && g2a.title === "未保存的更改" && g2aName === "nav-guard-A"
      && g2b.visible && g2b.title === "未保存的更改"
      && g2c.pageHidden === false && g2c.name === "nav-guard-A",
      `返回弹窗=${g2a.visible}/${g2a.title} 关闭弹窗=${g2b.visible}/${g2b.title} 留存=${JSON.stringify(g2c)}`);
  });

  // T-G3：脏态后切「查看」模式 → 点技能列表另一文件 → 仍弹确认（guarded 条件修正：isDirty 单独判定）
  await step("T-G3", async () => {
    // 沿用 T-G2 留下的脏态（编辑模式），切「查看」
    await page.locator('[aria-label="技能文件模式"] button').filter({ hasText: "查看" }).first().click();
    await sleep(900);
    await page.locator(".skill-detail__file-open").filter({ hasText: "notes.md" }).first().click();
    await sleep(900);
    const g3a = await confirmState();
    await shot(page, "711", "tg3-viewmode-guard");
    await cancelConfirm();
    const g3b = await page.evaluate(() => ({
      selected: document.querySelector(".skill-detail__file-row.is-active")?.textContent ?? null,
      content: document.querySelector(".skill-detail__content")?.textContent ?? "",
    }));
    record("T-G3",
      g3a.visible && g3a.title === "未保存的更改"
      && (g3b.selected?.includes("SKILL.md") ?? false)
      && g3b.content.includes("G2脏标记"),
      `弹窗=${g3a.visible}/${g3a.title} 选中=${g3b.selected?.slice(0, 20)} 脏内容在=${g3b.content.includes("G2脏标记")}`);
  });

  // T-G4：技能 A 脏编辑 → toggle 关设置（dirty 存活）→ 聊天侧抽屉技能面板点技能 B 行
  //       → 设置页自动打开且确认弹窗可见 → 取消 → 留在 A 内容不丢（第四分发点 + hidden 可见性契约）
  await step("T-G4", async () => {
    // 回编辑模式（脏内容仍在，切模式不清 content）
    await page.locator('[aria-label="技能文件模式"] button').filter({ hasText: "编辑" }).first().click();
    await sleep(700);
    // toggle 关设置（AppChrome 只 hidden，viewId/dirty 保留）
    await page.locator("#settings-open").click();
    await sleep(1000);
    const g4a = await page.evaluate(() => ({
      pageHidden: document.querySelector("#settings-page")?.hidden ?? null,
      dirtyAlive: (document.querySelector("#skill-editor .cm-content")?.textContent ?? "").includes("G2脏标记"),
    }));
    // 聊天侧：抽屉 → 技能面板 → 点技能 B 行
    await page.locator('[data-action="open-session-actions"]').first().click();
    await sleep(1000);
    await page.locator('[data-session-detail-action="open-skills"]').first().click();
    await sleep(1100);
    await page.locator('[data-session-skill-action="open-detail"]').filter({ hasText: "nav-guard-B" }).first().click();
    await sleep(1400);
    const g4b = await page.evaluate(() => ({
      pageHidden: document.querySelector("#settings-page")?.hidden ?? null,
      confirmVisible: (() => { const m = document.querySelector(".confirm-modal"); return !!m && !!m.offsetParent; })(),
      title: document.querySelector(".confirm-modal__title")?.textContent ?? null,
    }));
    await shot(page, "712", "tg4-cross-page");
    if (!(g4b.pageHidden === false && g4b.confirmVisible && g4b.title === "未保存的更改")) {
      return record("T-G4", false, `守卫态异常=${JSON.stringify(g4b)} toggle态=${JSON.stringify(g4a)}`);
    }
    await cancelConfirm();
    const g4c = await page.evaluate(() => ({
      name: document.querySelector(".skill-detail__name")?.textContent ?? null,
      dirty: document.querySelector("#skill-editor .cm-content")?.textContent ?? "",
    }));
    record("T-G4",
      g4a.pageHidden === true && g4a.dirtyAlive
      && g4c.name === "nav-guard-A" && g4c.dirty.includes("G2脏标记"),
      `跨页弹窗可见=${g4b.confirmVisible} 取消留存=${g4c.name}/${g4c.dirty.includes("G2脏标记")}`);
  });
  // T-G4 清场（不算用例断言）：技能 A 仍脏，须 ×关闭→确认丢弃。注意先关抽屉：
  // 抽屉背板 absolute 无 z-index、绘制在非定位的设置页之上，不先关掉会挡住设置页点击
  // （诊断实证：elementFromPoint 命中 session-detail-drawer__backdrop）
  try {
    await clearModals();
    await closeOverlays(page);
    await sleep(400);
    await page.locator(".settings-main__close").click();
    await sleep(800);
    await okConfirm();
  } catch (e) {
    console.log("TG4_CLEANUP_ERR", String(e).slice(0, 120));
    await clearModals();
  }

  // ===== Phase 6：抽屉重置 + 面板返回（T-D1/T-D2）=====
  console.log("PHASE", "drawer-reset");
  await closeOverlays(page);
  await sleep(500);

  // T-D2：技能面板「‹返回」回默认视图
  await step("T-D2", async () => {
    await page.locator('[data-action="open-session-actions"]').first().click();
    await sleep(1000);
    await page.locator('[data-session-detail-action="open-skills"]').first().click();
    await sleep(1100);
    const panelOpen = await page.evaluate(() => !!document.querySelector("#session-skill-panel"));
    await page.locator('[data-session-detail-action="skill-panel-back"]').first().click();
    await sleep(800);
    const d2 = await drawerState();
    record("T-D2", panelOpen && !d2.panel && d2.drawerDefault, `面板先开=${panelOpen} 返回后=${JSON.stringify(d2)}`);
  });

  // T-D1：面板态关抽屉 → 重开回默认视图；切另一会话重开同理
  await step("T-D1", async () => {
    // 第一半：开面板 → 关抽屉 → 重开 → 默认视图
    await page.locator('[data-session-detail-action="open-skills"]').first().click();
    await sleep(1000);
    const panelOpen = await page.evaluate(() => !!document.querySelector("#session-skill-panel"));
    await page.locator('[data-session-detail-action="close"]').first().click();
    await sleep(900);
    await page.locator('[data-action="open-session-actions"]').first().click();
    await sleep(1100);
    const d1a = await drawerState();
    await shot(page, "713", "td1-drawer-reopen");
    // 第二半：再开面板 → 关抽屉 → 建第二个会话并切入 → 开抽屉 → 默认视图（跨会话重置）
    await page.locator('[data-session-detail-action="open-skills"]').first().click();
    await sleep(1000);
    await page.locator('[data-session-detail-action="close"]').first().click();
    await sleep(800);
    await backToSessions();
    // sessions 视图 rail 按钮文本是「新建」（非「新建会话」，与 case-session-mgmt 一致）
    await page.locator("#chat-rail button:visible").filter({ hasText: "新建" }).first().click();
    await sleep(1600);
    await page.locator('[data-action="open-session-actions"]').first().click();
    await sleep(1100);
    const d1b = await drawerState();
    record("T-D1",
      panelOpen && !d1a.panel && d1a.drawerDefault && !d1b.panel && d1b.drawerDefault,
      `重开=${JSON.stringify(d1a)} 跨会话=${JSON.stringify(d1b)}`);
  });

  // ===== Phase 7：汇总 =====
  await clearModals();
  await closeOverlays(page);
  // T-P1 最终断言：全程（含两处显式关 tab 路径）errors 数组无 setVersion（不断言「为空」——
  // 过滤名单外的无关 console 噪声会进 errors，为空断言易误报）
  const setv = errors.filter((e) => e.includes("setVersion"));
  record("T-P1", setv.length === 0, `setVersion错误=${setv.length}${setv.length ? " " + JSON.stringify(setv.slice(0, 2)) : ""}`);

  await shot(page, "714", "done");
  console.log("SUMMARY", JSON.stringify(results));
  const allPass = results.every((r) => r.pass);
  console.log("ALL_PASS", allPass);
  // B-3③：FAIL 时非零退出，串联序列（&& 编排）自动断链，失败不再向后传导
  if (!allPass) process.exitCode = 1;

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 500));
  // 中途炸断同样以非零退出断链（此时 ALL_PASS 可能来不及打，不能以 0 退出绿携传递）
  process.exitCode = 1;
  try { await page.screenshot({ path: "/tmp/regfx-err.png" }); } catch {}
}
await shutdown(app, vite, mock);
console.log("REGFX_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 5)));
