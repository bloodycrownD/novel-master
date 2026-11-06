/**
 * React Native prompt token counter (NMTP RN driver).
 *
 * Hermes cannot run @agnai/web-tokenizers or @agnai/sentencepiece-js (Node fs/url/WASM).
 * GPT families count **native-first on Android** (token-count-perf-r2：DJL cl100k/
 * o200k 词表直编码 + JS 补 overhead，js-tiktoken 降为回退档、iOS 恒回退), with
 * cl100k JS fallback via shared tables from {@link ./impl/encoding-cache}
 * (same-process singleton, never freed). WEB/SP delegate
 * to Android NovelMasterTokenizer when available; otherwise heuristic + estimated.
 *
 * message-token-cache Step 3（分层挂接，主代理定稿）：入口挂 L1 整串缓存；
 * JS 档（countTiktoken 成功路径与 fallbackCount）与 node 驱动同构走 L2 块平面
 * 缓存；native 档（WEB/SP 过桥）**仅 L1**——计数结果写 L1、L1 命中则不过桥
 * （Android 侧整串计数，块粒度无意义，spec：WEB/SP 家族不分块）。代际推进与
 * KKV 持久化挂 core 读口（resolve-current-prompt-tokens），驱动签名零改动。
 */
import {
  CHARACTERS_PER_TOKEN_RATIO,
  buildCounterScope,
  chunkHash16,
  countTextWithIncrementalTokenizer,
  resolveTokenizerFamily,
  mapVendorModelIdToTiktokenModel,
  promptWholeCache,
  serializePromptLlmInput,
  serializeToolsForTokenCount,
  splitTextIntoChunks,
  tokenChunkCache,
  countOpenAiStyleMessages,
  wrapSerializedPromptAsSystemMessage,
  type CountPromptLlmInputParams,
  type PromptTokenCountResult,
  type TokenCounterKind,
  type TokenizerFamily,
} from "@novel-master/core/provider";
import {
  PromptCountCancelledError,
  countPromptViaNative,
  isNativeTokenizerAvailable,
  type NativeCountRequest,
} from "./android-native-bridge.js";
import {
  getDefaultRnEncoding,
  getRnEncoding,
  type RnEncodingName,
  type RnTokenEncoding,
} from "./impl/encoding-cache.js";
import { getEncodingNameForModel } from "js-tiktoken/lite";

/** WEB JSON families — M1 native on Android. */
const WEB_FAMILIES: ReadonlySet<TokenizerFamily> = new Set([
  "claude",
  "llama3",
  "qwen2",
  "command-r",
  "command-a",
  "nemo",
  "deepseek",
  "glm",
]);

/** SentencePiece families — M1 native on Android. */
const SP_FAMILIES: ReadonlySet<TokenizerFamily> = new Set([
  "llama",
  "mistral",
  "yi",
  "gemma",
  "jamba",
]);

function heuristicCount(text: string): number {
  return Math.ceil(text.length / CHARACTERS_PER_TOKEN_RATIO);
}

/** 与 `register.ts` 的 RN_DRIVER_NAME 同值（L2 计数器身份段；import 会成环，故就地重复）。 */
const DRIVER_NAME = "rn";

/**
 * [nm-tok-js] 探针的每轮统计载体（token-count-perf-r2，cr2-B-01 局部对象化）：
 * 由 countSerialized 每轮新建、沿调用链**作为末位可选参数**下传——同会话双轮
 * 并发（chip 精确轮 + 压缩预热轮）互不污染，收尾日志的 route/l2Hit 恒属本轮。
 * 与 Kotlin 侧 `Log.i("nm-tok", ...)` 同族：只记量（路径/L2 命中率），不落任何
 * 提示词内容；输出发生在计数完成之后，不污染被测时段。
 */
interface ProbeStats {
  chunkTotal: number;
  chunkMisses: number;
  route: string;
}

/** 计数结果的短别名。 */
type CountResult = SerializedCountResult;

