import assert from "node:assert/strict";
import test from "node:test";

import {
  LLAMA_ARGS,
  MODEL_ALIAS,
  MODEL_REPO,
  resolveLlamaServer,
} from "../../scripts/dev-gemma4.mjs";

test("Gemma launcher selects the requested multimodal GGUF", () => {
  assert.equal(MODEL_ALIAS, MODEL_REPO);
  assert.deepEqual(LLAMA_ARGS.slice(0, 4), [
    "--hf-repo",
    `${MODEL_REPO}:Q4_K_M`,
    "--alias",
    MODEL_REPO,
  ]);
  assert.ok(LLAMA_ARGS.includes("--jinja"));
  assert.ok(LLAMA_ARGS.includes("8000"));
});

test("Windows launcher discovers the winget llama-server path", () => {
  const env = { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" };
  const executable = resolveLlamaServer(env, "win32", (candidate) =>
    candidate.endsWith("llama-server.exe"),
  );
  assert.match(executable, /WinGet[\\/]Packages/);
});

test("explicit llama-server path wins on every platform", () => {
  assert.equal(
    resolveLlamaServer({ LLAMA_SERVER_PATH: "/opt/llama-server" }, "linux"),
    "/opt/llama-server",
  );
});
