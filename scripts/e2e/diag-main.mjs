import { launchApp, shutdown } from "./lib.mjs";
const { app, page, vite } = await launchApp();
try {
  const info = await app.evaluate(() => {
    const keys = Object.keys(globalThis).filter((k) => /electron|dialog|require|module|process/i.test(k));
    let dialogBinding = null;
    try { dialogBinding = Object.keys(process._linkedBinding("electron_browser_dialog") ?? {}); } catch (e) { dialogBinding = "ERR " + e.message; }
    return { keys: keys.slice(0, 15), dialogBinding };
  });
  console.log("MAIN_INFO", JSON.stringify(info));
} catch (e) { console.log("EVAL_ERR", String(e).slice(0, 200)); }
await shutdown(app, vite);
