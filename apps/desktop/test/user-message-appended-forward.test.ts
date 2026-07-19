/**
 * T-AN5：Desktop `nm:agent/userMessageAppended` 推送契约（仿 suggest forwarder）。
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  notifyUserMessageAppendedToRenderer,
  setUserMessageAppendedForwardTarget,
} from "../src/main/ipc/forward-user-message-appended.js";
import { IPC_CHANNELS } from "../shared/ipc-types.js";

afterEach(() => {
  setUserMessageAppendedForwardTarget(() => undefined);
});

test("T-AN5: notifyUserMessageAppended 推送 nm:agent/userMessageAppended {sessionId}", () => {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  setUserMessageAppendedForwardTarget(() => {
    return {
      send(channel: string, payload: unknown) {
        sent.push({ channel, payload });
      },
    } as never;
  });

  notifyUserMessageAppendedToRenderer({ sessionId: "s-append" });

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.channel, IPC_CHANNELS.AGENT_USER_MESSAGE_APPENDED);
  assert.equal(
    IPC_CHANNELS.AGENT_USER_MESSAGE_APPENDED,
    "nm:agent/userMessageAppended",
  );
  assert.deepEqual(sent[0]?.payload, { sessionId: "s-append" });
});

test("T-AN5: 通道不得复用 RUN_* / COMPOSER_ATTACHMENTS_SUGGEST", () => {
  assert.notEqual(
    IPC_CHANNELS.AGENT_USER_MESSAGE_APPENDED,
    IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST,
  );
  assert.notEqual(
    IPC_CHANNELS.AGENT_USER_MESSAGE_APPENDED,
    IPC_CHANNELS.AGENT_STREAM,
  );
});
