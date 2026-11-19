import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
export const tokenDigest=(value:string)=>createHash('sha256').update(value).digest('hex');
function key(purpose:string){const secret=process.env.AUTH_JWT_SECRET;if(!secret||secret.length<32)throw Error('Identity encryption is unavailable');return createHash('sha256').update(`syncos:${purpose}:${secret}`).digest();}
export function sealIdentity(purpose:string,value:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(purpose),iv);const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64');}
export function openIdentity(purpose:string,value:string){const bytes=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key(purpose),bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');}
