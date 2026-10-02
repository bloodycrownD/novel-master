/**
 * T-CA5（mobile 侧）：预览口径 parity —— buildSessionPromptInput（预览路径）
 * 在 definition 带 customAttach 时，产出的 messages 里含 <extra-info> 块。
 *
 * 预览路径（buildSessionPromptInput）与真实路径（agent-runner）最终都经
 * prepareUserMessagesForPrompt → wrapUserMessageForLlm，所以只要断言预览路径
 * 注入了 extra-info 块，就能守住「UI 预览与发给模型的提示词在 extra-info 段上一致」。
 *
 * r3-chip-1 / r3-test-1 ④：build 段分段弃权检查点（shouldBail 命中即抛
 * ChatPromptBuildBailedError，后续段不得执行）。这两组用例都**不整体 mock**
 * buildSessionPromptInput——真跑本文件的分段逻辑，只 mock 最底层 IO
 * （messages.listBySession / sessionVkv / vfs），段与段的边界用各段内部依赖
 * 的调用与否钉住。
 *
 * fixture 两种形态（r4-app-3：检查点计数不许依赖「组装恰好短路」这个隐形前提）：
 * - **最小形态**（缺省；T-CA5 与「不传 shouldBail」用例）：workplace layout
 *   不开 → assembleWorkplaceDisplay 短路，组装段的 shouldStop 一次都不问；
 *   user 消息无附件 → prepare 内不触 vfs/sessionKkv。
 * - **组装参与形态**（`workplaceFiles` 非空；分段弃权用例）：workplace 块
 *   真开，组装段真跑（规则快照 → evaluateRuleView → file_cache 预取命中 →
 *   逐文件渲染），组装内 shouldStop（快照加载后 1 次 + 每文件 1 次）真实
 *   发生。检查点序号与总数按「build 段界 4 道 + 组装内 1 + N」写死。
 * - **S0 双读形态**（`workplaceStatuses` 混合 full/header + 带附件的历史
 *   消息；S0 双读用例）：组装照上条真跑并分出 `prefixPaths`（仅 full 档）与
 *   `visiblePaths`（全量档），prepare 段照常 hydrate 附件。
 */
import {describe, expect, it, jest} from '@jest/globals';
import {textBlocks} from '@novel-master/core/chat';
import {buildDefaultAgentDefinitionPreservingName} from '@novel-master/core/config-forms/stored-config-validity';

import {
  buildSessionPromptInput,
  ChatPromptBuildBailedError,
} from '@/services/session-prompt-input.service';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

/** 从消息 content（{ blocks: [...] }）里拼出纯文本，供断言关键字。 */
function bodyText(content: unknown): string {
  if (
    content == null ||
    typeof content !== 'object' ||
    !Array.isArray((content as {blocks?: unknown}).blocks)
  ) {
    return '';
  }
  return (content as {blocks: unknown[]}).blocks
    .map(block =>
      block != null &&
      typeof block === 'object' &&
      (block as {type?: string}).type === 'text'
        ? String((block as {text?: unknown}).text ?? '')
        : '',
    )
    .join('\n');
}

/** 组装参与形态的规则文件（快照行顺序）；数量直接进入检查点计数公式。 */
const WORKPLACE_FILES = ['/规则/玩法.md', '/规则/文风.md'] as const;

/** 规则文件的展示档位（S0 双读用例要 full 档 + header 档各一）。 */
type WorkplaceStatus = 'full' | 'header' | 'filename';

/**
 * runtime stub（只搭最底层 IO，段内逻辑全真跑）。
 *
 * @param options.workplaceFiles 非空时开 workplace 块并让组装段真跑
 *   （r4-app-3）：`workplace.evaluateRuleView` 给出这批 file 行、
 *   `sessionKkv.getMany` 直接命中 file_cache 预取（不触 vfs、不排后台
 *   回填），组装内按文件粒度的 shouldStop 检查点因此真实发生。
 * @param options.workplaceStatuses 逐文件覆盖展示档位（缺省全 `full`）。
 *   与 `evaluateRuleView` 的 displayState、`file_cache` 预取键（`{status}:{path}`）
 *   三处同源——档位写错的话 assemble 的 `prefixPaths`/`visiblePaths` 分家就跟着错。
 * @param options.messages 覆盖 `listBySession` 的返回（缺省一条无附件消息）。
 * @param options.vfsBodies `sessionVfs().read` 的正文表（缺省按 path 现编）。
 *   prepare 侧 attach 附件 hydrate 走「file_cache miss → 读 vfs」这条路。
 */
