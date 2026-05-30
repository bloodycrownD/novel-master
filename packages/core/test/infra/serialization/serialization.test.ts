import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import {
  decode,
  encode,
  parseText,
  stringifyText,
} from "@novel-master/core";

describe("serialization", () => {
  const schema = z
    .object({ schemaVersion: z.literal(1), name: z.string() })
    .strict()
    .transform((doc) => ({ name: doc.name }));

  const encodable = Object.assign(schema, {
    encode: (value: { name: string }) => ({
      schemaVersion: 1 as const,
      name: value.name,
    }),
  });

  it("SER1: parseText yaml/json → decode → encode stable", () => {
    const yaml = "schemaVersion: 1\nname: test\n";
    const fromYaml = decode(parseText(yaml, "yaml"), schema);
    assert.deepEqual(fromYaml, { name: "test" });

    const json = '{"schemaVersion":1,"name":"test"}';
    const fromJson = decode(parseText(json, "json"), schema);
    assert.deepEqual(fromJson, { name: "test" });

    const wire = encode(fromYaml, encodable);
    const again = decode(wire, schema);
    assert.deepEqual(again, fromYaml);

    const roundTrip = parseText(stringifyText(wire, "yaml"), "yaml");
    assert.deepEqual(decode(roundTrip, schema), fromYaml);
  });
});
