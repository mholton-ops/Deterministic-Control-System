import type { NextRequest } from "next/server";

import { getApiBaseUrl } from "../../../../lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  readonly params: Promise<{
    readonly path: readonly string[];
  }>;
};

function targetUrl(path: readonly string[], search: string): string {
  const base = getApiBaseUrl().replace(/\/$/, "");
  const encodedPath = path.map((segment) => encodeURIComponent(segment)).join("/");
  return `${base}/${encodedPath}${search}`;
}

function forwardedHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  const accept = request.headers.get("accept");
  if (accept) headers.set("accept", accept);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  return headers;
}

async function proxy(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const response = await fetch(targetUrl(path, request.nextUrl.search), {
    method: request.method,
    headers: forwardedHeaders(request),
    cache: "no-store",
  });

  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxy(request, context);
}
