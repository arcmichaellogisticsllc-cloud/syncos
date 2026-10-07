"use client";
import {useEffect,useRef,useState,type HTMLAttributes} from 'react';
/** Make overflowing records reachable by keyboard without adding stops to tables that fit. */
export function ScrollableRegion({children,...props}:HTMLAttributes<HTMLDivElement>){
 const ref=useRef<HTMLDivElement>(null),[overflow,setOverflow]=useState(false),[label,setLabel]=useState('Scrollable records');
 useEffect(()=>{
  const element=ref.current;if(!element)return;
  const measure=()=>{setOverflow(element.scrollWidth>element.clientWidth+1||element.scrollHeight>element.clientHeight+1);const heading=element.closest('section,aside')?.querySelector('h2,h3,caption')?.textContent?.trim();setLabel(heading?`Scrollable ${heading}`:'Scrollable records');};
  measure();const observer=new ResizeObserver(measure);observer.observe(element);if(element.firstElementChild)observer.observe(element.firstElementChild);
  return()=>observer.disconnect();
 },[children]);
 return <div {...props} ref={ref} tabIndex={overflow?0:props.tabIndex} role={overflow?'group':props.role} aria-label={overflow?(props['aria-label']??label):props['aria-label']}>{children}</div>;
}
