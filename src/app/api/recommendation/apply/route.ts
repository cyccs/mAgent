import { NextResponse } from "next/server";
import { applyRecommendation } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as { id?: string };
  if (!body.id) return NextResponse.json({ error: "缺少建议ID" }, { status: 400 });
  applyRecommendation(body.id);
  return NextResponse.json({ ok: true });
}
