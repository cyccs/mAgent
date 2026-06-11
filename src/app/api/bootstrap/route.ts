import { NextResponse } from "next/server";
import { validateProfileInput } from "@/lib/training-rules";
import { resetAndCreateProfile, getAppState } from "@/lib/db";
import { generateInitialPlan } from "@/lib/agent";
import type { UserProfile, UserProfileInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as UserProfileInput;
    const errors = validateProfileInput(input);
    if (errors.length) {
      return NextResponse.json({ errors }, { status: 400 });
    }

    const profile: UserProfile = {
      id: "local-user",
      ...input,
      createdAt: new Date().toISOString(),
    };

    // 让 LLM 生成初始计划
    const initialPlan = await generateInitialPlan(profile);

    // 保存到数据库
    resetAndCreateProfile(profile, initialPlan);

    const state = getAppState();
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "计划生成失败";
    console.error("Bootstrap error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
