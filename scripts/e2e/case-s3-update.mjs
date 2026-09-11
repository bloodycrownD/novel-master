// R7-2: 云同步 S3 表单/测试连接错误态 + 检查更新 + 菜单栏 + 三栏拖拽
import { launchApp, shutdown, shot, dismissUpdatePrompt } from "./lib.mjs";

const errors = [];
const { app, page, vite } = await launchApp({ errors });
const sleep = (ms) => page.waitForTimeout(ms);

try {
  await page.waitForLoadState("domcontentloaded");
  await sleep(3500);

  // ===== 1. S3 表单 + 测试连接（假 endpoint → 错误态）=====
  await page.click('button[aria-label="打开设置"]');
  await sleep(800);
  await page.locator('[data-settings-nav="dataManagement"]').click();
  await sleep(900);
  // 启用云同步开关 → 展开 S3 配置表单
  const enableCb = page.locator('.settings-view input[aria-label="启用云同步"]');
  const enableCb2 = page.locator('.settings-view input[type="checkbox"]:visible').first();
  const cb = (await enableCb.count()) ? enableCb : enableCb2;
  if (await cb.count()) {
    await page.evaluate(() => {
      const inp = document.querySelector('input[aria-label="启用云同步"]') ?? document.querySelector('.settings-view input[type="checkbox"]');
      (inp?.closest("label") ?? inp?.parentElement ?? inp)?.click() ?? inp?.click();
    });
    await sleep(1200);
  }
  await shot(page, "630", "cloud-sync-form");
  const s3dump = await page.evaluate(() => ({
    inputs: [...document.querySelectorAll(".settings-view input")].filter((i) => i.offsetParent).map((i) => ({ ph: i.placeholder, type: i.type, aria: i.getAttribute("aria-label") })).slice(0, 10),
    btns: [...document.querySelectorAll(".settings-view button")].filter((b) => b.offsetParent).map((b) => b.textContent?.trim().slice(0, 12)).filter(Boolean).slice(0, 12),
  }));
  console.log("S3_FORM", JSON.stringify(s3dump).slice(0, 500));

  // 填假配置：Endpoint/Bucket/AK/SK（按 placeholder/顺序）
  const s3inputs = page.locator(".settings-view input:visible");
  const n = await s3inputs.count();
  console.log("S3_INPUT_COUNT", n);
  const fillByHint = async (hint, val) => {
    for (let i = 0; i < n; i++) {
      const ph = (await s3inputs.nth(i).getAttribute("placeholder")) || "";
      const v = await s3inputs.nth(i).inputValue();
      if (ph.includes(hint) || v.includes(hint)) { await s3inputs.nth(i).fill(val); return true; }
    }
    return false;
  };
  await fillByHint("Endpoint", "http://127.0.0.1:9");
  await fillByHint("Bucket", "nm-e2e");
  await fillByHint("Access", "AKIAFAKE");
  await fillByHint("Secret", "SKFAKE");
  await shot(page, "631", "s3-filled");
  const testBtn = page.locator(".settings-view button:visible").filter({ hasText: "测试连接" }).first();
  if (await testBtn.count()) {
    await testBtn.click();
    await sleep(4000); // 假 endpoint 连接超时
    await shot(page, "632", "s3-test-failed");
    const failState = await page.evaluate(() => ({
      toast: document.querySelector(".shell-toast.is-visible")?.textContent?.slice(0, 120) ?? null,
      inlineErr: [...document.querySelectorAll(".settings-view [class*=error], .settings-view [class*=status]")].filter((e) => e.offsetParent).map((e) => e.textContent?.slice(0, 60)).slice(0, 3),
    }));
    console.log("S3_TEST_FAIL", JSON.stringify(failState));
  }

  // ===== 2. 检查更新（关于页）=====
  await page.locator('[data-settings-nav="about"]').click();
  await sleep(900);
  const updBtn = page.locator(".settings-view button:visible").filter({ hasText: "检查更新" }).first();
  if (await updBtn.count()) {
    await updBtn.click();
    await sleep(4000);
    await shot(page, "633", "update-check-result");
    const updState = await page.evaluate(() => ({
      modal: document.querySelector("[class*=update], .confirm-modal")?.textContent?.slice(0, 150) ?? null,
      toast: document.querySelector(".shell-toast.is-visible")?.textContent?.slice(0, 100) ?? null,
    }));
    console.log("UPDATE_STATE", JSON.stringify(updState));
  }

  // ===== 3. 三栏宽度拖拽 =====
  // 第 2 段「检查更新」的弹窗可能还开着（运行中弹出，lib 的启动兜底不覆盖）：
  // ①「版本检查」结果弹窗（snooze/关闭）②「发现新版本」升级确认弹窗（稍后）。
  // 不先清掉会挡住「关闭设置」→ 设置页残留 → splitter 不可见 boundingBox 返回 null
  await dismissUpdatePrompt(page, 3000).catch(() => {});
  const later = page.locator(".update-modal button").filter({ hasText: "稍后" }).first();
  if (await later.count()) { await later.click().catch(() => {}); await sleep(600); }
  await page.click('button[aria-label="关闭设置"]').catch(() => page.keyboard.press("Escape"));
  await sleep(800);
  const splitter = page.locator('[data-splitter]').first();
  if (await splitter.count()) {
    // 拖拽前后各取一份列宽快照，按列差值判定拖拽是否生效；旧实现两份快照都取在
    // mouse.up 之后（b0c 与 b1 间无 DOM 变化，changed 恒 false），b0 总宽快照从未使用一并移除
    const colWidths = () => page.evaluate(() =>
      [...document.querySelectorAll(".workspace > *")].map((e) => Math.round(e.getBoundingClientRect().width)));
    const before = await colWidths();
    const sb = await splitter.boundingBox();
    await page.mouse.move(sb.x + sb.width / 2, sb.y + 200);
    await page.mouse.down();
    await page.mouse.move(sb.x - 120, sb.y + 200, { steps: 8 });
    await page.mouse.up();
    await sleep(700);
    const after = await colWidths();
    const diff = after.map((w, i) => (before[i] != null ? w - before[i] : null));
    const changed = before.length === after.length && diff.some((d) => d != null && Math.abs(d) >= 1);
    console.log("SPLITTER_BEFORE", before.join(","));
    console.log("SPLITTER_AFTER", after.join(","), "changed:", changed, "diff:", diff.join(","));
    await shot(page, "634", "splitter-dragged");
  }

  console.log("MENU_NATIVE_ONLY", true);

} catch (e) {
  console.log("SCRIPT_ERROR", String(e).slice(0, 400));
    process.exitCode = 1; // 静默假绿防护：断流必须非零退出
  try { await page.screenshot({ path: "/tmp/r72-err.png" }); } catch {}
}
await shutdown(app, vite);
console.log("R72_DONE errors:", errors.length, JSON.stringify(errors.slice(0, 3)));
