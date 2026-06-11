/**
 * AI Coach Agent — 由 LLM 直接生成每周训练计划
 *
 * 核心职责：
 * 1. generateInitialPlan(profile) — 首次初始化，生成第1周计划
 * 2. generateNextPlan(profile, currentPlan, feedbackHistory) — 基于反馈生成下周计划
 *
 * 每个函数输出都经过 training-rules 的校验约束
 */

import fs from "node:fs";
import path from "node:path";
import { callLlmWithJson } from "./llm";
import { enforceConstraints, validateWorkouts } from "./training-rules";
import { WEEKDAYS } from "./constants";
import type {
  UserProfile,
  Weekday,
  WeeklyPlan,
  WorkoutFeedback,
} from "./types";

// ── 公开 API ─────────────────────────────────────────────────

/**
 * 生成第1周初始训练计划
 */
export async function generateInitialPlan(
  profile: UserProfile,
  today: Date = new Date(),
): Promise<WeeklyPlan> {
  const systemPrompt = await readSystemPrompt();
  const userInput = buildInitialInput(profile);

  const llmOutput = await callLlmWithJson<LlmPlanOutput>(systemPrompt, userInput);

  return buildPlanFromLlmOutput(llmOutput, profile, 1, "active", today);
}

/**
 * generateNextPlan 的返回结果，包含训练计划 + AI 文本字段
 */
export interface GenerateNextPlanResult {
  plan: WeeklyPlan;
  summary: string;
  reasoning: string;
  nextWeekAdvice: string;
  caution: string;
}

/**
 * 根据反馈生成下周训练计划
 */
export async function generateNextPlan(
  profile: UserProfile,
  currentPlan: WeeklyPlan,
  feedbackHistory: WorkoutFeedback[],
): Promise<GenerateNextPlanResult> {
  const systemPrompt = await readSystemPrompt();
  const userInput = buildNextWeekInput(profile, currentPlan, feedbackHistory);

  const llmOutput = await callLlmWithJson<LlmPlanOutput>(systemPrompt, userInput);

  const plan = buildPlanFromLlmOutput(
    llmOutput,
    profile,
    currentPlan.weekNumber + 1,
    "draft",
    addDays(startOfWeek(new Date(`${currentPlan.startDate}T00:00:00`)), 7),
  );

  return {
    plan,
    summary: llmOutput.summary ?? "",
    reasoning: llmOutput.reasoning ?? "",
    nextWeekAdvice: llmOutput.nextWeekAdvice ?? "",
    caution: llmOutput.caution ?? "",
  };
}

// ── LLM 输入构建 ─────────────────────────────────────────────

async function readSystemPrompt(): Promise<string> {
  const promptPath = path.join(process.cwd(), "prompts", "running-coach.system.md");
  return fs.readFileSync(promptPath, "utf8");
}

function buildInitialInput(profile: UserProfile): string {
  return JSON.stringify(
    {
      task: "generate_initial_plan",
      profile: {
        goal: profile.goal === "beginner" ? "新人跑步入门" : "5公里专项训练",
        age: profile.age,
        gender: profile.gender,
        heightCm: profile.heightCm,
        weightKg: profile.weightKg,
        injuryHistory: profile.injuryHistory,
        maxTrainingDaysPerWeek: profile.maxTrainingDaysPerWeek,
        availableWeekdays: [...profile.availableWeekdays].sort(),
      },
      planType: "initial",
    },
    null,
    2,
  );
}

function buildNextWeekInput(
  profile: UserProfile,
  currentPlan: WeeklyPlan,
  feedbackHistory: WorkoutFeedback[],
): string {
  const feedbackByWorkout = new Map(feedbackHistory.map((f) => [f.workoutId, f]));
  const lastWeekResults = currentPlan.workouts.map((w) => {
    const fb = feedbackByWorkout.get(w.id);
    return {
      weekday: w.weekday,
      dayLabel: w.dayLabel,
      title: w.title,
      runType: w.runLevel,
      distanceKm: w.distanceKm,
      paceMinPerKm: w.paceMinPerKm,
      heartRateTarget: { min: w.heartRateMin, max: w.heartRateMax },
      feedback: fb
        ? {
            heartRate: fb.heartRate,
            completed: fb.completed,
            subjectiveFeedback: fb.subjectiveFeedback,
          }
        : null,
    };
  });

  return JSON.stringify(
    {
      task: "generate_next_plan",
      profile: {
        goal: profile.goal === "beginner" ? "新人跑步入门" : "5公里专项训练",
        age: profile.age,
        gender: profile.gender,
        heightCm: profile.heightCm,
        weightKg: profile.weightKg,
        injuryHistory: profile.injuryHistory,
        maxTrainingDaysPerWeek: profile.maxTrainingDaysPerWeek,
        availableWeekdays: [...profile.availableWeekdays].sort(),
      },
      planType: "next",
      lastWeekNumber: currentPlan.weekNumber,
      lastWeekResults,
    },
    null,
    2,
  );
}

// ── LLM 输出处理 ─────────────────────────────────────────────

interface LlmWorkout {
  weekday: number;
  runType: string;
  distanceKm: number;
  paceMinPerKm?: number;
  heartRateMin?: number;
  heartRateMax?: number;
}

interface LlmPlanOutput {
  weekNumber: number;
  workouts: LlmWorkout[];
  reasoning?: string;
  summary?: string;
  nextWeekAdvice?: string;
  caution?: string;
}

function buildPlanFromLlmOutput(
  llm: LlmPlanOutput,
  profile: UserProfile,
  weekNumber: number,
  status: WeeklyPlan["status"],
  today: Date,
): WeeklyPlan {
  const startDate = startOfWeek(today);
  const endDate = addDays(startDate, 6);
  const planId = globalThis.crypto.randomUUID();

  // 校验并修正 LLM 输出
  const validatedWorkouts = validateWorkouts(llm.workouts, profile, startDate, planId);
  const constrainedWorkouts = enforceConstraints(validatedWorkouts, profile);
  const workoutsWithMeta = constrainedWorkouts.map((w, i) => ({
    ...w,
    date: toIsoDate(addDays(startDate, weekdayToOffset(w.weekday))),
    status: "pending" as const,
  }));

  return {
    id: planId,
    userId: profile.id,
    weekNumber,
    startDate: toIsoDate(startDate),
    endDate: toIsoDate(endDate),
    goal: profile.goal,
    status,
    totalDistanceKm: roundDistance(
      workoutsWithMeta.reduce((sum, w) => sum + (w.distanceKm ?? 0), 0),
    ),
    workouts: workoutsWithMeta,
  };
}

// ── 日期辅助 ─────────────────────────────────────────────────

function startOfWeek(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0
  copy.setDate(copy.getDate() - diff);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function weekdayToOffset(weekday: Weekday): number {
  return weekday === 0 ? 6 : weekday - 1;
}

function roundDistance(distance: number): number {
  return Math.round(distance * 10) / 10;
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
