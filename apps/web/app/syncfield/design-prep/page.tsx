"use client";

import { FormEvent, useState, useEffect, useRef } from "react";
import { PermissionLink as Link } from "../../access-control";
import { syncosFetch } from "../../intelligence/api";

type DesignSegment = {
  id?: string;
  design_label?: string | null;
  from_asset_identifier?: string | null;
  to_asset_identifier?: string | null;
  design_length_ft?: number | null;
  status?: string;
};

export default function SyncFieldDesignPrepPage() {
  const [organizationId, setOrganizationId] = useState("");
  const [mapVersionId, setMapVersionId] = useState("");
  const [pageNumber, setPageNumber] = useState("1");
  const [fromAsset, setFromAsset] = useState("");
  const [toAsset, setToAsset] = useState("");
  const [designLength, setDesignLength] = useState("");
  const [label, setLabel] = useState("");
  const [segments, setSegments] = useState<DesignSegment[]>([]);
  const [points, setPoints] = useState([{x:"",y:""},{x:"",y:""}]);
  const [sourceReference, setSourceReference] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function run(fn:()=>Promise<void>) { if(lock.current)return;lock.current=true;setBusy(true);setError("");setMessage("");try{await fn();}catch(e){setError(e instanceof Error?e.message:"Unable to save. Please retry.");}finally{lock.current=false;setBusy(false);} }
  const [message, setMessage] = useState("");
  useEffect(() => {
    const query=new URLSearchParams(window.location.search);
    setOrganizationId(query.get("organization_id")??"");
    setMapVersionId(query.get("map_version_id")??"");
  }, []);

  async function loadSegments(event?: FormEvent) {
    event?.preventDefault();
    await run(async()=>{
    if(!organizationId.trim()||!mapVersionId.trim()) throw new Error("Choose an organization and map version first.");
    const result = await syncosFetch<DesignSegment[]>(`syncfield/organizations/${organizationId}/map-versions/${mapVersionId}/design-segments`);
    setSegments(result);
    });
  }

  async function createSegment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async()=>{
    if(points.some(p=>p.x===""||p.y==="")) throw new Error("Enter each point from the source map.");
    const created = await syncosFetch<DesignSegment>(`syncfield/organizations/${organizationId}/map-versions/${mapVersionId}/design-segments`, {
      method: "POST",
      body: {
        page_number: Number(pageNumber),
        from_asset_identifier: fromAsset,
        to_asset_identifier: toAsset,
        design_label: label,
        design_quantity: Number(designLength),
        design_unit: "FT",
        design_length_ft: Number(designLength),
        geometry_type: points.length>2 ? "pdf_polyline" : "pdf_line",
        geometry: { points: points.map(p=>({x:Number(p.x)/100,y:Number(p.y)/100})) },
        source: "manual",
        source_reference: sourceReference,
      },
    });
    setSegments((current) => [...current, created]);
    setMessage("Design segment saved to the selected immutable map version.");
    });
  }

  return (
    <main className="operator-page">
      <section className="operator-hero compact">
        <div>
          <p className="eyebrow">SyncField Design Prep</p>
          <h1>Prepare planned spans before field execution.</h1>
          <p>Record planned segments from the customer engineering print using measured page coordinates. Foremen complete work against these planned spans in SyncField; the source print is never overwritten.</p>
        </div>
        <Link className="operator-button" href="/operations">Operations</Link>
      </section>
      <form className="operator-form-grid" onSubmit={createSegment}><fieldset disabled={busy}>
        <label>Organization ID<input value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} required /></label>
        <label>Map Version ID<input value={mapVersionId} onChange={(event) => setMapVersionId(event.target.value)} required /></label>
        <label>Page<input inputMode="numeric" value={pageNumber} onChange={(event) => setPageNumber(event.target.value)} required /></label>
        <label>From Pole / Asset<input value={fromAsset} onChange={(event) => setFromAsset(event.target.value)} required /></label>
        <label>To Pole / Asset<input value={toAsset} onChange={(event) => setToAsset(event.target.value)} required /></label>
        <label>Design Footage<input inputMode="decimal" value={designLength} onChange={(event) => setDesignLength(event.target.value)} required /></label>
        <label>Label<input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
        <fieldset><legend>Source map points</legend><p>Enter each point as a percentage of the full source PDF page: X from the left, Y from the top. These are measured page coordinates, not GPS. No sample geometry is supplied.</p>{points.map((point,index)=><div key={index}><label>Point {index+1} X (%)<input type="number" min="0" max="100" step="any" required value={point.x} onChange={e=>setPoints(rows=>rows.map((p,i)=>i===index?{...p,x:e.target.value}:p))}/></label><label>Point {index+1} Y (%)<input type="number" min="0" max="100" step="any" required value={point.y} onChange={e=>setPoints(rows=>rows.map((p,i)=>i===index?{...p,y:e.target.value}:p))}/></label>{points.length>2&&<button type="button" onClick={()=>setPoints(rows=>rows.filter((_,i)=>i!==index))}>Remove point {index+1}</button>}</div>)}<button type="button" onClick={()=>setPoints(rows=>[...rows,{x:"",y:""}])}>Add bend point</button></fieldset>
        <label>Source drawing and measurement reference<input required value={sourceReference} onChange={e=>setSourceReference(e.target.value)}/></label>
        <button className="operator-button primary" type="submit">Add Design Segment</button>
        <button className="operator-button" type="button" onClick={() => void loadSegments()}>Load Segments</button>
      </fieldset></form>
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status" className="operator-inline-success">{message}</p> : null}
      <section className="operator-panel">
        <h2>Prepared Segments</h2>
        <div className="operator-list">
          {segments.map((segment) => (
            <div key={segment.id} className="operator-list-row">
              <strong>{segment.design_label || `${segment.from_asset_identifier} to ${segment.to_asset_identifier}`}</strong>
              <span>{segment.design_length_ft ?? "No"} FT · {segment.status}</span>
            </div>
          ))}
          {!segments.length ? <p>No prepared segments loaded.</p> : null}
        </div>
      </section>
    </main>
  );
}
