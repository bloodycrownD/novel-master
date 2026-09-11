/**
 * Step 8：设置导航守卫纯函数单测（spec 单元测试段）。
 * 覆盖 shouldGuardSettingsNav 的两类拦截（卸载型 / ref 覆写型）与放行分支，
 * 以及 isSameSkillRef 的三元组等价判定。
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { SettingsViewId } from "@/features/settings/settings-nav";
import {
  isSameSkillRef,
  shouldGuardSettingsNav,
} from "@/features/settings/settings-nav";
import type { SkillRefDto } from "@shared/ipc-types";

const globalRef = (name: string): SkillRefDto => ({ domain: "global", name });
const projectRef = (projectId: string, name: string): SkillRefDto => ({
  domain: "project",
  projectId,
  name,
});

const dirtyOf = (...views: SettingsViewId[]): ReadonlySet<SettingsViewId> =>
  new Set(views);

// ---------- isSameSkillRef：三元组等价判定 ----------

test("isSameSkillRef: 双方均缺省视为等价（同三元组重入的缺省侧）", () => {
  assert.equal(isSameSkillRef(undefined, undefined), true);
});

test("isSameSkillRef: 单侧缺省不等价", () => {
  assert.equal(isSameSkillRef(globalRef("deploy"), undefined), false);
  assert.equal(isSameSkillRef(undefined, globalRef("deploy")), false);
});

test("isSameSkillRef: 三元组完全一致才等价，任一字段不同即不等价", () => {
  assert.equal(
    isSameSkillRef(projectRef("p1", "deploy"), projectRef("p1", "deploy")),
    true,
  );
  // domain 不同
  assert.equal(
    isSameSkillRef(globalRef("deploy"), projectRef("p1", "deploy")),
    false,
  );
  // projectId 不同
  assert.equal(
    isSameSkillRef(projectRef("p1", "deploy"), projectRef("p2", "deploy")),
    false,
  );
  // name 不同
  assert.equal(
    isSameSkillRef(projectRef("p1", "deploy"), projectRef("p1", "review")),
    false,
  );
  // project 域两侧都缺 projectId 时仅比 domain + name
  const noProjectId = { domain: "project", name: "deploy" } as SkillRefDto;
  assert.equal(isSameSkillRef(noProjectId, { ...noProjectId }), true);
});

// ---------- shouldGuardSettingsNav：卸载型 ----------

test("卸载型: 切走 dirty view → 拦截（卸载前须先弹确认）", () => {
  // 返回（退栈到 skillsManage）
  assert.equal(
    shouldGuardSettingsNav({
      currentViewId: "skillDetail",
      dirtyViews: dirtyOf("skillDetail"),
      nextViewId: "skillsManage",
      viewingSkillRef: projectRef("p1", "deploy"),
    }),
    true,
  );
  // 关闭（固定回 workspace）
  assert.equal(
    shouldGuardSettingsNav({
      currentViewId: "agentEditor",
      dirtyViews: dirtyOf("agentEditor"),
      nextViewId: "workspace",
    }),
    true,
  );
});

test("卸载型: 当前 view 非 dirty → 放行", () => {
  assert.equal(
    shouldGuardSettingsNav({
      currentViewId: "agentEditor",
      dirtyViews: dirtyOf(),
      nextViewId: "workspace",
    }),
    false,
  );
});

test("卸载型: dirty 的是别的 view、当前 view 干净 → 放行（不误报）", () => {
  // dirtyViews 里残留的是其它 view 的标记（如 agentEditor），当前 providers 干净
  assert.equal(
    shouldGuardSettingsNav({
      currentViewId: "providers",
      dirtyViews: dirtyOf("agentEditor"),
      nextViewId: "workspace",
    }),
    false,
  );
});

// ---------- shouldGuardSettingsNav：ref 覆写型 ----------

test("ref 覆写型: skillDetail→skillDetail 且三元组不同 + dirty → 拦截（reload 会覆盖编辑 state）", () => {
  assert.equal(
    shouldGuardSettingsNav({
      currentViewId: "skillDetail",
      dirtyViews: dirtyOf("skillDetail"),
      nextViewId: "skillDetail",
      viewingSkillRef: projectRef("p1", "deploy"),
      incomingSkillRef: projectRef("p1", "review"),
    }),
    true,
  );
  // global 域 → project 域的跨域跳转同样拦截
  assert.equal(
    shouldGuardSettingsNav({
      currentViewId: "skillDetail",
      dirtyViews: dirtyOf("skillDetail"),
      nextViewId: "skillDetail",
      viewingSkillRef: globalRef("deploy"),
      incomingSkillRef: projectRef("p1", "deploy"),
    }),
    true,
  );
});

test("ref 覆写型: 同三元组重入 → 放行（不触发 reload，弹窗属误报）", () => {
  assert.equal(
    shouldGuardSettingsNav({
      currentViewId: "skillDetail",
      dirtyViews: dirtyOf("skillDetail"),
      nextViewId: "skillDetail",
      viewingSkillRef: projectRef("p1", "deploy"),
      incomingSkillRef: projectRef("p1", "deploy"),
    }),
    false,
  );
});

test("ref 覆写型: 非 dirty 时不同三元组跳转 → 放行（无数据可丢）", () => {
  assert.equal(
    shouldGuardSettingsNav({
      currentViewId: "skillDetail",
      dirtyViews: dirtyOf(),
      nextViewId: "skillDetail",
      viewingSkillRef: projectRef("p1", "deploy"),
      incomingSkillRef: projectRef("p2", "deploy"),
    }),
    false,
  );
});

test("ref 覆写型仅限 skillDetail: 非 skillDetail 的同 view 导航 + dirty → 放行", () => {
  // 守卫的 ref 覆写分支要求 currentViewId === "skillDetail"；
  // 其它 view 的同 view 重入不卸载、无 ref 覆写，不拦截
  assert.equal(
    shouldGuardSettingsNav({
      currentViewId: "providers",
      dirtyViews: dirtyOf("providers"),
      nextViewId: "providers",
    }),
    false,
  );
});

// ---------- 边界 ----------

test("边界: 不带 incomingSkillRef 的导航只看卸载型分支", () => {
  // 即使 viewingSkillRef 存在、dirty 且 next 也是 skillDetail，
  // 动作不覆写 ref（incomingSkillRef 缺省）时不走覆写判定
  assert.equal(
    shouldGuardSettingsNav({
      currentViewId: "skillDetail",
      dirtyViews: dirtyOf("skillDetail"),
      nextViewId: "skillDetail",
      viewingSkillRef: projectRef("p1", "deploy"),
    }),
    false,
  );
});

test("边界: 卸载型分支优先——skillDetail dirty 且切走时，incomingSkillRef 不影响拦截结论", () => {
  // 切走即卸载，第一分支已拦截；此时即便带了不同的 incomingSkillRef 也不改变结果
  assert.equal(
    shouldGuardSettingsNav({
      currentViewId: "skillDetail",
      dirtyViews: dirtyOf("skillDetail"),
      nextViewId: "skillsManage",
      viewingSkillRef: projectRef("p1", "deploy"),
      incomingSkillRef: projectRef("p2", "deploy"),
    }),
    true,
  );
});

test("边界: dirtyViews 含多个 view 标记时只看 currentViewId", () => {
  // 同一时刻可能多个 view 曾上报 dirty（异常残留场景），
  // 守卫只对当前挂载 view 的标记负责
  assert.equal(
    shouldGuardSettingsNav({
      currentViewId: "modelSampling",
      dirtyViews: dirtyOf("agentEditor", "skillDetail", "modelSampling"),
      nextViewId: "providerDetail",
    }),
    true,
  );
  assert.equal(
    shouldGuardSettingsNav({
      currentViewId: "providerDetail",
      dirtyViews: dirtyOf("agentEditor", "skillDetail"),
      nextViewId: "agentEditor",
    }),
    false,
  );
});

test("综合: 编程式技能跳转被拦截 → 确认后 dirty 清空 → 重跳放行", () => {
  // 阶段一：skillDetail(p1/deploy) dirty，收到跳转 p1/review → 拦截
  const dirty = new Set<SettingsViewId>(["skillDetail"]);
  const guarded = shouldGuardSettingsNav({
    currentViewId: "skillDetail",
    dirtyViews: dirty,
    nextViewId: "skillDetail",
    viewingSkillRef: projectRef("p1", "deploy"),
    incomingSkillRef: projectRef("p1", "review"),
  });
  assert.equal(guarded, true);

  // 阶段二：用户确认丢弃，view 清掉 dirty 标记后同一跳转重发 → 放行
  dirty.delete("skillDetail");
  assert.equal(
    shouldGuardSettingsNav({
      currentViewId: "skillDetail",
      dirtyViews: dirty,
      nextViewId: "skillDetail",
      viewingSkillRef: projectRef("p1", "deploy"),
      incomingSkillRef: projectRef("p1", "review"),
    }),
    false,
  );
});
