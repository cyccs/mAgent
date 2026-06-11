/**
 * 训练规则校验层
 *
 * 职责:
 * 1. validateProfileInput — 用户输入校验
 * 2. validateWorkouts — LLM 输出校验（日期、配速、心率区间、距离范围）
 * 3. enforceConstraints — 约束修正（超出范围的值自动修正）
 */

import { PRESCRIPTIONS, WEEKDAYS } from "./constants";
import type {
  Goal,
  RunLevel,
  UserProfile,
  UserProfileInput,
  Weekday,
  Workout,
} from "./types";

const VALID_DISTANCES = [1, 2, 3, 4, 5];
const VALID_RUN_LEVELS: RunLevel[] = ["easy", "normal", "advanced"];

// ── 用户输入校验 ─────────────────────────────────────────────

export function validateProfileInput(input: UserProfileInput): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(input.age) || input.age < 10 || input.age > 90) {
    errors.push("年龄需在10到90之间");
  }
  if (input.heightCm < 100 || input.heightCm > 230) {
    errors.push("身高需在100到230厘米之间");
  }
  if (input.weightKg < 30 || input.weightKg > 250) {
    errors.push("体重需在30到250公斤之间");
  }
  if (
    !Number.isInteger(input.maxTrainingDaysPerWeek) ||
    input.maxTrainingDaysPerWeek < 1 ||
    input.maxTrainingDaysPerWeek > 7
  ) {
    errors.push("每周训练天数需在1到7之间");
  }
  if (!input.availableWeekdays.length) {
    errors.push("至少选择一个可训练星期");
  }
  return errors;
}

// ── LLM 输出校验 ─────────────────────────────────────────────

export interface WorkoutInput {
  weekday: number;
  runType: string;
  distanceKm: number;
  paceMinPerKm?: number;
  heartRateMin?: number;
  heartRateMax?: number;
}

/**
 * 校验 LLM 输出的训练数据，返回标准化的 Workout 列表
 */
export function validateWorkouts(
  inputs: WorkoutInput[],
  profile: UserProfile,
  startDate: Date,
  planId: string,
): Workout[] {
  if (!inputs || !inputs.length) {
    throw new Error("LLM 未生成任何训练日数据");
  }

  const availableSet = new Set(profile.availableWeekdays);
  const seenWeekdays = new Set<number>();

  const workouts: Workout[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const w = inputs[i];
    const weekday = w.weekday as Weekday;

    // 跳过不在可训练日的工作日
    if (!availableSet.has(weekday)) continue;

    // 跳过重复的星期
    if (seenWeekdays.has(weekday)) continue;
    seenWeekdays.add(weekday);

    // 校验跑步类型
    let runLevel: RunLevel = "easy";
    if (VALID_RUN_LEVELS.includes(w.runType as RunLevel)) {
      runLevel = w.runType as RunLevel;
    }

    // 校验距离
    const distanceKm = clampDistance(w.distanceKm);

    // 使用预设的心率和配速
    const prescription = PRESCRIPTIONS[runLevel];

    workouts.push({
      id: `${planId}_w${i}`,
      planId,
      date: "",
      weekday,
      dayLabel: weekdayLabel(weekday),
      title: titleForWorkout(profile.goal, distanceKm, runLevel),
      distanceKm,
      durationMin: null,
      runLevel,
      paceMinPerKm: prescription.paceMinPerKm,
      heartRateMin: prescription.heartRateMin,
      heartRateMax: prescription.heartRateMax,
      status: "pending",
    });
  }

  // 限制训练天数不超过最大训练天数（取前 maxTrainingDaysPerWeek 个）
  if (workouts.length > profile.maxTrainingDaysPerWeek) {
    return workouts.slice(0, profile.maxTrainingDaysPerWeek);
  }

  return workouts;
}

// ── 约束修正 ─────────────────────────────────────────────────

/**
 * 对工作列表进行约束修正（修正超出范围的值）
 */
export function enforceConstraints(
  workouts: Workout[],
  profile: UserProfile,
): Workout[] {
  return workouts.map((w) => {
    const prescription = PRESCRIPTIONS[w.runLevel];
    return {
      ...w,
      distanceKm: clampDistance(w.distanceKm ?? 1),
      paceMinPerKm: prescription.paceMinPerKm,
      heartRateMin: prescription.heartRateMin,
      heartRateMax: prescription.heartRateMax,
      durationMin: w.durationMin !== null
        ? Math.max(10, Math.min(180, w.durationMin))
        : null,
    };
  });
}

// ── 内部辅助 ─────────────────────────────────────────────────

function clampDistance(distance: number): number {
  const clamped = Math.max(1, Math.min(5, Math.round(distance)));
  // 取最接近的有效距离
  return VALID_DISTANCES.reduce((prev, curr) =>
    Math.abs(curr - distance) < Math.abs(prev - distance) ? curr : prev,
  );
}

function titleForWorkout(goal: Goal, distanceKm: number, level: RunLevel): string {
  const levelMap: Record<RunLevel, string> = {
    easy: "简单跑",
    normal: "正常跑",
    advanced: "进阶跑",
  };
  if (goal === "beginner") {
    if (distanceKm <= 1) return `走跑结合 ${distanceKm}km`;
    return `${levelMap[level]} ${distanceKm}km`;
  }
  return `${distanceKm}公里${levelMap[level]}`;
}

function weekdayLabel(weekday: Weekday): string {
  return WEEKDAYS.find((w) => w.value === weekday)?.label ?? String(weekday);
}
