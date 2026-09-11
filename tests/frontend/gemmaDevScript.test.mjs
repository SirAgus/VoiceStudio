import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

test("Gemma development command starts and supervises the full browser stack", () => {
  assert.match(packageJson.scripts["dev:gemma4-server"], /scripts\/dev-gemma4\.mjs/);

  const command = packageJson.scripts["dev:gemma4"];
  assert.match(command, /bun run setup:api/);
  assert.match(command, /bun run dev:gemma4-server/);
  assert.match(command, /bun run dev:api/);
  assert.match(command, /bun run dev:frontend/);
  assert.match(command, /--kill-others-on-fail/);
});
