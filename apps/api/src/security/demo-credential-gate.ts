import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import type {Pool} from 'pg';
import {verifyPassword} from '@syncos/auth';

export async function assertNoPublicDemoCredentials(pool:Pool,environment=process.env.NODE_ENV){
  if(!['staging','production'].includes(environment??''))return;
  // Read the published fixture value without logging or duplicating it in code.
  const seed=readFileSync(resolve(dirname(require.resolve('@syncos/database/package.json')),'scripts/seed-e2e-demo.js'),'utf8');
  const known=seed.match(/const demoPassword = "([^\"]+)"/);
  if(!known)throw new Error('Public fixture credential policy could not be verified');
  const rows=(await pool.query(`SELECT DISTINCT u.id,u.password_hash FROM users u
    JOIN tenant_users tu ON tu.user_id=u.id JOIN tenants t ON t.id=tu.tenant_id
    WHERE u.status='active' AND u.deleted_at IS NULL AND tu.status='active' AND tu.deleted_at IS NULL
      AND t.status='active' AND t.deleted_at IS NULL`)).rows;
  if(rows.some(row=>verifyPassword(known[1],row.password_hash)))throw new Error('Deployment blocked: active account still accepts a publicly known fixture credential');
}
