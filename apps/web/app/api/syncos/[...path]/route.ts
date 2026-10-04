import { NextRequest, NextResponse } from "next/server";

function apiBaseUrl() {
  if (process.env.SYNCOS_API_BASE_URL) return process.env.SYNCOS_API_BASE_URL;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SYNCOS_API_BASE_URL is required for the production web proxy");
  }
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3100";
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const target = new URL(`${apiBaseUrl()}/${(await context.params).path.join("/")}`);
  request.nextUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));

  const headers = new Headers();
  const authorization = request.headers.get("authorization");
  if (authorization) headers.set("authorization", authorization);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
    cache: "no-store",
  });

  const bytes = [204, 205, 304].includes(response.status) ? null : await response.arrayBuffer();
  const disposition = response.headers.get("content-disposition");
  return new NextResponse(bytes, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...(disposition ? { "content-disposition": disposition } : {}),
    },
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
