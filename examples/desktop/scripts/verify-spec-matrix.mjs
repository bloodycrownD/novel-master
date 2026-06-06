/**
 * Static DOM/source checks for prototype-optimization manual matrix (M-01–M-04, D-01–D-06).
 * Run: node examples/desktop/scripts/verify-spec-matrix.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..", "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const desktopHtml = read("examples/desktop/index.html");
const shellJs = read("examples/desktop/shell.js");
const mobileHtml = read("examples/mobile/index.html");
const mobileJs = read("examples/mobile/js/app.js");

/** @type {{ id: string; desc: string; pass: boolean; detail: string }[]} */
const results = [];

function check(id, desc, pass, detail) {
  results.push({ id, desc, pass, detail });
}

// Mobile matrix
check(
  "M-01",
  "底栏仅对话、我的",
  mobileHtml.includes('data-page="chat"') &&
    mobileHtml.includes('data-page="profile"') &&
    !mobileHtml.includes('data-page="agents"'),
  "chat + profile tabs present; agents tab absent"
);

check(
  "M-02",
  "我的页三区菜单",
  mobileHtml.includes('class="menu-section-title"') &&
    mobileHtml.includes("工作区") &&
    mobileHtml.includes("数据管理") &&
    mobileHtml.includes("配置"),
  "profile sections: 工作区/数据管理/配置"
);

check(
  "M-03",
  "事件配置页与保存逻辑",
  mobileHtml.includes('id="eventsConfigPage"') &&
    mobileJs.includes("renderEventsConfigPage") &&
    mobileJs.includes("save-events"),
  "eventsConfig page + save handler in mobile app.js"
);

check(
  "M-04",
  "Agent ⋮ 重命名/复制/删除，无设为默认",
  mobileJs.includes("showAgentItemMenu") &&
    mobileJs.includes("'重命名'") &&
    mobileJs.includes("action: 'duplicate'") &&
    mobileJs.includes("action: 'delete'") &&
    !mobileJs.includes("设为默认"),
  "showAgentItemMenu actions aligned with spec"
);

// Desktop matrix
check(
  "D-01",
  "三 pane 布局，无 sidebar",
  desktopHtml.includes('id="preview-pane"') &&
    desktopHtml.includes('id="explorer-pane"') &&
    desktopHtml.includes('id="chat-rail"') &&
    !desktopHtml.includes('id="sidebar"'),
  "preview-pane | explorer-pane | chat-rail"
);

check(
  "D-02",
  "默认项目列表",
  desktopHtml.includes('data-nav-view="projects"') &&
    desktopHtml.includes("data-project-id"),
  "projects nav view with project list items"
);

check(
  "D-03",
  "导航联动工作区标题",
  shellJs.includes("syncWorkspaceWithNav") &&
    shellJs.includes('global: "全局工作区"') &&
    shellJs.includes('session: "会话工作区"') &&
    shellJs.includes('chat: "聊天工作区"'),
  "NAV_TO_WORKSPACE + WORKSPACE_TITLES"
);

check(
  "D-04",
  "树文件点击更新预览",
  shellJs.includes("function showPreview") &&
    shellJs.includes("renderWorkspaceTree") &&
    shellJs.includes("workspace-context-menu"),
  "bindTreeClicks → showPreview + VFS 右键菜单"
);

check(
  "D-05",
  "服务商 settings 页列表（非 Toast 占位）",
  shellJs.includes("function renderProviders") &&
    desktopHtml.includes('id="settings-page-root"') &&
    shellJs.includes('data-action="new-provider"') &&
    !shellJs.includes("添加服务商（原型未实现）"),
  "renderProviders + new-provider in shell.js"
);

check(
  "D-06",
  "深色主题切换与持久化",
  shellJs.includes("THEME_STORAGE_KEY") &&
    shellJs.includes("function toggleTheme") &&
    desktopHtml.includes('id="theme-toggle"'),
  "toggleTheme + nm-desktop-theme localStorage"
);

// Round-2 CR must-fix static checks
check(
  "CR-1",
  "desktop agent ⋮ menu",
  shellJs.includes("data-agent-menu") &&
    shellJs.includes("showAgentItemMenu") &&
    shellJs.includes("至少保留一个 Agent"),
  "agent rename/duplicate/delete in shell.js"
);

check(
  "CR-2",
  "desktop provider create/edit",
  shellJs.includes("createNewProvider") &&
    shellJs.includes("data-provider-menu") &&
    shellJs.includes("showProviderItemMenu"),
  "provider new + rename/delete menu"
);

check(
  "CR-3",
  "save-sampling reads/writes model.settings",
  shellJs.includes("getSamplingTemperature") &&
    shellJs.includes("samplingModel.settings.sampling"),
  "model settings sampling round-trip"
);

check(
  "CR-4",
  "save-regex-rule updates store.regexRules",
  shellJs.includes("store.regexRules[groupId]") &&
    shellJs.includes("data-regex-field"),
  "regex rule persist to store"
);

let failed = 0;
for (const r of results) {
  const status = r.pass ? "PASS" : "FAIL";
  if (!r.pass) failed += 1;
  console.log(`${r.id} ${status} — ${r.desc}`);
  console.log(`     ${r.detail}`);
}

console.log("");
console.log(`Total: ${results.length}, passed: ${results.length - failed}, failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
