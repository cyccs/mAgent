import { NextResponse } from "next/server";
import { upsertFeedback } from "@/lib/db";
import type { SubjectiveFeedback } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    workoutId?: string;
    heartRate?: number;
    completed?: boolean;
    subjectiveFeedback?: SubjectiveFeedback;
  };

  if (!body.workoutId || !body.heartRate || !body.subjectiveFeedback || typeof body.completed !== "boolean") {
    return NextResponse.json({ error: "反馈数据不完整" }, { status: 400 });
  }
  if (body.heartRate < 80 || body.heartRate > 220) {
    return NextResponse.json({ error: "心率需在80到220之间" }, { status: 400 });
  }

  const feedback = upsertFeedback({
    workoutId: body.workoutId,
    heartRate: body.heartRate,
    completed: body.completed,
    subjectiveFeedback: body.subjectiveFeedback,
  });
  return NextResponse.json({ feedback });
}
