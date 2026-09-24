import { NextResponse } from "next/server";
import { AuthError } from "./session";
import { GraphError } from "./graph";

export async function handle(fn: () => Promise<unknown>) {
  try {
    return NextResponse.json(await fn());
  } catch (e: any) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message, auth: true }, { status: 401 });
    if (e instanceof GraphError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: e?.message || "Something went wrong" }, { status: 500 });
  }
}

/** Reject POSTs from other sites. */
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  return new URL(origin).host === req.headers.get("host");
}
