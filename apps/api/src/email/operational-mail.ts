import {sendSmtpRelayEmail} from './smtp-relay';
export async function sendOperationalMail(to:string,subject:string,route:string,id:string){
 if(process.env.NODE_ENV==='staging'&&!(process.env.STAGING_EMAIL_RECIPIENT_ALLOWLIST??'').split(',').map(s=>s.trim().toLowerCase()).includes(to.toLowerCase()))throw Error('Recipient not allowed');
 const base=new URL(process.env.APPLICATION_BASE_URL??'');if(base.protocol!=='https:'&&process.env.NODE_ENV!=='test')throw Error('HTTPS required');
 const message={from:process.env.EMAIL_FROM??'',to,subject,text:`Sign in to review your SyncOS work queue: ${new URL(route,base)}. This notification does not authorize field work, customer acceptance or payment.`};
 if(process.env.EMAIL_PROVIDER==='smtp_relay'){await sendSmtpRelayEmail(message);return;}
 if(process.env.EMAIL_PROVIDER==='generic_http'){const endpoint=new URL(process.env.EMAIL_HTTP_ENDPOINT??'');if(endpoint.protocol!=='https:'||!process.env.EMAIL_API_KEY||!message.from)throw Error('Email configuration unavailable');const result=await fetch(endpoint,{method:'POST',redirect:'error',headers:{authorization:`Bearer ${process.env.EMAIL_API_KEY}`,'content-type':'application/json','idempotency-key':id},body:JSON.stringify(message),signal:AbortSignal.timeout(10000)});if(!result.ok)throw Error('Provider rejected notification');return;}
 throw Error('Email delivery is not configured');
}
