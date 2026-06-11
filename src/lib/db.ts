import Database from "better-sqlite3";
import path from "node:path";
import type {
  AiRecommendation,
  AppState,
  Goal,
  RuleRecommendation,
  UserProfile,
  Weekday,
  WeeklyPlan,
  Workout,
  WorkoutFeedback,
} from "./types";

const DEFAULT_USER_ID = "local-user";
const databasePath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "running-plan.sqlite");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(databasePath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(db);
  }
  return db;
}

export function getAppState(): AppState {
  const database = getDb();
  const profile = getProfile();
  const plans = profile ? getPlans(profile.id) : [];
  const feedback = profile ? getFeedbackForUser(profile.id) : [];
  const pendingRecommendation = profile ? getPendingRecommendation(profile.id) : null;
  return { profile, plans, feedback, pendingRecommendation };
}

/**
 * 清空所有用户数据（profile、plans、workouts、feedback、recommendations）
 */
export function clearAllData(): void {
  getDb().exec(
    "DELETE FROM ai_recommendations; DELETE FROM feedback; DELETE FROM workouts; DELETE FROM weekly_plans; DELETE FROM user_profiles;"
  );
}

export function resetAndCreateProfile(profile: UserProfile, initialPlan: WeeklyPlan): UserProfile {
  const database = getDb();

  const tx = database.transaction(() => {
    clearAllData();
    database
      .prepare(
        `INSERT INTO user_profiles (
          id, age, gender, height_cm, weight_kg, injury_history,
          max_training_days_per_week, available_weekdays, goal, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        profile.id,
        profile.age,
        profile.gender,
        profile.heightCm,
        profile.weightKg,
        profile.injuryHistory,
        profile.maxTrainingDaysPerWeek,
        JSON.stringify(profile.availableWeekdays),
        profile.goal,
        profile.createdAt,
      );
    savePlan(initialPlan, "active");
  });
  tx();

  return profile;
}

export function getProfile(): UserProfile | null {
  const row = getDb().prepare("SELECT * FROM user_profiles WHERE id = ?").get(DEFAULT_USER_ID) as ProfileRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    age: row.age,
    gender: row.gender,
    heightCm: row.height_cm,
    weightKg: row.weight_kg,
    injuryHistory: row.injury_history,
    maxTrainingDaysPerWeek: row.max_training_days_per_week,
    availableWeekdays: JSON.parse(row.available_weekdays) as Weekday[],
    goal: row.goal,
    createdAt: row.created_at,
  };
}

export function getActivePlan(userId = DEFAULT_USER_ID): WeeklyPlan | null {
  const row = getDb()
    .prepare("SELECT * FROM weekly_plans WHERE user_id = ? AND status = 'active' ORDER BY week_number DESC LIMIT 1")
    .get(userId) as PlanRow | undefined;
  return row ? hydratePlan(row) : null;
}

export function getPlans(userId = DEFAULT_USER_ID): WeeklyPlan[] {
  const rows = getDb().prepare("SELECT * FROM weekly_plans WHERE user_id = ? ORDER BY week_number ASC").all(userId) as PlanRow[];
  return rows.map(hydratePlan);
}

export function getFeedbackForUser(userId = DEFAULT_USER_ID): WorkoutFeedback[] {
  const rows = getDb()
    .prepare(
      `SELECT feedback.* FROM feedback
       JOIN workouts ON workouts.id = feedback.workout_id
       JOIN weekly_plans ON weekly_plans.id = workouts.plan_id
       WHERE weekly_plans.user_id = ?
       ORDER BY feedback.created_at ASC`,
    )
    .all(userId) as FeedbackRow[];
  return rows.map(mapFeedback);
}

export function getFeedbackForPlan(planId: string): WorkoutFeedback[] {
  const rows = getDb()
    .prepare(
      `SELECT feedback.* FROM feedback
       JOIN workouts ON workouts.id = feedback.workout_id
       WHERE workouts.plan_id = ?
       ORDER BY feedback.created_at ASC`,
    )
    .all(planId) as FeedbackRow[];
  return rows.map(mapFeedback);
}

export function upsertFeedback(input: {
  workoutId: string;
  heartRate: number;
  completed: boolean;
  subjectiveFeedback: WorkoutFeedback["subjectiveFeedback"];
}): WorkoutFeedback {
  const database = getDb();
  const existing = database.prepare("SELECT * FROM feedback WHERE workout_id = ?").get(input.workoutId) as FeedbackRow | undefined;
  const now = new Date().toISOString();
  const id = existing?.id ?? `feedback_${globalThis.crypto.randomUUID()}`;

  const tx = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO feedback (id, workout_id, heart_rate, completed, subjective_feedback, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(workout_id) DO UPDATE SET
           heart_rate = excluded.heart_rate,
           completed = excluded.completed,
           subjective_feedback = excluded.subjective_feedback,
           created_at = excluded.created_at`,
      )
      .run(id, input.workoutId, input.heartRate, input.completed ? 1 : 0, input.subjectiveFeedback, now);
    database
      .prepare("UPDATE workouts SET status = ? WHERE id = ?")
      .run(input.completed ? "completed" : "missed", input.workoutId);
  });
  tx();

  return {
    id,
    workoutId: input.workoutId,
    heartRate: input.heartRate,
    completed: input.completed,
    subjectiveFeedback: input.subjectiveFeedback,
    createdAt: now,
  };
}

