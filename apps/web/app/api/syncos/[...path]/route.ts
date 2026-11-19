import {NextRequest,NextResponse} from 'next/server';
import {Buffer} from 'node:buffer';
import {randomUUID} from 'node:crypto';

const cookieName='syncos_session';
const signInPaths=new Set(['auth/login','auth/sso/complete','auth/magic-link/complete','partner-invitations/accept']);
function apiBaseUrl(){
 if(process.env.SYNCOS_API_BASE_URL)return process.env.SYNCOS_API_BASE_URL;
 if(process.env.NODE_ENV==='production')throw new Error('SYNCOS_API_BASE_URL is required for the production web proxy');
 return process.env.NEXT_PUBLIC_API_BASE_URL??'http://localhost:3100';
}
function sessionCookie(request:NextRequest){
 return request.cookies?.get(cookieName)?.value??request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
}
function setSession(response:NextResponse,request:NextRequest,token:string,maxAge:number){
 response.cookies.set(cookieName,token,{httpOnly:true,secure:process.env.NODE_ENV==='production'||request.nextUrl.protocol==='https:',sameSite:'strict',path:'/',maxAge});
}
async function proxy(request:NextRequest,context:{params:Promise<{path:string[]}>}){
 const path=(await context.params).path.join('/');
 const cookie=sessionCookie(request);
 const supplied=request.headers.get('authorization');
 // Browser markers contain identity hints for locally scoped drafts, never credentials.
 const bearer=supplied&&!supplied.startsWith('Bearer browser-session.')?supplied:null;
 const logout=path==='auth/browser-logout';
 if(logout&&request.method!=='POST')return NextResponse.json({message:'Use POST to sign out'},{status:405});
 const signIn=signInPaths.has(path)&&request.method==='POST';
 if(!['GET','HEAD','OPTIONS'].includes(request.method)&&(cookie||signIn||logout)){
  const origin=process.env.SYNCOS_WEB_ORIGIN??request.nextUrl.origin;
  if(request.headers.get('origin')!==origin||request.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({message:'Request origin was not accepted'},{status:403});
 }
 const target=new URL(`${apiBaseUrl()}/${logout?'auth/logout':path}`);
 request.nextUrl.searchParams.forEach((value,key)=>target.searchParams.set(key,value));
 const headers=new Headers();
 const authorization=bearer??(cookie?`Bearer ${cookie}`:null);
 if(authorization)headers.set('authorization',authorization);
 if(process.env.SYNCOS_TRUST_LOOPBACK_PROXY==='true'){
  const forwarded=request.headers.get('x-forwarded-for');if(forwarded)headers.set('x-forwarded-for',forwarded);
 }
 const contentType=request.headers.get('content-type');if(contentType)headers.set('content-type',contentType);
 if(logout&&!authorization){const result=NextResponse.json({signed_out:true});setSession(result,request,'',0);return result;}
 const response=await fetch(target,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer(),cache:'no-store'});
 const responseHeaders:Record<string,string>={'content-type':response.headers.get('content-type')??'application/json','cache-control':'no-store','x-content-type-options':'nosniff'};
 const disposition=response.headers.get('content-disposition');if(disposition)responseHeaders['content-disposition']=disposition;
 const exchange=path==='auth/me'&&!!bearer&&response.ok;
 if((signIn&&response.ok)||exchange){
  const body=await response.json();
  const sessionToken=exchange?bearer!.slice(7):body?.token;
  if(typeof sessionToken!=='string')return NextResponse.json({message:'Sign-in response was incomplete'},{status:502});
  let claims;
  try { claims=JSON.parse(Buffer.from(sessionToken.split('.')[1],'base64url').toString()); } catch { return NextResponse.json({message:'Sign-in session was invalid'},{status:502}); }
  if(!claims||typeof claims.exp!=='number'||!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now())return NextResponse.json({message:'Sign-in session was invalid'},{status:502});
  const hint={sub:claims.sub,tenant_id:claims.tenant_id,email:claims.email,exp:claims.exp,nonce:randomUUID()};
  const marker=`browser-session.${Buffer.from(JSON.stringify(hint)).toString('base64url')}.hint`;
  const result=NextResponse.json({...body,...(exchange?{browser_session:marker}:{token:marker})},{status:response.status,headers:responseHeaders});
  setSession(result,request,sessionToken,Math.min(43200,Math.max(1,Math.floor(claims.exp-Date.now()/1000))));return result;
 }
 if(logout&&response.status===401){const result=NextResponse.json({signed_out:true});setSession(result,request,'',0);return result;}
 const result=new NextResponse([204,205,304].includes(response.status)?null:await response.arrayBuffer(),{status:response.status,headers:responseHeaders});
 if(logout||signIn||(cookie&&response.status===401))setSession(result,request,'',0);
 return result;
}
export const GET=proxy;
export const POST=proxy;
export const PATCH=proxy;