/** countSerialized 的位置参数元组（测试直调边界，保持位置传参）。 */
type CountArgs = [
  family: TokenizerFamily,
  serialized: string,
  vendorModelId: string,
  chunkScope?: string,
  sessionId?: string
];

/** 编码名三态：undefined = 模型名不被认识，null = 认识但出界。 */
type MaybeRnEncoding = RnEncodingName | null | undefined;

/** 两表域命中或出界。 */
type RnEncodingOrNull = RnEncodingName | null;

/** RN 驱动入口的参数与返回。 */
type RnParams = CountPromptLlmInputParams;
type RnOut = PromptTokenCountResult;

/** 测试用表源注入签名。 */
type EncodingSource = ((name: RnEncodingName) => RnTokenEncoding | null) | null;

interface ChunkCountArgs {
  text: string;
  scope: string;
  encodeText: (text: string) => number;
  probe?: ProbeStats;
}

interface CountTiktokenArgs {
  serialized: string;
  vendorModelId: string;
  scope: string;
  probe?: ProbeStats;
}

interface GptNativeArgs {
  serialized: string;
  vendorModelId: string;
  sessionId: string | undefined;
  probe?: ProbeStats;
}

interface NativeRequestArgs {
  serialized: string;
  family: TokenizerFamily;
  vendorModelId: string;
  sessionId: string | undefined;
}

interface ImplArgs {
  family: TokenizerFamily;
  serialized: string;
  vendorModelId: string;
  chunkScope?: string;
  sessionId?: string;
  probe?: ProbeStats;
}

interface HeuristicArgs {
  serialized: string;
  sessionId: string | undefined;
  probe?: ProbeStats;
}

/**
 * [nm-tok-js] 探针输出口（merge 后小 CR 探针双门）：`__DEV__` 门内才落
 * console——性能调查已收口，release 不该往用户设备的 logcat 常驻写探针；
 * dev（Metro 调试链）与 jest（RN preset 下 `__DEV__` 为 true）照常输出。
 */
function probeLog(message: string): void {
  if (!__DEV__) {
    return;
  }
  console.info(message);
}

/**
 * 块级 L2 计数（与 node 驱动同构，spec 计数流程第 3 步）：
 * `splitTextIntoChunks(整串)` → 逐块查 L2 → miss 块经
 * `countTextWithIncrementalTokenizer` 现算写回 → 求和。
 */
function countChunksWithL2({
  text,
  scope,
  encodeText,
  probe,
}: ChunkCountArgs): number {
  let total = 0;
  for (const chunk of splitTextIntoChunks(text)) {
    const hash = chunkHash16(chunk);
    if (probe != null) {
      probe.chunkTotal += 1;
    }
    const hit = tokenChunkCache.lookup(hash, scope);
    if (hit !== undefined) {
      total += hit;
      continue;
    }
    if (probe != null) {
      probe.chunkMisses += 1;
    }
    const count = countTextWithIncrementalTokenizer(encodeText, chunk);
    tokenChunkCache.record(hash, scope, count);
    total += count;
  }
  return total;
}

/**
 * 兜底计数的**唯一落点**（stream-metrics-native ④ + message-token-cache L2 块
 * 流程）：真分词器（默认 cl100k，逐块查 L2）→ 字符折算。
 *
 * 为什么兜底不再直接折算：`ceil(字符数 / 3.35)` 是**英文**口径，对中文正文
 * （cl100k 约 1.64 token/字符，即 ≈0.61 字符/token）系统性低估 **82%~84%**。
 * 压缩阈值是拿这些数字去卡上下文窗口的，低估意味着「快满了还在继续写」——这
 * 正是最该避免的组合。换成 cl100k 后误差落到 0.5% 量级。
 *
 * 与 node 侧的口径差异只有一层：整串一次增量计数 → 按块分别增量计数再求和
 * （正常文本差 -0.02%~+0.35%，spec 实测；对拍用例按 1% 容差迁移，见 T-TC5）。
 *
 * 为什么这里**只有**字符折算作为最后一级：编码表建不起来（缺 ranks / 环境未
 * 就绪）时别无选择，但它是**限时降级**（失败缓存 null，TTL 5 分钟后允许重试
 * ——encoding-registry 的重试语义，见其模块头），且返回的 `counterKind` 仍是
 * `heuristic`，调用方（尤其压缩阈值）不会误以为这是家族级的真分词器读数。
 * 该档不进 L2——没有真分词器就没有可缓存的稳定读数。
 */
