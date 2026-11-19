"use strict";

const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// A complete, clean compilation precedes every restart. Never serve stale code
// after a source change or a compiler error.
function startDevelopment({ cwd = process.cwd(), debounceMs = 150 } = {}) {
  let compiler, server, timer, closing = false, revision = 0;
  let transitions = Promise.resolve();
  const watchers = [];

  async function stop(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 3000);
    try { await exited; } finally { clearTimeout(force); }
  }

  function launch(args) {
    const child = spawn(process.execPath, args, { cwd, env: process.env, stdio: "inherit" });
    child.on("error", (error) => { console.error(error.message); void shutdown(1); });
    return child;
  }

  async function rebuild(expectedRevision) {
    await stop(server); server = undefined;
    await stop(compiler); compiler = undefined;
    if (closing || expectedRevision !== revision) return;
    fs.rmSync(path.join(cwd, "dist"), { recursive: true, force: true });
    console.log("[dev] Compiling; server stopped.");
    const child = compiler = launch([require.resolve("typescript/bin/tsc"), "--project", "tsconfig.json", "--noEmitOnError"]);
    child.once("exit", (code) => {
      transitions = transitions.then(async () => {
        if (compiler === child) compiler = undefined;
        if (closing || expectedRevision !== revision) return;
        if (code !== 0) { console.log("[dev] Compilation failed; server remains stopped."); return; }
        server = launch([path.join(cwd, "dist/main.js")]);
      }).catch(fatal);
    });
  }

  function changed() {
    if (closing) return;
    const expectedRevision = ++revision;
    clearTimeout(timer);
    // Quiesce immediately, including an obsolete compilation, before debounce.
    transitions = transitions.then(async () => { await stop(server); server = undefined; await stop(compiler); compiler = undefined; }).catch(fatal);
    timer = setTimeout(() => {
      transitions = transitions.then(() => rebuild(expectedRevision)).catch(fatal);
    }, debounceMs);
  }

  async function shutdown(code = 0) {
    if (closing) return;
    closing = true; revision++;
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
    await transitions;
    await Promise.all([stop(server), stop(compiler)]);
    process.exitCode = code;
  }
  function fatal(error) { console.error(error.message); void shutdown(1); }

  // TypeScript's directory watcher reports renames only; ordinary in-place
  // edits must also stop and rebuild the server.
  const sourceWatcher = fs.watch(path.join(cwd, "src"), { recursive: true }, changed);
  sourceWatcher.on("error", fatal);
  watchers.push(sourceWatcher);
  for (const config of [path.join(cwd, "tsconfig.json"), path.resolve(cwd, "../../tsconfig.base.json")]) {
    if (fs.existsSync(config)) watchers.push(ts.sys.watchFile(config, changed, 250));
  }
  process.once("SIGINT", () => { void shutdown(130); });
  process.once("SIGTERM", () => { void shutdown(143); });
  changed();
  return { shutdown };
}

if (require.main === module) startDevelopment();
module.exports = { startDevelopment };
