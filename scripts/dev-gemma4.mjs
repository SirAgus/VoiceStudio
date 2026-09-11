import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const MODEL_REPO = "HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive";
export const MODEL_ALIAS = MODEL_REPO;
export const LLAMA_ARGS = [
  "--hf-repo",
  `${MODEL_REPO}:Q4_K_M`,
  "--alias",
  MODEL_ALIAS,
  "--host",
  "127.0.0.1",
  "--port",
  "8000",
  "--ctx-size",
  "8192",
  "--temp",
  "1.0",
  "--top-p",
  "0.95",
  "--top-k",
  "64",
  "--jinja",
];

export function resolveLlamaServer(
  env = process.env,
  platform = process.platform,
  isFile = existsSync,
) {
  if (env.LLAMA_SERVER_PATH) return env.LLAMA_SERVER_PATH;
  if (platform !== "win32") return "llama-server";

  const localAppData = env.LOCALAPPDATA || "";
  const wingetPath = path.join(
    localAppData,
    "Microsoft",
    "WinGet",
    "Packages",
    "ggml.llamacpp_Microsoft.Winget.Source_8wekyb3d8bbwe",
    "llama-server.exe",
  );
  return isFile(wingetPath) ? wingetPath : "llama-server.exe";
}

export function startServer({ spawnProcess = spawn, env = process.env } = {}) {
  const command = resolveLlamaServer(env);
  const child = spawnProcess(command, LLAMA_ARGS, { stdio: "inherit", env });

  child.once("error", (error) => {
    console.error(
      `[gemma4] Could not start llama-server (${error.message}). ` +
        "Install llama.cpp or set LLAMA_SERVER_PATH to the executable.",
    );
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 0);
  });

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    try {
      process.on(signal, () => child.kill(signal));
    } catch {
      // Some Windows runtimes do not expose every POSIX signal.
    }
  }
  return child;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) startServer();