function fallbackCount(text: string, scope: string, probe?: ProbeStats) {
  if (probe != null) {
    probe.route = "fallback";
  }
  const encoding = getDefaultRnEncoding();
  if (encoding == null) {
    return heuristicCount(text);
  }
  const encodeText = (chunk: string) => encoding.encode(chunk).length;
  return countChunksWithL2({ text, scope, encodeText, probe });
}

interface SerializedCountResult {
  count: number;
  counterKind: TokenCounterKind;
  estimated: boolean;
}

/**
 * 问一次 tiktoken 官方模型→编码映射。
 *
 * 返回值三态：`undefined` = 模型名**不被认识**（调用方可换名字再问）；
 * `null` = 认识但表不在本驱动两表域（p50k / gpt2 / r50k…，**出界**，换名字再问
 * 也没有意义——那是在改写模型的真实编码）；`RnEncodingName` = 两表域内命中。
 */
function tryResolveEncodingName(model: string): MaybeRnEncoding {
  try {
    // getEncodingNameForModel 的入参类型是字面量模型名联合，vendor 侧是任意
    // 字符串（未知模型会抛错）——按 never 传入、异常兜底（与 mobile 的
    // resolveStreamTokenEncodingName 同款手法，本函数是其精确档变体）。
    const name = getEncodingNameForModel(model as never);
    return name === "cl100k_base" || name === "o200k_base" ? name : null;
  } catch {
    return undefined;
  }
}

/**
 * vendorModelId → 本驱动编码名（限定 cl100k_base / o200k_base 两值）。
 *
 * 解析顺序参照 mobile `resolveStreamTokenEncodingName` 先例：先拿 vendorModelId
 * 直查官方映射（能命中 `gpt-4o` / `gpt-4` 这类标准 id），不认识（如 `openai/`
 * vendor 前缀形态）才经 core 的 `mapVendorModelIdToTiktokenModel` 改写后再问一次，
 * 且第二跳仅对 tiktoken 家族放行。**直查认识但出界时立即返回 null**：core 的
 * 映射会把 `text-davinci-003`（真 p50k 模型）改写成 `gpt-3.5-turbo`（cl100k），
 * 若继续走第二跳，等于拿 cl100k 冒充 p50k 的精确读数。
 *
 * 返回 null = p50k / gpt2 家族或两跳都解析不出 → 按 fa 边界声明走 cl100k 兜底、
 * 报 heuristic，不冒充精确（spec P1-1：不引 p50k/gpt2 ranks 是刻意的 Metro 包体
 * 取舍；对拍用例须限定两表覆盖域）。
 */
function resolveRnEncodingName(id: string, model: string): RnEncodingOrNull {
  const trimmed = id.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const direct = tryResolveEncodingName(trimmed);
  if (
    direct === undefined &&
    resolveTokenizerFamily(trimmed, "auto") === "tiktoken"
  ) {
    const mapped = tryResolveEncodingName(model);
    if (mapped !== undefined) {
      return mapped;
    }
  }
  return direct ?? null;
}

/**
 * 表源覆盖钩子（仅测试用）：默认 null = 走驱动共享编码表
 * {@link getRnEncoding}（同进程单例，绝不 free）。
 * 注入 `(name) => 假 encoding / null` 即可在不建真表的情况下控制
 * countTiktoken 的表源分支（替代旧「tiktoken 模块注入」钩子形态）。
 */
let encodingSourceForTests: EncodingSource = null;

