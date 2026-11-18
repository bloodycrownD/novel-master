/**
 * service/agent 的工厂命名空间：runner / registry / abort / stream 四个装配入口。
 *
 * @module service/agent/agent-service-factory
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import type { BuiltinToolContext } from "@/domain/tool/builtin/builtin-tool-context.js";
import type { ChatMessageData } from "@/domain/chat/model/message.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { ModelRequestService } from "../provider/model-request.port.js";
import type { SimpleEventBus } from "@/infra/events/simple-event-bus.js";
import type { SessionKkvService } from "../session-kkv/session-kkv.port.js";
import type { WorkplaceService } from "../workplace/workplace.port.js";
import type { CompactionConditionEvaluator } from "../compaction-conditions/compaction-factory.js";
import type { MessageService } from "../chat/message.port.js";
import type { MessageCheckpointService } from "../message-checkpoint/message-checkpoint.port.js";
import type { PersistentPreferences } from "../persistent-preferences/persistent-preferences.port.js";
import type { AgentRunner } from "./agent.port.js";
import type { AgentStreamRegistry, AgentStreamRegistryHandle } from "./agent-stream-registry.port.js";
import type { SkillService } from "@/service/skills/skills.port.js";
import { DefaultAgentRunner } from "./impl/agent-runner.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteAgentDefinitionRepository } from "@/domain/agent/repositories/impl/sqlite-agent-definition.repository.js";
import type { PersistentState } from "../persistent-state/persistent-state.port.js";
import { DefaultAgentRegistryService } from "./impl/agent-registry.service.js";
import type { AgentRegistryService } from "./agent-registry.port.js";
import { scopeFromController } from "@/domain/abort/logic/create-abort-scope.js";
import type { AbortScope } from "@/domain/abort/model/abort-scope.js";
import type { AgentAbortRegistry } from "./agent-abort-registry.port.js";

export interface CreateAgentRunnerDeps {
  readonly session: AgentSession;
  readonly modelRequests: ModelRequestService;
  readonly savedModels: SavedModelRepository;
  readonly providers?: Pick<ProviderRepository, "findById">;
  readonly registry: ToolRegistry<BuiltinToolContext>;
  readonly toolCtx: BuiltinToolContext;
  /**
   * skillAttach hydrate（`$技能` 首次引用附全文）的技能服务工厂；不随 D4
   * （skill deny）置空——显式引用不受工具禁用影响。
   */
  readonly skills?: () => SkillService;
  readonly eventBus: SimpleEventBus;
  /** 常驻工作区前缀经 {@link assembleWorkplaceDisplay} 读写。 */
  readonly sessionKkv: SessionKkvService;
  readonly workplace: (scope: VfsScope) => WorkplaceService;
  /**
   * mutating 工具并行 settled 后同步 checkpoint；失败会中断当前 agent run。
   * @remarks 在 append tool_results 之前 await，避免对话继续但无 checkpoint。
   */
  readonly messageCheckpoint?: MessageCheckpointService;
  readonly compactionConditions?: CompactionConditionEvaluator;
  /** 压缩执行所需的消息服务（hide + 截断入口）；对话轨由 assembleAgentRunnerDeps 注入。 */
  readonly messages?: MessageService;
  /**
   * 每步模型请求的 tool_use 查找源（Gemini `functionResponse.name` 解析 +
   * hidden tool_use 的合成 model turn）。**可见-only**：出站历史先经
   * `normalizeOrphanToolResultsForLlm`（按可见历史配对，hidden 的 tool_use
   * 不算配对），残留 tool_result 的 tool_use 必在可见集内——所以可见集
   * 解析力等价于全量，却省掉 hidden 行的逐条解压（全量读 212ms → 14ms）。
   * 懒求值：本 step 的可见窗口落定后再取（含本 step 压缩产物）。
   */
  readonly listVisibleSessionMessages?: () => Promise<readonly ChatMessageData[]>;
  /** 按 sessionId 累积 in-flight 流式 partial，供子会话首次进入查询。 */
  readonly streamRegistry?: AgentStreamRegistry;
  /** 思考上下文偏好窄切片（每 run 一次快照；未注入时等同默认开）。 */
  readonly preferences?: Pick<PersistentPreferences, "getThinkingContextEnabled">;
}

