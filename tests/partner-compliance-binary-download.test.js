const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

process.env.NODE_PATH = [path.join(process.cwd(), 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();
const { PartnerComplianceController } = require('../apps/api/dist/routes/partner-compliance.controller.js');
const { RestrictedFileService } = require('../apps/api/dist/restricted-files/restricted-file.service.js');

const pdf = Buffer.from('%PDF-1.4\nSYNCOS-TEST\n%%EOF\n');

function responseCapture() {
  const headers = new Map();
  return { headers, body: null, setHeader(k, v) { headers.set(k.toLowerCase(), String(v)); }, end(body) { this.body = Buffer.from(body); return this; } };
}

async function fixture({ bytes = pdf, mime = 'application/pdf', fileName = 'evidence.pdf', key = 'tenant-a/org-a/object.pdf' } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'syncos-download-'));
  process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR = root;
  const full = path.join(root, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  if (bytes !== null) await fs.writeFile(full, bytes);
  const client = { async query(sql) { if (sql.includes('partner_restricted_file_objects')) return { rows: [{ id: 'rf-a', storage_key: key, mime_type: mime }] }; return { rows: [] }; }, release() {} };
  const pool = { async connect() { return client; } };
  const controller = new PartnerComplianceController(pool, {}, new RestrictedFileService());
  controller.resolvePartnerContext = async () => ({ tenant_id: 'tenant-a', persona: 'partner_admin', organization: { id: 'org-a' }, capacityProvider: { id: 'cp-a' }, user: { id: 'user-a' } });
  controller.requirePartnerAdmin = () => {};
  controller.requireEvidence = async () => ({ id: 'ev-a', tenant_id: 'tenant-a', organization_id: 'org-a', restricted_file_object_id: 'rf-a', category: 'partner_w9', file_name: fileName, mime_type: mime, size_bytes: bytes ? bytes.length : 0 });
  let audits = 0;
  controller.auditEvidenceAccess = async () => { audits += 1; };
  const request = { auth: { tenantId: 'tenant-a', userId: 'user-a' }, header: () => undefined, ip: '127.0.0.1' };
  return { root, controller, request, response: responseCapture(), get audits() { return audits; }, bytes };
}

test('Partner binary download returns exact bytes and secure attachment headers', async () => {
  const f = await fixture({ fileName: 'w9 final.pdf' });
  try {
    await f.controller.downloadEvidence(f.request, 'ev-a', {}, f.response);
    assert.deepEqual(f.response.body, pdf);
    assert.equal(f.response.headers.get('content-type'), 'application/pdf');
    assert.match(f.response.headers.get('content-disposition'), /^attachment;/);
    assert.equal(f.response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(f.response.headers.get('cache-control'), /private/);
    assert.match(f.response.headers.get('cache-control'), /no-store/);
    assert.equal(f.response.headers.get('content-length'), String(pdf.length));
    assert.equal(f.audits, 1);
    assert.equal(f.response.body.toString('base64').includes('content_base64'), false);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('exact linked artifact is selected and hostile filename cannot inject headers', async () => {
  const f = await fixture({ fileName: '../../evil\";\r\nX-Leak: yes.pdf' });
  try {
    await f.controller.downloadEvidence(f.request, 'ev-a', {}, f.response);
    const cd = f.response.headers.get('content-disposition');
    assert.match(cd, /^attachment;/);
    assert.equal(cd.includes('\r'), false); assert.equal(cd.includes('\n'), false);
    assert.equal(f.response.body.equals(pdf), true);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('missing bytes and unsupported MIME fail safely without a response body', async () => {
  const missing = await fixture({ bytes: null });
  try { await assert.rejects(() => missing.controller.downloadEvidence(missing.request, 'ev-a', {}, missing.response)); assert.equal(missing.response.body, null); assert.equal(missing.audits, 0); }
  finally { await fs.rm(missing.root, { recursive: true, force: true }); }
  const bad = await fixture({ mime: 'text/html' });
  try { await assert.rejects(() => bad.controller.downloadEvidence(bad.request, 'ev-a', {}, bad.response)); assert.equal(bad.response.body, null); assert.equal(bad.audits, 1); }
  finally { await fs.rm(bad.root, { recursive: true, force: true }); }
});

test('Partner Foreman and cross-scope callers are denied before bytes are returned', async () => {
  const f = await fixture();
  try {
    f.controller.requirePartnerAdmin = () => { throw new Error('denied'); };
    await assert.rejects(() => f.controller.downloadEvidence(f.request, 'ev-a', {}, f.response));
    assert.equal(f.response.body, null);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});