function makeStubRuntime(options?: {
  readonly workplaceFiles?: readonly string[];
  readonly workplaceStatuses?: Readonly<Record<string, WorkplaceStatus>>;
  readonly messages?: readonly unknown[];
  readonly vfsBodies?: Readonly<Record<string, string>>;
}): MobileNovelMasterRuntime {
  const workplaceFiles = options?.workplaceFiles ?? [];
  const statusOf = (path: string): WorkplaceStatus =>
    options?.workplaceStatuses?.[path] ?? 'full';
  /** 组装段的第一笔输入：快照 miss → evaluateRuleView 的返回值。 */
  const ruleView = {
    rows: workplaceFiles.map(path => ({
      kind: 'file' as const,
      path,
      inclusionMode: 'show' as const,
      displayState: statusOf(path),
    })),
    displayByPath: new Map(
      workplaceFiles.map(path => [path, statusOf(path)] as const),
    ),
  };
  /** file_cache 预取命中（键形如 `{status}:{path}`，与 fileCacheKey 同形）。 */
  const prefetched = new Map(
    workplaceFiles.map(path => [
      `${statusOf(path)}:${path}`,
      JSON.stringify({body: `# ${path}\n规则正文`, mtimeMs: 1000}),
    ]),
  );
  const defaultMessages = [
    {
      id: 'm1',
      sessionId: 's1',
      role: 'user',
      content: textBlocks('你好，请记住附加信息'),
      attachments: [],
      hidden: false,
    },
  ];
  return {
    messages: {
      listBySession: jest.fn(async () => options?.messages ?? defaultMessages),
    },
    state: {},
    workplace: jest.fn(() => ({
      evaluateRuleView: jest.fn(async () => ruleView),
    })),
    // 只搭 read：prepare 侧 attach hydrate 需要它。刻意**不**给
    // findContentSize —— 真实 VFS 缺该方法时读侧降级回 vfs.read，
    // 这里保持同款降级路径。
    sessionVfs: jest.fn(() => ({
      read: jest.fn(async (path: string) => ({
        content: options?.vfsBodies?.[path] ?? `VFS-BODY ${path}`,
        mtimeMs: 1000,
      })),
    })),
    // skillAttach hydrate 用的技能服务工厂；本用例消息无 skillAttach 附件，
    // prepare 惰性预算不会真正调用，给个空壳即可。
    skills: jest.fn(() => ({})),
    sessionKkv: {
      get: jest.fn(async () => null),
      getMany: jest.fn(async () => prefetched),
      set: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
      clearSession: jest.fn(async () => undefined),
      listKeys: jest.fn(async () => []),
    },
  } as unknown as MobileNovelMasterRuntime;
}

describe('buildSessionPromptInput (T-CA5 mobile)', () => {
  it('definition.prompts.customAttach 非空时预览路径 messages 含 <extra-info> 块', async () => {
    const runtime = makeStubRuntime();
    const definition =
      buildDefaultAgentDefinitionPreservingName('extra-info-agent');
    // 与 domain prompts.customAttach 对齐；wrap 阶段在 </user-ops> 后注入 <extra-info>。
    definition.prompts = {
      ...definition.prompts,
      customAttach: '这是常驻附加信息：优先级最高',
    };

    const bundle = await buildSessionPromptInput(
      runtime,
      {projectId: 'p1', sessionId: 's1'},
      definition,
    );

    const userBody = bundle.ctx.messages
      .filter(m => m.role === 'user')
      .map(m => bodyText(m.content))
      .join('\n');

    expect(userBody).toMatch(/<extra-info>/);
    expect(userBody).toMatch(/这是常驻附加信息：优先级最高/);
  });
});