export function saveRecommendation(
  userId: string,
  sourcePlanId: string,
  rule: RuleRecommendation,
  ai: Pick<AiRecommendation, "aiSummary" | "aiReasoning" | "aiNextWeekAdvice" | "aiCaution">,
): AiRecommendation {
  const database = getDb();
  const id = `ai_${globalThis.crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const recommendation: AiRecommendation = {
    id,
    userId,
    sourcePlanId,
    proposedPlanId: rule.nextPlan.id,
    action: rule.action,
    ruleReason: rule.reason,
    status: "pending",
    createdAt: now,
    ...ai,
  };

  const tx = database.transaction(() => {
    database.prepare("DELETE FROM ai_recommendations WHERE user_id = ? AND status = 'pending'").run(userId);
    database.prepare("DELETE FROM weekly_plans WHERE user_id = ? AND status = 'draft'").run(userId);
    savePlan(rule.nextPlan, "draft");
    database
      .prepare(
        `INSERT INTO ai_recommendations (
          id, user_id, source_plan_id, proposed_plan_id, action, rule_reason,
          ai_summary, ai_reasoning, ai_next_week_advice, ai_caution, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        recommendation.id,
        recommendation.userId,
        recommendation.sourcePlanId,
        recommendation.proposedPlanId,
        recommendation.action,
        recommendation.ruleReason,
        recommendation.aiSummary,
        recommendation.aiReasoning,
        recommendation.aiNextWeekAdvice,
        recommendation.aiCaution,
        recommendation.status,
        recommendation.createdAt,
      );
  });
  tx();

  return recommendation;
}

export function applyRecommendation(id: string): void {
  const database = getDb();
  const row = database.prepare("SELECT * FROM ai_recommendations WHERE id = ? AND status = 'pending'").get(id) as RecommendationRow | undefined;
  if (!row) throw new Error("没有可应用的建议");

  const tx = database.transaction(() => {
    database.prepare("UPDATE weekly_plans SET status = 'history' WHERE user_id = ? AND status = 'active'").run(row.user_id);
    database.prepare("UPDATE weekly_plans SET status = 'active' WHERE id = ?").run(row.proposed_plan_id);
    database.prepare("UPDATE ai_recommendations SET status = 'applied' WHERE id = ?").run(id);
  });
  tx();
}

export function getPendingRecommendation(userId = DEFAULT_USER_ID): AiRecommendation | null {
  const row = getDb()
    .prepare("SELECT * FROM ai_recommendations WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1")
    .get(userId) as RecommendationRow | undefined;
  return row ? mapRecommendation(row) : null;
}

