import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgv } from "../src/config.js";
import { ConfigError } from "../src/errors.js";

describe("config", () => {
  it("normalizes trailing-slash prefix at parse time (C1)", () => {
    const { config } = parseArgv([
      "push",
      "--mirror",
      "/tmp/mirror",
      "--prefix",
      "/project/",
    ]);
    assert.equal(config.prefix, "/project");
  });

  it("rejects invalid prefix with ConfigError (I2)", () => {
    assert.throws(
      () =>
        parseArgv([
          "push",
          "--mirror",
          "/tmp/mirror",
          "--prefix",
          "../bad",
        ]),
      ConfigError,
    );
  });
});
