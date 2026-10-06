#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const required=['features','integrations','historicalBacklog','businessConfiguration','deviceAcceptance','security','offsiteRecovery','deployment','performance','training'];
function check(file){const root=path.dirname(path.resolve(file)),input=JSON.parse(fs.readFileSync(file,'utf8')),missing=[];if(!/^[a-f0-9]{40,64}$/.test(input.candidate??''))missing.push('Exact candidate commit or source digest required');
 for(const name of required){const gate=input[name];if(!gate||gate.status!=='passed')missing.push(name+': not passed');if(!gate?.reviewer||!gate?.reviewedAt||!Number.isFinite(Date.parse(gate.reviewedAt))||Date.parse(gate.reviewedAt)>Date.now())missing.push(name+': dated reviewer required');if(!Array.isArray(gate?.evidence)||!gate.evidence.length)missing.push(name+': evidence required');else for(const e of gate.evidence){try{if(typeof e.file!=='string'||!/^[a-f0-9]{64}$/.test(e.sha256)||createHash('sha256').update(fs.readFileSync(path.resolve(root,e.file))).digest('hex')!==e.sha256)missing.push(name+': evidence mismatch');}catch{missing.push(name+': missing evidence file');}}}
 if(!Array.isArray(input.unresolvedEngineeringBlockers)||input.unresolvedEngineeringBlockers.length)missing.push('Unresolved engineering blockers must be an explicitly empty list');
 return {candidate:input.candidate??null,status:missing.length?'pilot_blocked':'ready_for_independent_review',pilotAuthorized:false,scope:'Checks evidence completeness and integrity only. Never constitutes business sign-off or starts an operational pilot.',missing};}
if(require.main===module){try{const result=check(process.argv[2]);console.log(JSON.stringify(result,null,2));if(result.missing.length)process.exitCode=2;}catch{console.error('Supply the candidate completion-gate JSON file.');process.exitCode=2;}}
module.exports={check,required};
