import assert from "node:assert/strict";
import test from "node:test";
import {
  EventActionDagError,
  validateEventActionDag,
} from "../../../src/domain/events-config/logic/validate-event-action-dag.js";

test("validateEventActionDag accepts acyclic graph", () => {
  assert.doesNotThrow(() =>
    validateEventActionDag([
      { type: "hide-message", dependency: ["run-agent"] },
      { type: "run-agent" },
    ]),
  );
});

test("validateEventActionDag rejects duplicate action type", () => {
  assert.throws(
    () =>
      validateEventActionDag([
        { type: "hide-message" },
        { type: "hide-message" },
      ]),
    (e: unknown) => {
      assert.ok(e instanceof EventActionDagError);
      assert.equal(e.code, "duplicate_action_type");
      assert.match(e.message, /hide-message/);
      return true;
    },
  );
});

test("validateEventActionDag rejects unknown dependency", () => {
  assert.throws(
    () => validateEventActionDag([{ type: "hide-message", dependency: ["run-agent"] }]),
    (e: unknown) => {
      assert.ok(e instanceof EventActionDagError);
      assert.equal(e.code, "unknown_dependency");
      assert.equal(e.actionType, "hide-message");
      assert.equal(e.dependency, "run-agent");
      return true;
    },
  );
});

test("validateEventActionDag rejects self dependency", () => {
  assert.throws(
    () => validateEventActionDag([{ type: "hide-message", dependency: ["hide-message"] }]),
    (e: unknown) => {
      assert.ok(e instanceof EventActionDagError);
      assert.equal(e.code, "self_dependency");
      return true;
    },
  );
});

test("validateEventActionDag rejects cycle", () => {
  assert.throws(
    () =>
      validateEventActionDag([
        { type: "hide-message", dependency: ["run-agent"] },
        { type: "run-agent", dependency: ["hide-message"] },
      ]),
    (e: unknown) => {
      assert.ok(e instanceof EventActionDagError);
      assert.equal(e.code, "cycle");
      assert.match(e.message, /cycle/);
      return true;
    },
  );
});
