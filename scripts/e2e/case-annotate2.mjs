// 补验：批注划词→添加→发送落库→重开文件看下划线投影
import { launchApp, shutdown, startMock, shot, goToProjects, sendMessage, openWorkspaceContextMenu } from "./lib.mjs";

const errors = [];
const mock = await startMock();
const { app, page, vite } = await launchApp({ errors });
const sleep = (ms) => page.waitForTimeout(ms);

try {
  await page.waitForLoadState("domcontentloaded");
  await sleep(3500);
  const composer = page.locator('textarea[aria-label="消息输入"]');
  // app 启动会自动恢复上次会话（可能是前序脚本留下的未绑模型会话，发送失败不落库）：
  // 无 composer 或 composer 被禁（未绑模型）都需重选会话
  const needPick = !(await composer.count()) || (await composer.isDisabled().catch(() => true));
  if (needPick) {
    if (await composer.count()) {
      // 已恢复某会话：先退出到会话列表
      const bk = page.locator('button[aria-label="返回"]:visible').first();
      if (await bk.count()) { await bk.click(); await sleep(800); }
    }
    await goToProjects(page);
    await page.locator("li:visible").filter({ hasText: "回归项目A" }).first().click();
    await sleep(700);
    // 全量序列里上游 case（如 session-mgmt 的删除测试）可能删光绑模型的会话，
    // 逐个尝试直到 composer 可用；全不可用时进第一个会话自己绑模型（自足，B4 同款）
    let picked = false;
    const rows0 = page.locator("#session-list li:visible");
    const total = await rows0.count();
    for (let i = 0; i < total; i++) {
      const rows = page.locator("#session-list li:visible");
      if (i >= (await rows.count())) break;
      await rows.nth(i).click();
      await sleep(1100);
      const c = page.locator('textarea[aria-label="消息输入"]');
      const ok = (await c.count()) && !(await c.isDisabled().catch(() => true));
      console.log("PICK_TRY", i, ok ? "OK" : "skip");
      if (ok) { picked = true; break; }
      await page.locator('button[aria-label="返回"]:visible').first().click();
      await sleep(600);
    }
    if (!picked) {
      console.log("NO_READY_SESSION——自足绑模型");
      const rows = page.locator("#session-list li:visible");
      if ((await rows.count()) === 0) throw new Error("no session to bind model");
      await rows.first().click();
      await sleep(1200);
      await page.locator('[data-action="open-session-actions"]').first().click();
      await sleep(900);
      await page.locator('[aria-label^="切换大模型"]').first().click();
      await sleep(800);
      await page.locator(".picker-modal__panel li:visible").nth(1).click();
      await sleep(800);
      const { closeOverlays } = await import("./lib.mjs");
      await closeOverlays(page);
      await sleep(500);
      const c = page.locator('textarea[aria-label="消息输入"]');
      if (!(await c.count()) || (await c.isDisabled().catch(() => true))) throw new Error("bind model failed");
      console.log("SELF_BOUND_OK");
    }
  }

  // 1. 建文件写正文
  // 探针：当前会话/面板状态
  const probe = await page.evaluate(() => ({
    sessActive: document.querySelector(".session-active, .chat-header")?.textContent?.slice(0, 40) ?? null,
    treePanel: document.querySelector(".workspace-trees")?.textContent?.slice(0, 40) ?? null,
    mdRoot: !!document.querySelector(".preview-markdown"),
    composer: !!document.querySelector('textarea[aria-label="消息输入"]'),
  }));
  console.log("SESSION_PROBE", JSON.stringify(probe));

  // 1. 建文件写正文（文件已存在则直接打开——重跑/全量序列下不重名冲突）
  const existing = page.locator(".tree-node").filter({ hasText: "批注验证.md" }).first();
  if (!(await existing.count())) {
    await openWorkspaceContextMenu(page);
    await sleep(700);
    await page.locator('[data-workspace-action="create-file"]').first().click();
    await sleep(700);
    await page.locator("input:visible").first().fill("批注验证.md");
    await page.locator("button:visible").filter({ hasText: /^确定$|^创建$/ }).first().click();
    await sleep(1000);
  }
  const node = page.locator(".tree-node").filter({ hasText: "批注验证.md" }).first();
  if (!(await node.count())) throw new Error("file not created");
  await node.click();
  await sleep(1000);
  await page.locator('[aria-label="预览模式"] button').filter({ hasText: "编辑" }).first().click();
  await sleep(900);
  const cm = page.locator(".cm-content").first();
  await cm.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await page.keyboard.type("批注投影验证正文，这句话将被划词添加批注。", { delay: 3 });
  await page.keyboard.press("Control+s");
  await sleep(1000);
  await page.locator('[aria-label="预览模式"] button').filter({ hasText: "预览" }).first().click();
  await sleep(1200);
  await shot(page, "650", "annotate2-file-open");

  // 2. 划词（拖选前半句）
  const para = await page.evaluate(() => {
    const el = [...document.querySelectorAll("p")].find((e) => e.offsetParent && e.textContent?.includes("批注投影验证"));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y + r.height / 2, w: r.width };
  });
  await page.mouse.move(para.x + 6, para.y);
  await page.mouse.down();
  await page.mouse.move(para.x + Math.min(130, para.w * 0.5), para.y, { steps: 8 });
  await page.mouse.up();
  await sleep(1100);
  await shot(page, "651", "annotate2-selected");

  // 3. 浮动条 → 添加（JS 直点防遮挡）
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector("button.preview-annotate-floating__btn");
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log("FLOAT_CLICKED", clicked);
  await sleep(900);
  await shot(page, "652", "annotate2-modal");
  const ta = page.locator('textarea[placeholder="输入批注说明"]');
  if (await ta.count()) {
    await ta.fill("下划线投影验证批注。");
    await page.locator(".text-prompt-modal button").filter({ hasText: "添加" }).last().click();
    await sleep(1200);
  }
  // 4. chip 出现 → 发送（keyring 已解锁，链路应通）
  const chip = await page.evaluate(() => [...document.querySelectorAll("[class*=chip]")].filter((c) => c.offsetParent).map((c) => c.textContent?.slice(0, 30)).slice(0, 3));
  console.log("CHIP", JSON.stringify(chip));
  const SENT_TEXT = "批注落库验证消息";
  await sendMessage(page, SENT_TEXT);
  await sleep(1500);
  await shot(page, "653", "annotate2-sent");

  // 4.5 发送后附件断言：带超时的重试式读取——先等「最近一条 user 消息」文本匹配本次发送内容
  // （确认落库渲染的是本条而非发送前的旧消息），再验该消息的批注附件（MessageAttachmentGroupCard
  // 的「消息附件」分组卡片）。超时不抛异常，只记录断言结果供 D-15 定性，后续下划线投影验证继续跑。
  let attachAssert = { matched: false, hasAttach: false, detail: "no-attempt" };
  for (let i = 0; i < 30 && !attachAssert.matched; i++) {
    attachAssert = await page.evaluate((needle) => {
      const msgs = [...document.querySelectorAll(".chat-message--user")].filter((m) => m.offsetParent);
      const last = msgs[msgs.length - 1] ?? null;
      if (!last) return { matched: false, hasAttach: false, detail: "no-user-msg" };
      const text = last.querySelector(".chat-message__body")?.textContent ?? "";
      if (!text.includes(needle)) return { matched: false, hasAttach: false, detail: "stale:" + text.slice(0, 40) };
      const grp = last.querySelector(".chat-message__attach-group");
      return { matched: true, hasAttach: !!grp, detail: grp?.querySelector("summary")?.textContent ?? "no-attach-group" };
    }, SENT_TEXT);
    if (!attachAssert.matched) await sleep(500);
  }
  console.log("ATTACH_ASSERT", JSON.stringify(attachAssert));

  // 5. 重开文件看下划线
  await node.click();
  await sleep(1500);
  await shot(page, "654", "annotate2-underline");
  const marks = await page.evaluate(() => ({
    r6o: document.querySelectorAll(".r6o-annotation, [data-annotator-id]").length,
    underlines: [...document.querySelectorAll("u, mark, [class*=underline]")].filter((e) => e.offsetParent && e.textContent?.includes("批注投影")).length,
    bodyHas: document.body.textContent?.includes("批注投影验证正文"),
  }));
  console.log("MARKS", JSON.stringify(marks));

  // 6. 若有下划线元素 → 点开详情
  if (marks.r6o > 0 || marks.underlines > 0) {
    await page.evaluate(() => {
      const el = document.querySelector(".r6o-annotation, [data-annotator-id], u");
      el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await sleep(1100);
    await shot(page, "655", "annotate2-detail");
    const detail = await page.evaluate(() => document.querySelector(".text-prompt-modal")?.textContent?.slice(0, 150) ?? null);
    console.log("DETAIL", JSON.stringify(detail));
  }

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 400));
  try { await page.screenshot({ path: "/tmp/ann-err.png" }); } catch {}
}
await shutdown(app, vite, mock);
console.log("ANNOTATE2_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 3)));
