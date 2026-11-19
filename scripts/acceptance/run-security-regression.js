"use strict";

const { Client } = require("pg");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { acceptanceEnvironment } = require("./run-regression");

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function main() {
  const env = acceptanceEnvironment(process.env);
  const database = `syncos_synthetic_security_audit_${process.pid}_${Date.now()}`;
  const target = new URL(env.DATABASE_URL); target.pathname = `/${database}`;
  const admin = new Client({ connectionString: env.DATABASE_URL });
  const children = new Set();
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "syncos-security-regression-"));
  let created = false;
  function launch(args, childEnv, cwd = process.cwd()) {
    const child = spawn(process.execPath, args, { cwd, env: childEnv, stdio: "inherit" });
    children.add(child);
    child.on("exit", () => children.delete(child));
    return child;
  }
  async function run(args, childEnv) {
    const child = launch(args, childEnv);
    const [code] = await once(child, "exit");
    if (code !== 0) throw new Error(`Validation subprocess failed (${code}): ${args[0]}`);
  }
  async function ready(url, child) {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("Security test service exited before readiness");
      try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error("Security test service did not become ready");
  }
  async function stop(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit"); child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 5000);
    try { await exited; } finally { clearTimeout(force); }
  }
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`); created = true;
    const apiPort = await freePort(), webPort = await freePort();
    const api = `http://127.0.0.1:${apiPort}`, web = `http://127.0.0.1:${webPort}`;
    const securityEnv = { ...env, DATABASE_URL: target.href, HOST: "127.0.0.1", PORT: String(apiPort), API_BASE_URL: api, SYNCOS_API_BASE_URL: api, SYNCOS_WEB_ORIGIN: web, SYNCOS_RESTRICTED_FILE_STORAGE_DIR: storage };
    await run(["packages/database/scripts/migrate.js"], securityEnv);
    await run(["packages/database/scripts/seed.js"], securityEnv);
    await run(["packages/database/scripts/seed-e2e-demo.js"], securityEnv);
    const apiChild = launch(["apps/api/dist/main.js"], securityEnv);
    await ready(`${api}/health`, apiChild);
    const webChild = launch([require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(webPort)], securityEnv, path.resolve("apps/web"));
    await ready(`${web}/login`, webChild);
    await run(["scripts/acceptance/run-regression.js"], { ...env, SYNCOS_SECURITY_TEST_DATABASE_URL: target.href, SYNCOS_SECURITY_TEST_API: api, SYNCOS_SECURITY_TEST_WEB: web });
  } finally {
    await Promise.all([...children].map(stop));
    if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end();
    fs.rmSync(storage, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
