"use client";
import {useMemo,useState,type ReactNode} from "react";
import {CommandShell} from "../dashboard-components";
import manuals from "./manuals.json";
import styles from "./training.module.css";
function Inline({text}:{text:string}){return <>{text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part,i)=>part.startsWith('`')?<code key={i}>{part.slice(1,-1)}</code>:part.startsWith('**')?<strong key={i}>{part.slice(2,-2)}</strong>:part)}</>;}
function Body({lines}:{lines:string[]}){
 const blocks:ReactNode[]=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i].trim();if(!line)continue;
  if(line.startsWith('|')){
   const rows:string[][]=[];while(i<lines.length&&lines[i].trim().startsWith('|')){const cells=lines[i].trim().split('|').slice(1,-1).map(s=>s.trim());if(!cells.every(c=>/^:?-+:?$/.test(c)))rows.push(cells);i++;}i--;
   blocks.push(<div className={styles.table} key={i}><table><thead><tr>{(rows[0]||[]).map((cell,k)=><th key={k}><Inline text={cell}/></th>)}</tr></thead><tbody>{rows.slice(1).map((row,k)=><tr key={k}>{row.map((cell,j)=><td key={j}><Inline text={cell}/></td>)}</tr>)}</tbody></table></div>);continue;
  }
  if(/^###/.test(line)){blocks.push(<h3 key={i}><Inline text={line.replace(/^#+\s*/,'')}/></h3>);continue;}
  if(/^\d+\. /.test(line)||/^- /.test(line)){
   const numbered=/^\d+\. /.test(line),items:ReactNode[]=[];const start=numbered?parseInt(line,10):undefined;
   while(i<lines.length&&(numbered?/^\d+\. /:/^- /).test(lines[i].trim())){items.push(<li key={i}><Inline text={lines[i].trim().replace(numbered?/^\d+\. /:/^- /,'')}/></li>);i++;}i--;
   blocks.push(numbered?<ol key={i} start={start}>{items}</ol>:<ul key={i}>{items}</ul>);continue;
  }
  blocks.push(<p key={i}><Inline text={line}/></p>);
 }
 return <>{blocks}</>;
}
function sections(content:string){const chunks=content.split(/(?=^## )/m);return chunks.map((chunk,index)=>{const lines=chunk.trim().split('\n');const title=lines[0].replace(/^#+\s*/,'');return {id:index,title,lines:lines.slice(1),text:chunk};});}
export default function TrainingPage(){
 const [selected,setSelected]=useState('operations'),[query,setQuery]=useState('');
 const manual=manuals.find(m=>m.id===selected)!;
 const matching=useMemo(()=>sections(manual.content).filter(s=>s.text.toLowerCase().includes(query.toLowerCase())),[manual,query]);
 return <CommandShell title="Training" purpose="Click-by-click procedures for the workflows available in SyncOS."><div className={styles.page}>
  <section className={styles.notice}><h2>Choose your role and workflow</h2><p>Use a practice workspace for training. Each procedure states its prerequisites, expected result and current limitations. A documented workflow is not a guarantee that your account has permission to perform it.</p><p>Source-reviewed instructions are distinguished from executed tests. Features marked unavailable or API-only do not have a complete click path yet. Passport remains a simulation.</p></section>
  <div className={styles.controls}><label>Training guide<select value={selected} onChange={e=>{setSelected(e.target.value);setQuery('');}}>{manuals.map(m=><option key={m.id} value={m.id}>{m.title}</option>)}</select></label><label>Find a workflow<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="For example: correction, JSA or invoice"/></label></div>
  <p><a className="link-button" download={manual.file} href={`data:text/markdown;charset=utf-8,${encodeURIComponent(manual.content)}`}>Download this guide</a></p>
  <p role="status">{matching.length} sections found</p>
  {!matching.length?<section><h2>No matching workflow</h2><p>Try a different word or choose another guide.</p><button type="button" onClick={()=>setQuery('')}>Clear search</button></section>:null}
  {matching.map(section=><section key={`${manual.id}-${section.id}`} className={styles.section}><h2>{section.title}</h2><Body lines={section.lines}/></section>)}
 </div></CommandShell>;
}