function resolveEncoding(name: RnEncodingName): RnTokenEncoding | null {
  return encodingSourceForTests == null
    ? getRnEncoding(name)
    : encodingSourceForTests(name);
}

// nm-style: keep-local — 表源解析、overhead 公式与 L2 分块计数共享 encoding/probe，内联会拆散精确档三段回退和探针状态。
async function countTiktoken({
  serialized,
  vendorModelId,
  scope,
  probe,
}: CountTiktokenArgs): Promise<SerializedCountResult> {
  const tiktokenModel = mapVendorModelIdToTiktokenModel(vendorModelId);
  const encName = resolveRnEncodingName(vendorModelId, tiktokenModel);
  // 取到的是共享单例句柄（impl/encoding-cache → registry）：绝不 free()，
  // 生命周期由缓存层统一持有。
  const encoding = encName == null ? null : resolveEncoding(encName);
  if (encoding == null) {
    // 解析出界（p50k / gpt2 家族）或表建不起来 → 走 cl100k 兜底并如实报
    // heuristic：cl100k 对这些模型只是近似，冒充精确会让压缩阈值跳过
    // 0.85 安全系数。
    return {
      count: fallbackCount(serialized, scope, probe),
      counterKind: "heuristic",
      estimated: true,
    };
  }
  try {
    // message-token-cache L2 块流程（与 node 精确档同构）：overhead 经 core
    // 下沉版 countOpenAiStyleMessages 对**空 content** 求得（per-message
    // overhead 公式零复刻——空串在增量计数器里短路不调 encode，恰剩
    // perMessage + w(role) + tail，与 node 侧 countOpenAiStyleChunked 同一
    // 组装），content 部分按 splitTextIntoChunks 块求和过 L2。数值与整串
    // 口径差 ≤1%（T-TC5）。
    const msg = wrapSerializedPromptAsSystemMessage("");
    const overhead = countOpenAiStyleMessages(encoding, [msg], tiktokenModel);
    const encodeText = (text: string) => encoding.encode(text).length;
    const chunks = countChunksWithL2({
      text: serialized,
      scope,
      encodeText,
      probe,
    });
    const count = overhead + chunks;
    return { count, counterKind: "tiktoken", estimated: false };
  } catch {
    return {
      count: fallbackCount(serialized, scope, probe),
      counterKind: "heuristic",
      estimated: true,
    };
  }
}

/**
 * gpt 家族的原生优先路径（token-count-perf-r2）：Android 侧 DJL 词表直编码
 * 整串（对拍门 T-G2 已验证与 js-tiktoken 裸 encode 同值域），JS 侧用 core 公式
 * 补 per-message overhead（~7 token 常数，公式单源保持在 TS，Kotlin 不复刻）。
 *
 * 三层回退链：编码名出界（p50k/gpt2 家族 → `resolveRnEncodingName` null）或
 * js 编码表建不起来 → 返回 null（落 js 档）；原生不可用 / 无资产 reject（非
 * 取消）→ 返回 null（落 js 档 = 现状行为）；**取消异常原样上抛**——与 WEB/SP
 * 分支同一条不变量（见 countSerializedImpl 中「取消例外」注释）。
 *
 * 返回 null 一律表示「这一轮不归原生管」，由调用方落回 [countTiktoken]。
 */
