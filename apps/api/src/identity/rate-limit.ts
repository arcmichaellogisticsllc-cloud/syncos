import type {PoolClient} from 'pg';
import {tokenDigest} from './secret-envelope';
export async function identityLimited(c:PoolClient,purpose:string,ip:string,email:string){
 let limited=false;
 for(const [value,max] of [[`ip:${ip}`,20],[`email:${email}`,3]] as const){
  const row=(await c.query(`INSERT INTO identity_rate_limits(key_hash,window_start,attempts) VALUES($1,now(),1)
   ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN identity_rate_limits.window_start<now()-interval '1 hour' THEN 1 ELSE identity_rate_limits.attempts+1 END,
   window_start=CASE WHEN identity_rate_limits.window_start<now()-interval '1 hour' THEN now() ELSE identity_rate_limits.window_start END RETURNING attempts`,[tokenDigest(purpose+value)])).rows[0];
  if(row.attempts>max)limited=true;
 }
 return limited;
}
