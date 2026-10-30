import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_NAME } from "../src/version.js";

test("app name is set", () => {
  assert.equal(APP_NAME, "Market as Music");
});