// nm-style: keep-local — 三层回退（编码名出界 / 表缺失 / 原生失败）与 overhead 前置校验共享 encName/probe，内联会打散回退顺序。
async function countGptViaNative({
  serialized,
  vendorModelId,
  sessionId,
  probe,
}: GptNativeArgs): Promise<SerializedCountResult | null> {
  if (!isNativeTokenizerAvailable()) {
    return null;
  }
  const tiktokenModel = mapVendorModelIdToTiktokenModel(vendorModelId);
  const encName = resolveRnEncodingName(vendorModelId, tiktokenModel);
  if (encName == null) {
    return null;
  }
  const encoding = resolveEncoding(encName);
  if (encoding == null) {
    // js 表建不起来时 overhead 公式也算不了——整个精确档都进不去，交给
    // countTiktoken 自己的兜底链（现状行为）。
    //
    // **已知耦合（cr2-B-10）**：overhead 走「公式单源在 TS」意味着原生路线
    // 与 JS 编码表可用性强耦合——表建不起来时**即便原生词表就在包里**也会落
    // heuristic（原生 → countTiktoken 同样建不起表 → 字符折算）。排查「gpt
    // 为何掉 heuristic」时先查这里。解耦方案（overhead 闭式：perMessage +
    // encode('system')=1 + tail，两条 parity 断言锁死）留作后续迭代。
    return null;
  }
  const msg = wrapSerializedPromptAsSystemMessage("");
  const overhead = countOpenAiStyleMessages(encoding, [msg], tiktokenModel);
  try {
    // vendorModelId 槽在 gpt 档承载编码名（Kotlin 侧 family=="tiktoken" 时
    // 解释为编码名选词表，见 TokenizerModule.encodingNameFor）。
    const request = buildNativeCountRequest({
      serialized,
      family: "tiktoken",
      vendorModelId: encName,
      sessionId,
    });
    const nativeResult = await countPromptViaNative(request);
    if (nativeResult == null) {
      return null;
    }
    if (probe != null) {
      probe.route = "native-gpt";
    }
    return {
      count: nativeResult.tokenCount + overhead,
      counterKind: "tiktoken",
      estimated: false,
    };
  } catch (error) {
    if (error instanceof PromptCountCancelledError) {
      throw error;
    }
    return null;
  }
}

/**
 * 取消 requestId 的自增序号（模块级）。requestId 形态 `${sessionId}:${seq}`——
 * sessionId 段给归属信息源，seq 段保证同会话并发多轮各自唯一（chip 精确轮 +
 * 压缩预热轮同会话在途是 R6 已知形态，两轮的 requestId 不能撞）。
 *
 * **只在 `sessionId` 在场时消费**：requestId 非空是硬约束（bridgeless 桥对
 * String 参数传 null/undefined 硬抛，见 spec r2-P0），所以缺 sessionId 的轮
 * 连序号都不递增，保持「不可取消轮 = 现状三参」这条二分口径干净。
 */
let nativeRequestSeq = 0;

/**
 * native 档过桥请求：sessionId 与 requestId 同时在场才可能被桥判为可取消轮。
 * `vendorModelId` 槽**双语义**（token-count-perf-r2）：WEB/SP 家族传真实
 * vendor id（仅诊断）；gpt 档传 JS 已解析的编码名（cl100k_base / o200k_base），
 * Kotlin 侧 family=="tiktoken" 时据此选词表（TokenizerModule.encodingNameFor）。
 *
 * requestId 形态 `${sessionId}:${seq}`：sessionId 缺失时不出 requestId
 * （桥内判据 `requestId != null` 会让这一轮走旧三参 = 现状）。
 */
function buildNativeCountRequest({
  serialized,
  family,
  vendorModelId,
  sessionId,
}: NativeRequestArgs): NativeCountRequest {
  if (sessionId == null) {
    return { serialized, family, vendorModelId };
  }
  nativeRequestSeq += 1;
  return {
    serialized,
    family,
    vendorModelId,
    sessionId,
    requestId: `${sessionId}:${nativeRequestSeq}`,
  };
}

/**
 * 计数主体。`sessionId`（第 5 位可选参）是取消链路的归属信息源：
 * 在场时驱动生成 requestId 塞进过桥请求，桥内会走可取消的新方法并登记
 * in-flight；缺失时行为与本次迭代之前逐字节一致（旧三参、不可取消）。
 *
 * 外层是 [nm-tok-js] 探针壳：只在 L1 miss 的真实计数轮输出（L1 命中在入口
 * 早退、不经过这里），把「native / tiktoken / 兜底」哪条路、耗时、L2 命中率
 * 一次记全——真机 gpt 兜底「切会话 1s / 精确轮 4.2s」的体感归因靠它落账。
 */