function savePlan(plan: WeeklyPlan, status: WeeklyPlan["status"]): void {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO weekly_plans (id, user_id, week_number, start_date, end_date, goal, status, total_distance_km)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status`,
    )
    .run(plan.id, plan.userId, plan.weekNumber, plan.startDate, plan.endDate, plan.goal, status, plan.totalDistanceKm);

  const insertWorkout = database.prepare(
    `INSERT INTO workouts (
      id, plan_id, date, weekday, day_label, title, distance_km, duration_min, run_level,
      pace_min_per_km, heart_rate_min, heart_rate_max, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = excluded.status`,
  );
  for (const workout of plan.workouts) {
    insertWorkout.run(
      workout.id,
      plan.id,
      workout.date,
      workout.weekday,
      workout.dayLabel,
      workout.title,
      workout.distanceKm,
      workout.durationMin,
      workout.runLevel,
      workout.paceMinPerKm,
      workout.heartRateMin,
      workout.heartRateMax,
      workout.status,
    );
  }
}

function hydratePlan(row: PlanRow): WeeklyPlan {
  const workouts = getDb().prepare("SELECT * FROM workouts WHERE plan_id = ? ORDER BY date ASC").all(row.id) as WorkoutRow[];
  return {
    id: row.id,
    userId: row.user_id,
    weekNumber: row.week_number,
    startDate: row.start_date,
    endDate: row.end_date,
    goal: row.goal,
    status: row.status,
    totalDistanceKm: row.total_distance_km,
    workouts: workouts.map(mapWorkout),
  };
}

function mapWorkout(row: WorkoutRow): Workout {
  return {
    id: row.id,
    planId: row.plan_id,
    date: row.date,
    weekday: row.weekday,
    dayLabel: row.day_label,
    title: row.title,
    distanceKm: row.distance_km,
    durationMin: row.duration_min,
    runLevel: row.run_level,
    paceMinPerKm: row.pace_min_per_km,
    heartRateMin: row.heart_rate_min,
    heartRateMax: row.heart_rate_max,
    status: row.status,
  };
}

function mapFeedback(row: FeedbackRow): WorkoutFeedback {
  return {
    id: row.id,
    workoutId: row.workout_id,
    heartRate: row.heart_rate,
    completed: Boolean(row.completed),
    subjectiveFeedback: row.subjective_feedback,
    createdAt: row.created_at,
  };
}

function mapRecommendation(row: RecommendationRow): AiRecommendation {
  return {
    id: row.id,
    userId: row.user_id,
    sourcePlanId: row.source_plan_id,
    proposedPlanId: row.proposed_plan_id,
    action: row.action,
    ruleReason: row.rule_reason,
    aiSummary: row.ai_summary,
    aiReasoning: row.ai_reasoning,
    aiNextWeekAdvice: row.ai_next_week_advice,
    aiCaution: row.ai_caution,
    status: row.status,
    createdAt: row.created_at,
  };
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id TEXT PRIMARY KEY,
      age INTEGER NOT NULL,
      gender TEXT NOT NULL,
      height_cm REAL NOT NULL,
      weight_kg REAL NOT NULL,
      injury_history TEXT NOT NULL,
      max_training_days_per_week INTEGER NOT NULL,
      available_weekdays TEXT NOT NULL,
      goal TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weekly_plans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      week_number INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      goal TEXT NOT NULL,
      status TEXT NOT NULL,
      total_distance_km REAL NOT NULL,
      FOREIGN KEY(user_id) REFERENCES user_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workouts (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      date TEXT NOT NULL,
      weekday INTEGER NOT NULL,
      day_label TEXT NOT NULL,
      title TEXT NOT NULL,
      distance_km REAL,
      duration_min INTEGER,
      run_level TEXT NOT NULL,
      pace_min_per_km REAL NOT NULL,
      heart_rate_min INTEGER NOT NULL,
      heart_rate_max INTEGER NOT NULL,
      status TEXT NOT NULL,
      FOREIGN KEY(plan_id) REFERENCES weekly_plans(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      workout_id TEXT NOT NULL UNIQUE,
      heart_rate INTEGER NOT NULL,
      completed INTEGER NOT NULL,
      subjective_feedback TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(workout_id) REFERENCES workouts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_recommendations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_plan_id TEXT NOT NULL,
      proposed_plan_id TEXT NOT NULL,
      action TEXT NOT NULL,
      rule_reason TEXT NOT NULL,
      ai_summary TEXT NOT NULL,
      ai_reasoning TEXT NOT NULL,
      ai_next_week_advice TEXT NOT NULL,
      ai_caution TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES user_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY(source_plan_id) REFERENCES weekly_plans(id) ON DELETE CASCADE,
      FOREIGN KEY(proposed_plan_id) REFERENCES weekly_plans(id) ON DELETE CASCADE
    );
  `);
}

type ProfileRow = {
  id: string;
  age: number;
  gender: UserProfile["gender"];
  height_cm: number;
  weight_kg: number;
  injury_history: string;
  max_training_days_per_week: number;
  available_weekdays: string;
  goal: Goal;
  created_at: string;
};

type PlanRow = {
  id: string;
  user_id: string;
  week_number: number;
  start_date: string;
  end_date: string;
  goal: Goal;
  status: WeeklyPlan["status"];
  total_distance_km: number;
};

type WorkoutRow = {
  id: string;
  plan_id: string;
  date: string;
  weekday: Weekday;
  day_label: string;
  title: string;
  distance_km: number | null;
  duration_min: number | null;
  run_level: Workout["runLevel"];
  pace_min_per_km: number;
  heart_rate_min: number;
  heart_rate_max: number;
  status: Workout["status"];
};

type FeedbackRow = {
  id: string;
  workout_id: string;
  heart_rate: number;
  completed: number;
  subjective_feedback: WorkoutFeedback["subjectiveFeedback"];
  created_at: string;
};

type RecommendationRow = {
  id: string;
  user_id: string;
  source_plan_id: string;
  proposed_plan_id: string;
  action: AiRecommendation["action"];
  rule_reason: string;
  ai_summary: string;
  ai_reasoning: string;
  ai_next_week_advice: string;
  ai_caution: string;
  status: AiRecommendation["status"];
  created_at: string;
};