describe('buildSessionPromptInput 分段弃权检查点（r3-test-1 ④）', () => {
  /**
   * 段序（与实现一一对应，含组装段内部检查点）：resolve agent → messages →
   * workplace（组装内：快照加载后 1 次 + 每文件 1 次）→ prepare。
   *
   * 检查点序号（N = {@link WORKPLACE_FILES} 的个数）：
   * 1 = resolve 后；2 = messages 后；3..(2+N) = 组装内；
   * (4+N) = 组装段后（build 的第三道段界）；(5+N) = prepare 后（第四道）。
   * 组装真跑 ⇒ 序号与总数都含这 N 次逐文件检查，不随「组装短路」漂移。
   */
  const N = WORKPLACE_FILES.length;
  /** 组装内检查点数：快照加载后 1 次 + 每文件 1 次。 */
  const ASSEMBLY_CHECKPOINTS = N + 1;
  /** 恒假弃权开关下一轮问过的检查点总数 = build 段界 4 道 + 组装内。 */
  const TOTAL_CHECKPOINTS = 4 + ASSEMBLY_CHECKPOINTS;

  /** 组装参与形态的 runtime（开 workplace 块；见文件头 fixture 形态说明）。 */
  const makeBailRuntime = (): MobileNovelMasterRuntime =>
    makeStubRuntime({workplaceFiles: WORKPLACE_FILES});

  const makeBailDefinition = () => {
    const definition = buildDefaultAgentDefinitionPreservingName('bail-agent');
    // 显式开 workplace 块：不这样的话组装短路、检查点只剩 build 的 4 道，
    // 断言含义就跟着 fixture 形态跑了（r4-app-3）。
    definition.prompts = {...definition.prompts, workplace: '【工作区】'};
    return definition;
  };

  const buildWithBailAt = async (bailAtCall: number) => {
    const runtime = makeBailRuntime();
    const definition = makeBailDefinition();
    let calls = 0;
    const observed = {
      listBySession: () => (runtime.messages.listBySession as jest.Mock).mock.calls.length,
      workplace: () => (runtime.workplace as jest.Mock).mock.calls.length,
      sessionVfs: () => (runtime.sessionVfs as jest.Mock).mock.calls.length,
      skills: () => (runtime.skills as jest.Mock).mock.calls.length,
      // 组装段的 file_cache 批量预取次数（> 0 即证明组装真跑进了文件循环）。
      prefetch: () =>
        (runtime.sessionKkv.getMany as jest.Mock).mock.calls.length,
    };
    const shouldBail = () => {
      calls += 1;
      return calls === bailAtCall;
    };
    const promise = buildSessionPromptInput(
      runtime,
      {projectId: 'p1', sessionId: 's1'},
      definition,
      {shouldBail},
    );
    return {promise, observed, bailCalls: () => calls};
  };

  it('弃权开关恒假：build 走完全程，全部检查点各问一次', async () => {
    const runtime = makeBailRuntime();
    const definition = makeBailDefinition();
    const shouldBail = jest.fn(() => false);
    const bundle = await buildSessionPromptInput(
      runtime,
      {projectId: 'p1', sessionId: 's1'},
      definition,
      {shouldBail},
    );
    expect(bundle.input).toBeDefined();
    // 构成：build 的四道段界检查点（resolve 后 / messages 后 / 组装后 /
    // prepare 后）+ 组装内 shouldStop（快照加载后 1 次 + 每文件 1 次）。
    // 本夹具 N=2，实测总数 = 4 + 3 = 7（开块前是 4）。
    expect(shouldBail).toHaveBeenCalledTimes(TOTAL_CHECKPOINTS);
    // 前提：组装段真的跑了（否则总数退化成 4，断言就不表达「组装参与」了）。
    expect(runtime.workplace as jest.Mock).toHaveBeenCalledTimes(1);
    expect(runtime.sessionKkv.getMany as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('第 1 段翻真（agent 解析后）：抛 ChatPromptBuildBailedError，消息段未执行', async () => {
    const {promise, observed} = await buildWithBailAt(1);
    await expect(promise).rejects.toBeInstanceOf(ChatPromptBuildBailedError);
    expect(observed.listBySession()).toBe(0);
    expect(observed.prefetch()).toBe(0);
  });

  it('第 2 段翻真（消息拉取后）：抛错，workplace 段未执行', async () => {
    const {promise, observed} = await buildWithBailAt(2);
    await expect(promise).rejects.toBeInstanceOf(ChatPromptBuildBailedError);
    expect(observed.listBySession()).toBe(1);
    expect(observed.workplace()).toBe(0);
    expect(observed.skills()).toBe(0);
    expect(observed.prefetch()).toBe(0);
  });

  it('第 3 段翻真（workplace 组装后）：抛错，prepare 段未执行', async () => {
    // 第 (4+N) 次 = 组装内检查点问完之后、build 的第三道段界。
    const {promise, observed} = await buildWithBailAt(4 + N);
    await expect(promise).rejects.toBeInstanceOf(ChatPromptBuildBailedError);
    expect(observed.workplace()).toBe(1);
    expect(observed.sessionVfs()).toBe(1);
    // 前提：组装真跑进了文件循环（否则这道「组装后」的段界是空的）。
    expect(observed.prefetch()).toBe(1);
    // prepare 的入参（含 skills()）整段未求值
    expect(observed.skills()).toBe(0);
  });

  it('第 4 段翻真（prepare 后）：抛错，layout 组装段未执行', async () => {
    // 第 (5+N) 次 = prepare 跑完、build 的第四道（最后一道）段界。
    const {promise, observed, bailCalls} = await buildWithBailAt(5 + N);
    await expect(promise).rejects.toBeInstanceOf(ChatPromptBuildBailedError);
    expect(observed.skills()).toBe(1);
    expect(observed.prefetch()).toBe(1);
    // 只问了 5+N 次（= 4 道段界 + 组装内 1+N）：第 4 道段界之后没有 layout
    // 段的检查点，也没有落库式副作用。
    expect(bailCalls()).toBe(TOTAL_CHECKPOINTS);
  });

  it('不传 shouldBail：行为不变（预览等非 chip 消费方不受弃权影响）', async () => {
    const runtime = makeStubRuntime();
    const definition = buildDefaultAgentDefinitionPreservingName('plain-agent');
    const bundle = await buildSessionPromptInput(
      runtime,
      {projectId: 'p1', sessionId: 's1'},
      definition,
    );
    expect(bundle.rawMessages).toHaveLength(1);
    expect(bundle.input).toBeDefined();
  });
});

/**
 * S0 双读接线（d-s0/G-1）：三处装配点（agent-runner / desktop / mobile
 * 的 session-prompt-input）都靠这两个字段把 assemble 的产物交给 prepare——
 * `seenPaths: prefixPaths`（仅 full 档，attach 去重）、`workplaceSeenPaths:
 * visiblePaths`（全量可见档，workplace 省略判定）。接线正确但**零断言**时，
 * 删掉任一字段全部照绿，workplaceSeen 静默回落 seenPaths（只含 full 档），
 * G6 修的洞以静默倒退回归。
 *
 * 本用例不整体 mock buildSessionPromptInput：stub runtime 的
 * `evaluateRuleView` 产出 full 档 + header 档各一，让组装真分家，再由
 * `listBySession` 返回带附件的历史消息，看 prepare 后的附件正文。
 * 删掉任一接线字段，断言①/② 之一必红。
 */
describe('buildSessionPromptInput S0 双读接线（d-s0/G-1）', () => {
  /** 复用既有 harness 的路径常量：一个 full 档、一个 header 档。 */
  const FULL_PATH = WORKPLACE_FILES[0];
  const HEADER_PATH = WORKPLACE_FILES[1];

  it('workplace 附件被省略（visiblePaths 已接线）、attach 附件拿到全文（prefixPaths 只吃 full 档）', async () => {
    const runtime = makeStubRuntime({
      workplaceFiles: WORKPLACE_FILES,
      workplaceStatuses: {[FULL_PATH]: 'full', [HEADER_PATH]: 'header'},
      messages: [
        {
          id: 'wp1',
          sessionId: 's1',
          role: 'user',
          content: textBlocks('历史 workplace 附件'),
          hidden: false,
          attachments: [
            {
              name: HEADER_PATH,
              source: 'workplace',
              type: 'text',
              content: null,
              path: HEADER_PATH,
            },
          ],
        },
        {
          id: 'at1',
          sessionId: 's1',
          role: 'user',
          content: textBlocks('再引一次'),
          hidden: false,
          attachments: [
            {
              name: HEADER_PATH,
              source: 'attach',
              type: 'text',
              content: null,
              path: HEADER_PATH,
            },
          ],
        },
      ],
      vfsBodies: {[HEADER_PATH]: 'HEADER-BODY'},
    });
    const definition = buildDefaultAgentDefinitionPreservingName('s0-agent');
    // 显式开 workplace 块：不开则组装短路，两集合恒为 []，本用例没有牙齿。
    definition.prompts = {...definition.prompts, workplace: '【工作区】'};

    const bundle = await buildSessionPromptInput(
      runtime,
      {projectId: 'p1', sessionId: 's1'},
      definition,
    );

    const [workplaceMsg, attachMsg] = bundle.ctx.messages;
    // ① workplace 侧读 workplaceSeen（= visiblePaths，全量可见档）：header
    //    档也命中 ⇒ 省略（content 置空，wrap 时不重复注入）。
    expect(workplaceMsg?.attachments?.[0]?.content).toBe('');
    // ② attach 侧读 seen（= prefixPaths，仅 full 档）：header 档不在其中
    //    ⇒ 拿全文，而不是 alreadyReferenced 短提示。
    const attachBody = attachMsg?.attachments?.[0]?.content ?? '';
    expect(attachBody).toContain('HEADER-BODY');
    expect(attachBody).not.toContain('alreadyReferenced');
  });
});