async function countSerialized(...args: CountArgs): Promise<CountResult> {
  const [family, serialized, vendorModelId, chunkScope, sessionId] = args;
  // 每轮一份局部探针（cr2-B-01）：同会话双轮并发（chip 精确轮 + 压缩预热轮）
  // 各自持有互不污染——模块级可变状态会让 A 轮收尾打出 B 轮的 route/l2Hit。
  const probe: ProbeStats = { chunkTotal: 0, chunkMisses: 0, route: "js" };
  const probeT0 = Date.now();
  try {
    const implArgs = {
      family,
      serialized,
      vendorModelId,
      chunkScope,
      sessionId,
      probe,
    };
    const result = await countSerializedImpl(implArgs);
    const head = `[nm-tok-js] family=${family} chars=${serialized.length}`;
    const ms = ` ms=${Date.now() - probeT0}`;
    const route = ` route=${probe.route} kind=${result.counterKind} est=${result.estimated}`;
    const l2 = ` l2Hit=${probe.chunkTotal - probe.chunkMisses}/${
      probe.chunkTotal
    }`;
    probeLog(head + ms + route + l2);
    return result;
  } catch (error) {
    const head = `[nm-tok-js] family=${family} chars=${serialized.length}`;
    const ms = ` ms=${Date.now() - probeT0}`;
    const route = ` route=${probe.route} thrown=${
      error instanceof Error ? error.name : "unknown"
    }`;
    probeLog(head + ms + route);
    throw error;
  }
}

