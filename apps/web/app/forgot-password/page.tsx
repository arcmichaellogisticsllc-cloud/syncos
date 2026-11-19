"use client";
import {useState,useRef,type FormEvent} from 'react';
import Link from 'next/link';
import {syncosFetch} from '../intelligence/api';
export default function ForgotPassword(){const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');const gate=useRef(false);
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(gate.current)return;gate.current=true;setBusy(true);setError('');try{const r=await syncosFetch<{message:string}>('auth/password-recovery/request',{method:'POST',token:'',body:{email:new FormData(e.currentTarget).get('email')}});setMessage(r.message);}catch{setError('Unable to request recovery. Your email is preserved; try again or contact your administrator.');}finally{gate.current=false;setBusy(false);}}
 return <main className="login-shell"><section className="login-panel"><h1>Recover your SyncOS account</h1><p>Enter the email used to sign in. Recovery links expire after 15 minutes.</p><form onSubmit={submit}><fieldset disabled={busy} style={{border:0,minWidth:0}}><label className="form-field">Email<input name="email" type="email" autoComplete="username" required maxLength={254}/></label><button type="submit" style={{minHeight:44}}>{busy?'Requesting…':'Send recovery instructions'}</button></fieldset></form>{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}<p><Link href="/login">Return to sign in</Link></p></section></main>;
}
