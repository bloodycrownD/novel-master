import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import {
  decode,
  encode,
  parseText,
  stringifyText,
} from "@novel-master/core";
import { unwrap } from "../../helpers/result-unwrap.js";

describe("serialization", () => {
  const schema = z
    .object({ schemaVersion: z.literal(1), name: z.string() })
    .strict()
    .transform((doc) => ({ name: doc.name }));

  const encodable = Object.assign(schema, {
    toWire: (value: { name: string }) => ({
      schemaVersion: 1 as const,
      name: value.name,
    }),
  });

  it("SER1: parseText yaml/json → decode → encode stable", () => {
    // 四期签名：parseText / decode 均返回 Result，测试边界统一解包。
    const yaml = "schemaVersion: 1\nname: test\n";
    const fromYaml = unwrap(decode(unwrap(parseText(yaml, "yaml")), schema));
    assert.deepEqual(fromYaml, { name: "test" });

    const json = '{"schemaVersion":1,"name":"test"}';
    const fromJson = unwrap(decode(unwrap(parseText(json, "json")), schema));
    assert.deepEqual(fromJson, { name: "test" });

    const wire = encode(fromYaml, encodable);
    const again = unwrap(decode(wire, schema));
    assert.deepEqual(again, fromYaml);

    const roundTrip = unwrap(parseText(stringifyText(wire, "yaml"), "yaml"));
    assert.deepEqual(unwrap(decode(roundTrip, schema)), fromYaml);
  });
});
