// 补验：批注划词→添加→发送落库→重开文件看下划线投影
import { launchApp, shutdown, startMock, shot, goToProjects, sendMessage } from "./lib.mjs";

const errors = [];
const mock = await startMock();
const { app, page, vite } = await launchApp({ errors });
const sleep = (ms) => page.waitForTimeout(ms);

try {
  await page.waitForLoadState("domcontentloaded");
  await sleep(3500);
  const composer = page.locator('textarea[aria-label="消息输入"]');
  if (!(await composer.count())) {
    await goToProjects(page);
    await page.locator("li:visible").filter({ hasText: "回归项目A" }).first().click();
    await sleep(700);
    await page.locator("#session-list li:visible").first().click();
    await sleep(1100);
  }

  // 1. 建文件写正文
  await page.mouse.click(640, 300, { button: "right" });
  await sleep(700);
  await page.locator('[data-workspace-action="create-file"]').first().click();
  await sleep(700);
  await page.locator("input:visible").first().fill("批注验证.md");
  await page.locator("button:visible").filter({ hasText: /^确定$|^创建$/ }).first().click();
  await sleep(1000);
  const node = page.locator(".tree-node").filter({ hasText: "批注验证.md" }).first();
  if (!(await node.count())) throw new Error("file not created");
  await node.click();
  await sleep(1000);
  await page.locator('[aria-label="预览模式"] button').filter({ hasText: "编辑" }).first().click();
  await sleep(900);
  const cm = page.locator(".cm-content").first();
  await cm.click();
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
  await sendMessage(page, "批注落库验证消息");
  await sleep(1500);
  await shot(page, "653", "annotate2-sent");

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