// nm-style: keep-local — scope 拼装、原生三层路由与兜底分支共享 probe/scope，内联会把这套状态机叠进探针壳。
async function countSerializedImpl({
  family,
  serialized,
  vendorModelId,
  chunkScope,
  sessionId,
  probe,
}: ImplArgs): Promise<SerializedCountResult> {
  // L2 计数器身份：入口（countPromptLlmInputRn）会传入含 override 的完整
  // scope；直接调用（测试钩子）缺省时按 (模型, 家族, rn 驱动) 拼——两套键
  // 各自独立、语义一致，不会互串。
  const defaultScope = buildCounterScope({
    vendorModelId,
    tokenizerFamily: family,
    driverName: DRIVER_NAME,
  });
  const scope = chunkScope ?? defaultScope;
  if (family === "heuristic") {
    // 兜底家族原生优先（token-count-perf-r2 Part C）：用户自定义 vendor 名解析
    // 落 heuristic 的会话正是「兜底 gpt」体感慢的主力——165K 字符的 JS cl100k
    // 分块重算在 Hermes 上秒级，而原生 cl100k 词表已在包内（暖轮 ~250ms/87K）。
    // 口径与标签**不变**：仍报 heuristic/estimated（对未知家族这依然是近似读数，
    // 压缩阈值 0.85 系数照吃），只是把「算」的动作挪进原生。取消异常原样上抛。
    const heurArgs = { serialized, sessionId, probe };
    const nativeHeuristic = await countHeuristicViaNative(heurArgs);
    if (nativeHeuristic != null) {
      return nativeHeuristic;
    }
    return {
      count: fallbackCount(serialized, scope, probe),
      counterKind: "heuristic",
      estimated: true,
    };
  }
  // GPT 家族（token-count-perf-r2 起三层路由：原生优先 → js-tiktoken → 其内部
  // 自带 cl100k heuristic 兜底）。gpt2 / 出界（p50k）模型不经原生——
  // resolveRnEncodingName 返回 null 时根本不发起过桥。
  if (family === "tiktoken" || family === "gpt2") {
    let nativeResult: SerializedCountResult | null = null;
    if (family === "tiktoken") {
      const gptArgs = { serialized, vendorModelId, sessionId, probe };
      nativeResult = await countGptViaNative(gptArgs);
    }
    if (nativeResult != null) {
      return nativeResult;
    }
    return countTiktoken({ serialized, vendorModelId, scope, probe });
  }
  if (WEB_FAMILIES.has(family) || SP_FAMILIES.has(family)) {
    if (isNativeTokenizerAvailable()) {
      // native 档（WEB/SP 过桥）：Android 侧整串计数，**不切块**（spec：
      // native 档仅 L1——L1 命中的拦截在驱动入口，这里只负责真实计数）。
      //
      // **取消例外（tokenizer-native-cancel）**：桥识别到 Kotlin 的
      // TOKENIZER_COUNT_CANCELLED reject 时抛 `PromptCountCancelledError`，
      // 本函数**不得**把它当成「原生返回 null」而落进下面的兜底重算——
      // 那等于先占原生队列再烧一次 JS 线程，比不取消更贵。所以这里刻意
      // **没有 try/catch**：异常在 `nativeResult != null` 判定与兜底分支之前
      // 原样穿透（调用链上任何 catch 想拦取消都会踩这条不变量）。
      const request = buildNativeCountRequest({
        serialized,
        family,
        vendorModelId,
        sessionId,
      });
      const nativeResult = await countPromptViaNative(request);
      if (nativeResult != null) {
        if (probe != null) {
          probe.route = "native";
        }
        return {
          count: nativeResult.tokenCount,
          counterKind: nativeResult.counterKind as TokenCounterKind,
          estimated: nativeResult.estimated,
        };
      }
      // 家族词表不可用（2026-11-06 真机实证）：Android 包内只有 DJL 的
      // `libdjl_tokenizer.so`（HuggingFace 用），SentencePiece 没有 Android
      // native —— 构建期能力位 `SENTENCEPIECE_NATIVE_AVAILABLE = false`，
      // yi/jamba 的 `.model` 条目与资产已删除，原生调用直接 reject。
      // gemma/llama/mistral 已转成 HF tokenizer.json 走原生 HF 路径。先试
      // **原生 cl100k 近似**：口径与下面的
      // fallbackCount 完全一致（同样是 cl100k、同样报 heuristic/estimated，
      // 压缩阈值照乘 0.85），但算力在原生 executor 上、毫秒级。
      // 真机实测 gemini 107K 字符落 JS 分块要 7.9s 且全程占住 Hermes 主线程
      // （切模型点不动、侧滑无响应）——这条兜底只是把同样的近似换到原生算。
      const heurArgs = { serialized, sessionId, probe };
      const nativeHeuristic = await countHeuristicViaNative(heurArgs);
      if (nativeHeuristic != null) {
        return nativeHeuristic;
      }
    }
    return {
      count: fallbackCount(serialized, scope, probe),
      // 原生分词器不可用（iOS / 未链接模块）时**必须**报 `heuristic` 而不是家族名：
      // 这里跑的是 cl100k 近似，不是该家族的真 tokenizer。报家族名会让压缩阈值
      // 把它当成「家族级精确读数」而不乘 0.85 安全系数，等于拿一个近似值卡精确
      // 阈值——而 cl100k 对 claude/glm 这类非 OpenAI 家族本就有偏差。
      counterKind: "heuristic",
      estimated: true,
    };
  }
  return {
    count: fallbackCount(serialized, scope, probe),
    counterKind: "heuristic",
    estimated: true,
  };
}

/**
 * 兜底（heuristic）家族的原生路径（token-count-perf-r2 Part C）：cl100k 词表
 * 直编码整串。与 gpt 档不同——**不加 overhead**（兜底口径本就是裸文本近似，
 * 非 OpenAI 消息包装）、**标签保持 heuristic/estimated:true**（换的只是算力，
 * 不是口径）。原生不可用 / 失败（非取消）→ null 落回 JS [fallbackCount]。
 */
