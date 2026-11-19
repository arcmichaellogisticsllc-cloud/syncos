const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let RestrictedFileService;
let calculateRestrictedFileSha256;
try {
  process.env.NODE_PATH = [process.env.NODE_PATH, path.resolve(__dirname, '../node_modules')].filter(Boolean).join(path.delimiter);
  require('node:module').Module._initPaths();
  const compiledRoot = process.env.SYNCOS_RF_COMPILED_ROOT || (require('node:fs').existsSync('/tmp/syncos-rf-compiled/restricted-file.service.js') ? '/tmp/syncos-rf-compiled' : '../apps/api/dist/restricted-files');
  ({ RestrictedFileService } = require(path.resolve(__dirname, compiledRoot, 'restricted-file.service.js')));
  ({ calculateRestrictedFileSha256 } = require(path.resolve(__dirname, compiledRoot, 'restricted-file.primitives.js')));
} catch {
  // The API build produces these files before the focused behavioral gate runs.
}

const bytes = Buffer.from('%PDF-1.7\nfixture');
const baseParams = (client) => ({
  client,
  tenantId: 'tenant-test', organizationId: 'org-test', capacityProviderId: 'provider-test',
  actorUserId: 'actor-test', category: 'worker_credential_evidence',
  relatedEntityType: 'worker', relatedEntityId: 'worker-test',
  raw: { file_name: 'fixture.pdf', mime_type: 'application/pdf', content_base64: bytes.toString('base64') },
  maxSize: 1024 * 1024, allowedMimes: new Set(['application/pdf']),
});

function requireService() {
  assert.ok(RestrictedFileService, 'API build output is required for executable service tests');
  return new RestrictedFileService();
}

async function filesUnder(root) {
  const out = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(p); else out.push(p);
    }
  }
  await walk(root);
  return out;
}

test('RestrictedFileService writes exact bytes and uses supplied PoolClient', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'syncos-rf-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: 'rf-1' }] }; } };
  const old = process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR;
  process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR = root;
  t.after(() => { if (old === undefined) delete process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR; else process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR = old; });
  const result = await requireService().createRestrictedFileObject(baseParams(client));
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO partner_restricted_file_objects/);
  assert.deepEqual(calls[0].params.slice(0, 10), ['tenant-test', 'org-test', 'provider-test', 'worker_credential_evidence', 'worker', 'worker-test', 'fixture.pdf', 'application/pdf', bytes.length, calculateRestrictedFileSha256(bytes)]);
  const stored = await filesUnder(root);
  assert.equal(stored.length, 1);
  assert.deepEqual(await fs.readFile(stored[0]), bytes);
  assert.equal(result.file.id, 'rf-1');
  assert.equal(typeof result.storageKey, 'string');
  assert.ok(!JSON.stringify(result.file).includes(root));
});

test('RestrictedFileService write failure skips metadata insert', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'syncos-rf-fail-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'tenant-test'), 'not-a-directory');
  let queried = false;
  const client = { query: async () => { queried = true; } };
  const old = process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR;
  process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR = root;
  t.after(() => { if (old === undefined) delete process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR; else process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR = old; });
  await assert.rejects(() => requireService().createRestrictedFileObject(baseParams(client)));
  assert.equal(queried, false);
  assert.deepEqual(await filesUnder(root), [path.join(root, 'tenant-test')]);
});

test('RestrictedFileService metadata failure cleans up written bytes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'syncos-rf-meta-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let queried = false;
  const client = { query: async () => { queried = true; throw new Error('db failure'); } };
  const old = process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR;
  process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR = root;
  t.after(() => { if (old === undefined) delete process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR; else process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR = old; });
  await assert.rejects(() => requireService().createRestrictedFileObject(baseParams(client)), /db failure/);
  assert.equal(queried, true);
  assert.deepEqual(await filesUnder(root), []);
});