export const AgentServiceFactory = {
  /** Creates an agent runner with injected dependencies.（原 createAgentRunner） */
  createRunner(deps: CreateAgentRunnerDeps): AgentRunner {
    return new DefaultAgentRunner(deps);
  },

  /**
   * 创建 SQL 后端的 Agent 注册表服务。（原 createAgentRegistryService）
   *
   * @param conn - bootstrapNovelMaster 之后已打开的连接
   * @param state - 可选；注入时 {@link AgentRegistryService.delete} 会重置当前指针
   */
  createRegistry(conn: TdbcConnection, state?: PersistentState): AgentRegistryService {
    const repository = new SqliteAgentDefinitionRepository(conn);
    return new DefaultAgentRegistryService({ repository, state });
  },

  /**
   * 创建一个进程内的 AgentAbortRegistry（scope 薄包装）。（原 createAgentAbortRegistry）
   *
   * register/tryRegister 内部走 `scopeFromController(controller)`，与 run 根 scope
   * 共用同一 WeakMap memoize 实例（spec §二：**不另建缓存 Map**）——因此
   * `abort(sessionId)` 命中的 scope 就是 run-agent-turn 里的根 scope，
   * `reason` 会如实记为 `"user-stop"`（T-S24）。
   */
  createAbortRegistry(): AgentAbortRegistry {
    const scopes = new Map<string, AbortScope>();

    return {
      register(sessionId, controller) {
        scopes.set(sessionId, scopeFromController(controller));
      },
      tryRegister(sessionId, controller) {
        // 判重与写入同同步段完成：已占用则一个字节都不动（不覆盖既有 scope）。
        if (scopes.has(sessionId)) {
          return false;
        }
        scopes.set(sessionId, scopeFromController(controller));
        return true;
      },
      abort(sessionId) {
        // 不删——删除由 finally 的 unregister 完成，避免 abort 与反注册的时序竞态。
        // scope.abort 内部会 controller.abort()，并把 reason 记为 user-stop。
        scopes.get(sessionId)?.abort("user-stop");
      },
      unregister(sessionId, controller) {
        // 所有权比对：只有同一 controller 对应的 memoize 实例才删，防误删新 run。
        if (scopes.get(sessionId) === scopeFromController(controller)) {
          scopes.delete(sessionId);
        }
      },
      has(sessionId) {
        return scopes.has(sessionId);
      },
    };
  },

  /**
   * 创建一个进程内的 AgentStreamRegistry（Map 薄封装）。（原 createAgentStreamRegistry）
   *
   * - `register` 重置 partial 并签发新句柄（run 边界，新 run / 新会话从空开始）；
   * - `reset` 仅清空累积文本、保留句柄（step 边界，下一步从空开始）；
   * - `append` 追加 delta（parts 数组 push，不做字符串重建——per-delta 的
   *   `text + delta` 会随流长增长产生超线性累积与 GC 垃圾）；
   * - `get` 返回只读快照（读频低，物化点收敛到这里：join 一次）；
   * - `unregister` 带句柄所有权比对，防误删新 run 的 partial。
   */
  createStreamRegistry(): AgentStreamRegistry {
    interface Entry {
      /** text delta 分段（按到达序 push；物化 = join 一次）。 */
      textParts: string[];
      /** thinking delta 分段（同上）。 */
      thinkingParts: string[];
      handle: AgentStreamRegistryHandle;
    }

    const map = new Map<string, Entry>();
    // 单调递增的句柄序号；每次 register 自增并写入 Entry，作为所有权 token。
    let nextSeq = 1;

    return {
      register(sessionId) {
        const handle = String(nextSeq++);
        map.set(sessionId, { textParts: [], thinkingParts: [], handle });
        return handle;
      },
      reset(sessionId) {
        const current = map.get(sessionId);
        if (current == null) {
          return;
        }
        // 只清累积分段（复用数组实例，避免每 step 换新数组），handle 保留——
        // 同一 run 内的 step 边界不换所有权。
        current.textParts.length = 0;
        current.thinkingParts.length = 0;
      },
      append(sessionId, delta) {
        const current = map.get(sessionId);
        if (current == null) {
          return;
        }
        // 空字符串等价于不修改对应字段（port 契约），跳过 push 防数组虚长。
        if (delta.text != null && delta.text.length > 0) {
          current.textParts.push(delta.text);
        }
        if (delta.thinking != null && delta.thinking.length > 0) {
          current.thinkingParts.push(delta.thinking);
        }
      },
      // 只读快照口：当前为内部/测试用途（无生产调用方），保留以维持
      // register/append/reset/get/has/unregister 的对称读口（core-transport Q3）。
      get(sessionId) {
        const current = map.get(sessionId);
        if (current == null) {
          return undefined;
        }
        return {
          text: current.textParts.join(""),
          thinking: current.thinkingParts.join(""),
        };
      },
      has(sessionId) {
        return map.has(sessionId);
      },
      unregister(sessionId, handle) {
        const current = map.get(sessionId);
        if (current == null) {
          return;
        }
        // 所有权比对：handle 一致才删。handle 省略时（兼容路径）直接删。
        if (handle != null && current.handle !== handle) {
          return;
        }
        map.delete(sessionId);
      },
    };
  },
} as const;
