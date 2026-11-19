const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

test('API development runner stops stale code, handles edits/errors/deletions, and releases its port', { timeout: 180000 }, async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'syncos-dev-runner-'));
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.writeFileSync(path.join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'CommonJS', outDir: 'dist', rootDir: 'src', types: [], strict: true }, include: ['src/**/*.ts'] }));
  const write = (name, value) => fs.writeFileSync(path.join(cwd, 'src', name), value);
  const main = (source) => `declare const require: any; import { version } from './${source}'; require('node:http').createServer((_req: any,res: any)=>res.end(version)).listen(${port},'127.0.0.1',()=>console.log('READY:'+version));`;
  write('main.ts', main('message'));
  write('message.ts', 'export const version: string = 1;');
  const script = path.resolve('apps/api/scripts/dev.js');
  const child = spawn(process.execPath, ['-e', `require(${JSON.stringify(script)}).startDevelopment({cwd:${JSON.stringify(cwd)}})`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const exited = once(child, 'exit');
  async function until(predicate) {
    const end = Date.now() + 45000;
    while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.fail(`Development runner timed out.\n${output}`);
  }
  const text = async () => { try { return await (await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) })).text(); } catch { return null; } };
  try {
    await until(() => output.includes('Compilation failed'));
    assert.equal(await text(), null, 'Initial compile failure must not start a server');
    write('message.ts', "export const version: string = 'first';");
    await until(async () => await text() === 'first');
    write('message.ts', 'export const version: string = 2;');
    await until(async () => await text() === null);
    await until(() => output.split('Compilation failed').length === 3);
    assert.equal(fs.existsSync(path.join(cwd, 'dist/main.js')), false, 'Invalid build must not retain executable output');
    write('message.ts', "export const version: string = 'second';");
    await until(async () => await text() === 'second');
    write('message.ts', "export const version: string = 'transient';");
    await new Promise(resolve => setTimeout(resolve, 30));
    write('message.ts', "export const version: string = 'latest';");
    await until(async () => await text() === 'latest');
    fs.renameSync(path.join(cwd, 'src/message.ts'), path.join(cwd, 'src/renamed.ts'));
    write('main.ts', main('renamed'));
    await until(() => fs.existsSync(path.join(cwd, 'dist/renamed.js')) && !fs.existsSync(path.join(cwd, 'dist/message.js')));
    await until(async () => await text() === 'latest');
    fs.unlinkSync(path.join(cwd, 'src/renamed.ts'));
    await until(async () => await text() === null);
    write('renamed.ts', "export const version: string = 'restored';");
    await until(async () => await text() === 'restored');
    assert.doesNotMatch(output, /EADDRINUSE/);
    child.kill('SIGTERM');
    await exited;
    assert.equal(await text(), null, 'Supervisor shutdown must release the server port');
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await exited; }
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
