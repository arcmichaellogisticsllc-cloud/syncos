"use client";
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {clearAuthContext,saveToken,syncosFetch,workspaceRouteFor,type AuthContext} from '../../intelligence/api';
export default function SsoCallback(){const [error,setError]=useState('');const started=useRef(false);
 useEffect(()=>{if(started.current)return;started.current=true;const params=new URLSearchParams(location.search);history.replaceState(null,'',location.pathname);
  async function finish(){try{const binding=sessionStorage.getItem('syncos_sso_binding');sessionStorage.removeItem('syncos_sso_binding');if(!binding||params.has('error')||!params.get('code')||!params.get('state'))throw Error('SSO sign-in was not completed. Please start again.');const result=await syncosFetch<{token:string;context:AuthContext}>('auth/sso/complete',{method:'POST',token:'',body:{code:params.get('code'),state:params.get('state'),binding}});clearAuthContext();saveToken(result.token);location.assign(workspaceRouteFor(result.context));}catch(e){setError(e instanceof Error?e.message:'SSO sign-in failed. Please start again.');}}
  void finish();
 },[]);
 return <main className="login-shell"><section className="login-panel"><h1>Organization sign-in</h1>{error?<p role="alert">{error}</p>:<p role="status">Verifying your account and workspace access…</p>}<p><Link href="/login">Return to sign in</Link></p></section></main>;
}
