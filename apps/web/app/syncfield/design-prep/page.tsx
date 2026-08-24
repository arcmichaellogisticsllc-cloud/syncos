"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
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
  const [fromAsset, setFromAsset] = useState("Pole 15-12-2");
  const [toAsset, setToAsset] = useState("Pole 15-12-4");
  const [designLength, setDesignLength] = useState("141");
  const [label, setLabel] = useState("ARL aerial span 15-12-2 to 15-12-4");
  const [segments, setSegments] = useState<DesignSegment[]>([]);
  const [message, setMessage] = useState("");

  async function loadSegments(event?: FormEvent) {
    event?.preventDefault();
    setMessage("");
    const result = await syncosFetch<DesignSegment[]>(`syncfield/organizations/${organizationId}/map-versions/${mapVersionId}/design-segments`);
    setSegments(result);
  }

  async function createSegment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
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
        geometry_type: "pdf_line",
        geometry: { points: [{ x: 0.22, y: 0.48 }, { x: 0.78, y: 0.52 }] },
        source: "manual",
        source_reference: "Internal design prep trace from customer engineering print.",
      },
    });
    setSegments((current) => [...current, created]);
    setMessage("Design segment saved to the selected immutable map version.");
  }

  return (
    <main className="operator-page">
      <section className="operator-hero compact">
        <div>
          <p className="eyebrow">SyncField Design Prep</p>
          <h1>Prepare planned spans before field execution.</h1>
          <p>Use this internal workspace to trace customer engineering print segments. Foremen complete work against these planned spans in SyncField; the source print is never overwritten.</p>
        </div>
        <Link className="operator-button" href="/operations">Operations</Link>
      </section>
      <form className="operator-form-grid" onSubmit={createSegment}>
        <label>Organization ID<input value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} required /></label>
        <label>Map Version ID<input value={mapVersionId} onChange={(event) => setMapVersionId(event.target.value)} required /></label>
        <label>Page<input inputMode="numeric" value={pageNumber} onChange={(event) => setPageNumber(event.target.value)} required /></label>
        <label>From Pole / Asset<input value={fromAsset} onChange={(event) => setFromAsset(event.target.value)} required /></label>
        <label>To Pole / Asset<input value={toAsset} onChange={(event) => setToAsset(event.target.value)} required /></label>
        <label>Design Footage<input inputMode="decimal" value={designLength} onChange={(event) => setDesignLength(event.target.value)} required /></label>
        <label>Label<input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
        <button className="operator-button primary" type="submit">Add Design Segment</button>
        <button className="operator-button" type="button" onClick={() => void loadSegments()}>Load Segments</button>
      </form>
      {message ? <p className="operator-inline-success">{message}</p> : null}
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
