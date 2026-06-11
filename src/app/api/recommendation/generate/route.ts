import { NextResponse } from "next/server";
import { getActivePlan, getFeedbackForPlan, getPendingRecommendation, getProfile, saveRecommendation } from "@/lib/db";
import { generateNextPlan } from "@/lib/agent";
import type { GenerateNextPlanResult } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const profile = getProfile();
    const currentPlan = profile ? getActivePlan(profile.id) : null;
    if (!profile || !currentPlan) {
      return NextResponse.json(
        { error: "请先填写用户信息并生成本周计划" },
        { status: 400 },
      );
    }

    const feedback = getFeedbackForPlan(currentPlan.id);
    if (feedback.length === 0) {
      return NextResponse.json(
        { error: "本周尚无训练反馈数据，请先完成训练并提交反馈" },
        { status: 400 },
      );
    }

    // LLM 根据反馈生成本周评估 + 下周计划
    const result: GenerateNextPlanResult = await generateNextPlan(profile, currentPlan, feedback);

    // 保存 AI 建议记录
    const rule = {
      action: "hold" as const,
      reason: "AI 已根据训练反馈生成下周计划",
      highHeartRateCount: 0,
      hardFeedbackCount: 0,
      incompleteCount: 0,
      nextPlan: result.plan,
    };

    const ai = {
      aiSummary: result.summary,
      aiReasoning: result.reasoning,
      aiNextWeekAdvice: result.nextWeekAdvice,
      aiCaution: result.caution || "如果出现疼痛、明显不适或伤病复发，请暂停训练并咨询专业人士。",
    };

    saveRecommendation(profile.id, currentPlan.id, rule, ai);
    const pendingRecommendation = getPendingRecommendation(profile.id);

    return NextResponse.json({ pendingRecommendation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成建议失败";
    console.error("Recommendation error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
