import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {UnauthorizedException} from '@nestjs/common';
import {logStructured} from '../instrumentation/structured-logger';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function consumeLoginBudget(pool:Pool,email:string,ip:string){
 // Global budget is checked before storing attacker-chosen identity keys. Expired
 // keys are removed in bounded batches; counters persist across API processes.
 const windows:[string,number][]=[['global',3000],['network:'+ip,300],['account:'+email,10]];
 await pool.query("DELETE FROM password_login_limits WHERE key_hash IN (SELECT key_hash FROM password_login_limits WHERE window_start<now()-interval '15 minutes' LIMIT 100)");
 for(const [key,maximum] of windows){
  const row=(await pool.query(`INSERT INTO password_login_limits(key_hash,attempts,window_start) VALUES($1,1,now())
   ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN password_login_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE password_login_limits.attempts+1 END,
    window_start=CASE WHEN password_login_limits.window_start<now()-interval '15 minutes' THEN now() ELSE password_login_limits.window_start END RETURNING attempts`,[digest(key)])).rows[0];
  if(!row||Number(row.attempts)>maximum){logStructured('Security','password_login_throttled',{budget:key.split(':')[0]});throw new UnauthorizedException('Invalid email or password');}
 }
}
export async function clearLoginAccountBudget(pool:Pool,email:string){await pool.query('DELETE FROM password_login_limits WHERE key_hash=$1',[digest('account:'+email)]);}
