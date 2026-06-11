import { NextResponse } from "next/server";
import { clearAllData } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    clearAllData();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "重置失败";
    console.error("Reset error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
