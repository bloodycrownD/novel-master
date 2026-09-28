/**
 * T-FA2（fallback-caliber-align Step 1）：下沉后的 count-openai-style-message
 * 与 node 原实现输出**逐字节一致**。
 *
 * 三方对拍：
 * 1. core 下沉版（`@novel-master/core/provider`）；
 * 2. node 驱动 re-export 版（`../src/logic/count-openai-style-message.js`，
 *    本文件 import 它同时锁住「re-export 覆盖全部导出面」——缺符号直接编译失败）；
 * 3. 独立参考实现：手写 ST `/openai/count` 算法 + 真 tiktoken encode，
 *    锁「下沉过程逻辑一字未改」。
 *
 * 时序注记（P1-5）：message-token-cache 合并后 encode 接分块包装，本文件的
 * 逐字节基准届时迁移至 T-TC5 的容差口径；当前 fa 阶段 encode 保持整串原样。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encoding_for_model, get_encoding } from "tiktoken";

import {
  countOpenAiStyleMessages,
  convertMessagesForWebTokenizer,
  countWebTokenizerMessages,
  wrapSerializedPromptAsSystemMessage,
  type OpenAiStyleMessage,
} from "@novel-master/core/provider";

import {
  countOpenAiStyleMessages as countFromNodeReexport,
  convertMessagesForWebTokenizer as convertFromNodeReexport,
  countWebTokenizerMessages as countWebFromNodeReexport,
  wrapSerializedPromptAsSystemMessage as wrapFromNodeReexport,
} from "../src/logic/count-openai-style-message.js";

/** 独立参考实现：ST `/openai/count` 的 precise 档算法，不经过 core 的 countTokens。 */
function referenceCount(
  encode: (text: string) => number,
  messages: readonly OpenAiStyleMessage[],
  tiktokenModel: string,
): number {
  const is0301 = tiktokenModel === "gpt-3.5-turbo-0301";
  const tokensPerMessage = is0301 ? 4 : 3;
  const tokensPerName = is0301 ? -1 : 1;

  let numTokens = 0;
  for (const msg of messages) {
    numTokens += tokensPerMessage;
    numTokens += encode(msg.role);
    numTokens += encode(msg.content);
    if (msg.name != null) {
      numTokens += encode(msg.name);
      numTokens += tokensPerName;
    }
  }
  numTokens += 3;
  if (is0301) {
    numTokens += 9;
  }
  return numTokens;
}

interface ParityCase {
  readonly name: string;
  readonly tiktokenModel: string;
  readonly messages: readonly OpenAiStyleMessage[];
}

const CASES: readonly ParityCase[] = [
  {
    name: "英文 system+user",
    tiktokenModel: "gpt-4o",
    messages: [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ],
  },
  {
    name: "中文长文本",
    tiktokenModel: "gpt-4o",
    messages: [
      { role: "system", content: "他把伞收了，窗外的雨顺着玻璃往下淌。" },
      { role: "user", content: "街灯在水洼里碎成一片橙。".repeat(8) },
    ],
  },
  {
    name: "带 name 字段（precise 档 name 调整）",
    tiktokenModel: "gpt-4o",
    messages: [
      { role: "system", content: "abc" },
      { role: "function", content: "result payload", name: "get_weather" },
    ],
  },
  {
    name: "0301 口径（+4/-1/+9）",
    tiktokenModel: "gpt-3.5-turbo-0301",
    messages: [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "你好，世界", name: "caller" },
    ],
  },
  {
    name: "空消息列表（仅尾部 +3）",
    tiktokenModel: "gpt-4o",
    messages: [],
  },
];

describe("count-openai-style-message 下沉对拍 T-FA2", () => {
  it("core 下沉版 / node re-export 版 / 独立参考实现三方逐字节一致", () => {
    // 两块真表都跑：gpt-4o → o200k_base（非 0301）、gpt-3.5-turbo-0301 →
    // cl100k_base（is0301 分支）。句柄用完不 free（随进程退出回收）。
    const o200k = encoding_for_model("gpt-4o");
    const cl100k = get_encoding("cl100k_base");

    for (const c of CASES) {
      const encoding = c.tiktokenModel === "gpt-4o" ? o200k : cl100k;
      const fromCore = countOpenAiStyleMessages(encoding, c.messages, c.tiktokenModel);
      const fromNode = countFromNodeReexport(encoding, c.messages, c.tiktokenModel);
      const reference = referenceCount(
        (text) => encoding.encode(text).length,
        c.messages,
        c.tiktokenModel,
      );

      assert.equal(
        fromNode,
        fromCore,
        `re-export 版与 core 下沉版不一致（${c.name}）`,
      );
      assert.equal(
        fromCore,
        reference,
        `core 下沉版与独立参考实现不一致（${c.name}）`,
      );
    }
  });

  it("convertMessagesForWebTokenizer：Claude 风格转换两版一致且格式逐段正确", () => {
    const messages: readonly OpenAiStyleMessage[] = [
      { role: "System", content: "sys preamble" },
      { role: "user", content: "hi there" },
      { role: "human", content: "also human" },
      { role: "assistant", content: "answer here" },
      { role: "tool", content: "raw payload" },
    ];

    const fromCore = convertMessagesForWebTokenizer(messages);
    const fromNode = convertFromNodeReexport(messages);
    assert.equal(fromNode, fromCore);

    // 逐段钉死转换格式：system 裸拼、user/human → Human、assistant → Assistant、
    // 未知 role 原样保留。
    assert.equal(fromCore, [
      "sys preamble",
      "\n\nHuman: hi there",
      "\n\nHuman: also human",
      "\n\nAssistant: answer here",
      "\n\ntool: raw payload",
    ].join(""));
  });

  it("convertMessagesForWebTokenizer：无 Assistant 时补尾部引导词", () => {
    const messages: readonly OpenAiStyleMessage[] = [
      { role: "system", content: "only sys" },
      { role: "user", content: "question" },
    ];
    assert.equal(
      convertMessagesForWebTokenizer(messages),
      "only sys\n\nHuman: question\n\nAssistant:",
    );
    // re-export 版同步一致。
    assert.equal(
      convertFromNodeReexport(messages),
      convertMessagesForWebTokenizer(messages),
    );
  });

  it("countWebTokenizerMessages：两版一致且等于 encode(converted).length", () => {
    const o200k = encoding_for_model("gpt-4o");
    const messages: readonly OpenAiStyleMessage[] = [
      { role: "system", content: "他把伞收了。" },
      { role: "user", content: "讲个故事" },
    ];
    const encode = (text: string) => o200k.encode(text);

    const fromCore = countWebTokenizerMessages(encode, messages);
    const fromNode = countWebFromNodeReexport(encode, messages);
    const manual = encode(convertMessagesForWebTokenizer(messages)).length;

    assert.equal(fromNode, fromCore);
    assert.equal(fromCore, manual);
  });

  it("wrapSerializedPromptAsSystemMessage：两版一致，包成单条 system 消息", () => {
    const serialized = "\n\nHuman: wrapped prompt\n\nAssistant:";
    const fromCore = wrapSerializedPromptAsSystemMessage(serialized);
    const fromNode = wrapFromNodeReexport(serialized);

    assert.deepEqual(fromNode, fromCore);
    assert.deepEqual(fromCore, { role: "system", content: serialized });
  });
});
