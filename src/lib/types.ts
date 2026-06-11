export type Goal = "beginner" | "five_k";
export type Gender = "female" | "male" | "other";
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 0;
export type RunLevel = "easy" | "normal" | "advanced";
export type SubjectiveFeedback = "easy" | "medium" | "hard";
export type RecommendationAction =
  | "increase_intensity"
  | "decrease_intensity"
  | "reduce_distance"
  | "hold";

export type UserProfileInput = {
  age: number;
  gender: Gender;
  heightCm: number;
  weightKg: number;
  injuryHistory: string;
  maxTrainingDaysPerWeek: number;
  availableWeekdays: Weekday[];
  goal: Goal;
};

export type UserProfile = UserProfileInput & {
  id: string;
  createdAt: string;
};

export type RunPrescription = {
  level: RunLevel;
  label: string;
  paceMinPerKm: number;
  heartRateMin: number;
  heartRateMax: number;
};

export type Workout = {
  id: string;
  planId: string;
  date: string;
  weekday: Weekday;
  dayLabel: string;
  title: string;
  distanceKm: number | null;
  durationMin: number | null;
  runLevel: RunLevel;
  paceMinPerKm: number;
  heartRateMin: number;
  heartRateMax: number;
  status: "pending" | "completed" | "missed";
};

export type WorkoutFeedback = {
  id: string;
  workoutId: string;
  heartRate: number;
  completed: boolean;
  subjectiveFeedback: SubjectiveFeedback;
  createdAt: string;
};

export type WeeklyPlan = {
  id: string;
  userId: string;
  weekNumber: number;
  startDate: string;
  endDate: string;
  goal: Goal;
  status: "active" | "history" | "draft";
  totalDistanceKm: number;
  workouts: Workout[];
};

export type RuleRecommendation = {
  action: RecommendationAction;
  reason: string;
  highHeartRateCount: number;
  hardFeedbackCount: number;
  incompleteCount: number;
  nextPlan: WeeklyPlan;
};

export type AiRecommendation = {
  id: string;
  userId: string;
  sourcePlanId: string;
  proposedPlanId: string;
  action: RecommendationAction;
  ruleReason: string;
  aiSummary: string;
  aiReasoning: string;
  aiNextWeekAdvice: string;
  aiCaution: string;
  status: "pending" | "applied";
  createdAt: string;
};

export type AppState = {
  profile: UserProfile | null;
  plans: WeeklyPlan[];
  feedback: WorkoutFeedback[];
  pendingRecommendation: AiRecommendation | null;
};
