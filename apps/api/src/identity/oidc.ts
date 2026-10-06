import {randomBytes,createHash} from 'node:crypto';
// Native import keeps the maintained ESM verifier usable from the CommonJS API build.
const loadJose = new Function('return import("jose")') as () => Promise<typeof import('jose')>;
export type OidcConnection={id:string;tenant_id:string;issuer:string;client_id:string;secret_env:string;authorization_endpoint:string;token_endpoint:string;jwks_uri:string;version:number};
export function providerUrl(value:string){
 const url=new URL(value),allowed=(process.env.SSO_ALLOWED_HOSTS??'').split(',').map(v=>v.trim()).filter(Boolean);
 const localTest=process.env.NODE_ENV==='test'&&['localhost','127.0.0.1'].includes(url.hostname);
 if((url.protocol!=='https:'&&!localTest)||!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hash||(!localTest&&!allowed.includes(url.host)))throw Error('SSO endpoint is not approved');
 return url;
}
export function callbackUrl(){const base=new URL(process.env.APPLICATION_BASE_URL??'');if(base.protocol!=='https:'&&process.env.NODE_ENV!=='test')throw Error('HTTPS application address required');return new URL('/sso/callback',base).toString();}
export function validateConnection(c:OidcConnection){for(const value of [c.issuer,c.authorization_endpoint,c.token_endpoint,c.jwks_uri])providerUrl(value);if(!/^SSO_CLIENT_SECRET_[A-Z0-9_]+$/.test(c.secret_env)||!c.client_id||c.client_id.length>512)throw Error('SSO client configuration is invalid');}
export function authorizationRequest(c:OidcConnection,state:string,nonce:string,verifier:string){validateConnection(c);const url=providerUrl(c.authorization_endpoint);for(const [key,value] of Object.entries({response_type:'code',client_id:c.client_id,redirect_uri:callbackUrl(),scope:'openid email',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}))url.searchParams.set(key,value);return url.toString();}
export const randomIdentityToken=()=>randomBytes(32).toString('base64url');
export async function exchangeIdentity(c:OidcConnection,code:string,verifier:string,nonce:string){
 validateConnection(c);const secret=process.env[c.secret_env];if(!secret)throw Error('SSO credentials are unavailable');
 const form=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:callbackUrl(),client_id:c.client_id,client_secret:secret,code_verifier:verifier});
 const response=await fetch(providerUrl(c.token_endpoint),{method:'POST',redirect:'error',headers:{'content-type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('SSO token exchange failed');
 // Bound provider responses instead of allowing an untrusted body to exhaust memory.
 const reader=response.body?.getReader();if(!reader)throw Error('SSO response is empty');let total=0;const chunks:Uint8Array[]=[];
 try{while(true){const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>65536)throw Error('SSO response exceeds limit');chunks.push(part.value);}}finally{await reader.cancel();}
 const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(typeof body.id_token!=='string'||body.id_token.length>32768)throw Error('SSO identity token is missing');
 const {createRemoteJWKSet,jwtVerify}=await loadJose();
 const keys=createRemoteJWKSet(providerUrl(c.jwks_uri),{timeoutDuration:10000});
 const {payload}=await jwtVerify(body.id_token,keys,{issuer:c.issuer,audience:c.client_id,algorithms:['RS256','ES256'],requiredClaims:['exp','iat','sub','nonce'],maxTokenAge:'10m',clockTolerance:5});
 if(payload.nonce!==nonce||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>512)throw Error('SSO identity did not match this request');
 if((Array.isArray(payload.aud)&&payload.aud.length>1&&payload.azp!==c.client_id)||(payload.azp!==undefined&&payload.azp!==c.client_id))throw Error('SSO authorized party did not match');
 return {subject:payload.sub};
}
