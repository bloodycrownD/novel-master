/**
 * ChatServiceFactory.createMessage 直构回归（p23 阶段 1「删 3 留 1」）。
 *
 * 分项工厂删 3 留 1 后，ChatServiceFactory.createMessage 直接构造 DefaultMessageService，
 * 不得再经 ChatServiceFactory.createBundle bundle 触碰 Project/Session service 的构造。
 * 这里用 `mock.module` 把两个 impl 换成「构造即抛错」的桩钉死这一点。
 *
 * mock 注册必须在动态 import 被测模块之前（范式同
 * assemble-backfill-no-recompress.test.ts：静态 import 会被提升到 mock 之前，
 * 拿到的就不是桩）。
 *
 * @module test/service/chat/create-message-service-direct
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { TdbcConnection } from "../../../src/infra/tdbc/ports/connection.port.js";

let projectCtorCalls = 0;
let sessionCtorCalls = 0;

mock.module("../../../src/service/chat/impl/project.service.js", {
  namedExports: {
    DefaultProjectService: class {
      constructor() {
        projectCtorCalls += 1;
        throw new Error("DefaultProjectService 不应被 ChatServiceFactory.createMessage 构造");
      }
    },
  },
});

mock.module("../../../src/service/chat/impl/session.service.js", {
  namedExports: {
    DefaultSessionService: class {
      constructor() {
        sessionCtorCalls += 1;
        throw new Error("DefaultSessionService 不应被 ChatServiceFactory.createMessage 构造");
      }
    },
  },
});

const { ChatServiceFactory } = await import("../../../src/service/chat/chat-service-factory.js");
// message.service 未被 mock，动态 import 拿到的是真实类，供 instanceof 正向锚定。
const { DefaultMessageService } = await import("../../../src/service/chat/impl/message.service.js");

describe("ChatServiceFactory.createMessage 直构（不经 bundle）", () => {
  it("返回 DefaultMessageService 实例，且全程不构造 Project/Session service", () => {
    const svc = ChatServiceFactory.createMessage({} as TdbcConnection);
    assert.ok(svc instanceof DefaultMessageService, "应直接构造 DefaultMessageService");
    assert.equal(projectCtorCalls, 0, "DefaultProjectService 构造计数应为 0");
    assert.equal(sessionCtorCalls, 0, "DefaultSessionService 构造计数应为 0");
  });
});
