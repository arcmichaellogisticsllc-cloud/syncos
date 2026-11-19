import {sendSmtpRelayEmail} from './smtp-relay';
export async function sendIdentityMail(to:string,url:string,id:string){
 if(process.env.NODE_ENV==='staging'&&!(process.env.STAGING_EMAIL_RECIPIENT_ALLOWLIST??'').split(',').map(v=>v.trim().toLowerCase()).includes(to.toLowerCase()))throw Error('Recipient not allowed');
 const message={from:process.env.EMAIL_FROM??'',to,subject:'Your SyncOS sign-in link',text:`Sign in to SyncOS using this single-use link within 15 minutes:\n\n${url}\n\nOnly continue if you requested this link. This link does not change your password.`};
 if(process.env.EMAIL_PROVIDER==='smtp_relay'){await sendSmtpRelayEmail(message);return;}
 if(process.env.EMAIL_PROVIDER==='generic_http'){
  const endpoint=new URL(process.env.EMAIL_HTTP_ENDPOINT??'');
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||!process.env.EMAIL_API_KEY||!message.from)throw Error('Email configuration unavailable');
  const result=await fetch(endpoint,{method:'POST',redirect:'error',headers:{authorization:`Bearer ${process.env.EMAIL_API_KEY}`,'content-type':'application/json','idempotency-key':id},body:JSON.stringify(message),signal:AbortSignal.timeout(10000)});
  if(!result.ok)throw Error('Email provider rejected delivery');return;
 }
 throw Error('Email delivery is not configured');
}
