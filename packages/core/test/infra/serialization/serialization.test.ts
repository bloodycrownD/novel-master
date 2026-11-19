import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  z  } from "zod";
import {  SerializationDecode, SerializationEncode, SerializationParseText, SerializationStringifyText  } from "@novel-master/core";
import {  unwrap  } from "../../helpers/result-unwrap.js";

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
    const fromYaml = unwrap(SerializationDecode.decode(unwrap(SerializationParseText.parse(yaml, "yaml")), schema));
    assert.deepEqual(fromYaml, { name: "test" });

    const json = '{"schemaVersion":1,"name":"test"}';
    const fromJson = unwrap(SerializationDecode.decode(unwrap(SerializationParseText.parse(json, "json")), schema));
    assert.deepEqual(fromJson, { name: "test" });

    const wire = SerializationEncode.encode(fromYaml, encodable);
    const again = unwrap(SerializationDecode.decode(wire, schema));
    assert.deepEqual(again, fromYaml);

    const roundTrip = unwrap(SerializationParseText.parse(SerializationStringifyText.stringify(wire, "yaml"), "yaml"));
    assert.deepEqual(unwrap(SerializationDecode.decode(roundTrip, schema)), fromYaml);
  });
});