async function countHeuristicViaNative({
  serialized,
  sessionId,
  probe,
}: HeuristicArgs): Promise<SerializedCountResult | null> {
  if (!isNativeTokenizerAvailable()) {
    return null;
  }
  try {
    const request = buildNativeCountRequest({
      serialized,
      family: "tiktoken",
      vendorModelId: "cl100k_base",
      sessionId,
    });
    const nativeResult = await countPromptViaNative(request);
    if (nativeResult == null) {
      return null;
    }
    if (probe != null) {
      probe.route = "native-heuristic";
    }
    return {
      count: nativeResult.tokenCount,
      counterKind: "heuristic",
      estimated: true,
    };
  } catch (error) {
    if (error instanceof PromptCountCancelledError) {
      throw error;
    }
    return null;
  }
}

/** RN NMTP driver entry: model-aware prompt token counting. */
export async function countPromptLlmInputRn(params: RnParams): Promise<RnOut> {
  const { layout, ctx, savedModelId, registry } = params;
  let vendorModelId = savedModelId;
  if (params.savedModels != null) {
    const saved = await params.savedModels.findById(savedModelId.trim());
    if (saved != null) {
      vendorModelId = saved.vendorModelId;
    }
  }
  let override = params.tokenizerOverride;
  if (override == null) {
    override = (await registry.getTokenizerOverride?.()) ?? "auto";
  }
  const family = resolveTokenizerFamily(vendorModelId, override);
  // tools 段与提示词同串计数（空 tools 时拼接为恒等）：RN 侧同样交给
  // 原生 bridge / js-tiktoken / heuristic 处理同一个串，口径与 Node 端一致。

  // ---- L1 整串缓存（message-token-cache Step 3）----
  // 键 = 内容指纹（hashContent(整串+tools 串) 前 16 hex，与 L2 块键同口径）
  // × 计数器身份。native 档的 L1 拦截就在这里：命中直接返回、不过桥。
  // 驱动内部查 L1 传**空 sessionId**（键含内容指纹，跨会话共享安全）；
  // sessionId 段的会话语义由读口层决定，驱动不越层。
  // （取消链路的 sessionId 是**另一条通路**：它不进缓存键，只随过桥请求
  // 下发给桥做 in-flight 登记与取消归属，见 countSerialized 第 5 位。）
  const scope = buildCounterScope({
    vendorModelId,
    tokenizerOverride: override,
    tokenizerFamily: family,
    driverName: DRIVER_NAME,
  });
  const promptText = await serializePromptLlmInput(layout, ctx);
  const serialized = promptText + serializeToolsForTokenCount(params.tools);
  const contentHash = chunkHash16(serialized);
  const cached = promptWholeCache.lookup("", scope, contentHash);
  if (cached != null) {
    return {
      tokenCount: cached.tokenCount,
      counterKind: cached.counterKind,
      estimated: cached.estimated,
      savedModelId,
      vendorModelId,
      tokenizerFamily: family,
    };
  }

  const countArgs: CountArgs = [
    family,
    serialized,
    vendorModelId,
    scope,
    params.sessionId,
  ];
  const { count, counterKind, estimated } = await countSerialized(...countArgs);

  // miss 后写 L1（JS 档与 native 档都写：native 档靠它挡「无变更重复过桥」）。
  // **取消轮写不到这里**——上一行 await 会抛 `PromptCountCancelledError`，
  // 异常穿透到调用方，取消结果零污染（L1 里不留半截读数，重进会话正常重算）。
  promptWholeCache.record("", scope, contentHash, {
    tokenCount: count,
    counterKind,
    estimated,
  });

  return {
    tokenCount: count,
    counterKind,
    estimated,
    savedModelId,
    vendorModelId,
    tokenizerFamily: family,
  };
}

/** Test hooks for Jest (mobile + driver unit tests). */
export const __test__ = {
  WEB_FAMILIES,
  SP_FAMILIES,
  countSerialized,
  heuristicCount,
  /**
   * 表源注入（仅测试）：覆盖 countTiktoken 的编码表取用口（注入假 encoding 或
   * factory）；传 `null` 还原为驱动的共享编码表 getRnEncoding。
   */
  setEncodingSourceForTests(source: EncodingSource): void {
    encodingSourceForTests = source;
  },
};
