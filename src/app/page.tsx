"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AppState,
  Goal,
  SubjectiveFeedback,
  Weekday,
  Workout,
  WorkoutFeedback,
} from "@/lib/types";
import { WEEKDAYS } from "@/lib/constants";

const emptyState: AppState = {
  profile: null,
  plans: [],
  feedback: [],
  pendingRecommendation: null,
};

export default function Home() {
  const [state, setState] = useState<AppState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null);
  const [notice, setNotice] = useState("");
  const [generating, setGenerating] = useState(false);

  async function refresh() {
    const res = await fetch("/api/state", { cache: "no-store" });
    setState(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  const activePlan = useMemo(
    () => state.plans.find((p) => p.status === "active") ?? state.plans.at(-1),
    [state.plans],
  );

  const feedbackByWorkout = useMemo(
    () => new Map(state.feedback.map((f) => [f.workoutId, f])),
    [state.feedback],
  );

  const completedCount = useMemo(
    () =>
      activePlan
        ? activePlan.workouts.filter((w) => {
            const fb = feedbackByWorkout.get(w.id);
            return fb?.completed;
          }).length
        : 0,
    [activePlan, feedbackByWorkout],
  );

  if (loading) {
    return (
      <main className="page-shell">
        <div className="loading">
          <span className="spinner" />
          加载中...
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Running Coach AI</p>
          <h1>每周跑步计划</h1>
          <p className="subtitle">
            AI 根据你的目标与训练反馈，自动生成每周个性化跑步计划
          </p>
        </div>
        {state.profile && (
          <div className="profile-pill">
            {state.profile.goal === "beginner" ? "🏃 新人跑步入门" : "🎯 5公里专项"}
            · 每周最多{state.profile.maxTrainingDaysPerWeek}天
          </div>
        )}
      </header>

      {!state.profile ? (
        <OnboardingForm
          onCreated={async () => {
            setNotice("✅ AI 已为你生成本周训练计划");
            await refresh();
          }}
          onError={(msg) => setNotice(msg)}
        />
      ) : (
        <>
          <Dashboard
            activePlan={activePlan}
            totalPlans={state.plans.length}
            completedCount={completedCount}
            totalCount={activePlan?.workouts.length ?? 0}
            generating={generating}
            hasFeedback={
              activePlan
                ? activePlan.workouts.some((w) => feedbackByWorkout.has(w.id))
                : false
            }
            onGenerate={async () => {
              setGenerating(true);
              setNotice("⏳ 正在请 AI 分析反馈并生成下周计划...");
              try {
                const res = await fetch("/api/recommendation/generate", {
                  method: "POST",
                });
                if (!res.ok) {
                  const data = await res.json();
                  setNotice(data.error ?? "生成失败");
                } else {
                  setNotice("💡 已生成下周计划建议，确认后才会应用");
                }
                await refresh();
              } catch {
                setNotice("网络请求失败，请重试");
              }
              setGenerating(false);
            }}
            onResetGoal={async () => {
              await fetch("/api/reset", { method: "POST" });
              setNotice("🔄 已重置，请重新选择跑步目标");
              await refresh();
            }}
            onClearAll={async () => {
              if (!confirm("确定要清空所有日程数据吗？此操作不可撤销。")) return;
              await fetch("/api/reset", { method: "POST" });
              setNotice("🗑️ 所有日程数据已清空");
              await refresh();
            }}
          />

          {notice && <div className="notice" key={notice}>{notice}</div>}

          {state.plans.length > 0 && (
            <ScheduleTable
              plan={activePlan}
              allPlans={state.plans}
              feedbackByWorkout={feedbackByWorkout}
              onSelectWorkout={setSelectedWorkout}
            />
          )}

          {state.pendingRecommendation && (
            <RecommendationPanel
              recommendation={state.pendingRecommendation}
              onApply={async () => {
                await fetch("/api/recommendation/apply", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id: state.pendingRecommendation?.id,
                  }),
                });
                setNotice("✅ 已应用为下周计划");
                await refresh();
              }}
            />
          )}

          {selectedWorkout && (
            <FeedbackDialog
              workout={selectedWorkout}
              existingFeedback={feedbackByWorkout.get(selectedWorkout.id)}
              onClose={() => setSelectedWorkout(null)}
              onSaved={async () => {
                setSelectedWorkout(null);
                setNotice("✅ 训练反馈已保存");
                await refresh();
              }}
            />
          )}
        </>
      )}
    </main>
  );
}

// ── Onboarding ────────────────────────────────────────────────

function OnboardingForm({
  onCreated,
  onError,
}: {
  onCreated: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [availableWeekdays, setAvailableWeekdays] = useState<Weekday[]>([1, 3, 5]);
  const [goal, setGoal] = useState<Goal>("beginner");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const body = {
      age: Number(form.get("age")),
      gender: String(form.get("gender")),
      heightCm: Number(form.get("heightCm")),
      weightKg: Number(form.get("weightKg")),
      injuryHistory: String(form.get("injuryHistory") ?? ""),
      maxTrainingDaysPerWeek: Number(form.get("maxTrainingDaysPerWeek")),
      availableWeekdays,
      goal,
    };
    const res = await fetch("/api/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json();
      onError(data.errors?.join("，") ?? data.error ?? "提交失败");
      return;
    }
    await onCreated();
  }

  return (
    <form className="onboarding" onSubmit={submit}>
      <div className="form-header">
        <h2>首次登录，填写你的跑步信息</h2>
        <p>AI 将根据你的目标和基础信息，生成科学的每周训练计划</p>
      </div>

      <div className="goal-toggle">
        <button
          type="button"
          className={goal === "beginner" ? "active" : ""}
          onClick={() => setGoal("beginner")}
        >
          🏃 新人跑步入门
          <br />
          <small style={{ fontWeight: 400, fontSize: 12, color: "var(--muted)" }}>
            从 1km 起步，最终完成 5km
          </small>
        </button>
        <button
          type="button"
          className={goal === "five_k" ? "active" : ""}
          onClick={() => setGoal("five_k")}
        >
          🎯 5公里专项训练
          <br />
          <small style={{ fontWeight: 400, fontSize: 12, color: "var(--muted)" }}>
            从 5km 简单跑开始，逐步提速
          </small>
        </button>
      </div>

      <div className="form-grid">
        <label>
          年龄
          <input name="age" type="number" min="10" max="90" defaultValue="28" required />
        </label>
        <label>
          性别
          <select name="gender" defaultValue="other">
            <option value="female">女</option>
            <option value="male">男</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label>
          身高 cm
          <input name="heightCm" type="number" min="100" max="230" defaultValue="170" required />
        </label>
        <label>
          体重 kg
          <input name="weightKg" type="number" min="30" max="250" defaultValue="65" required />
        </label>
        <label>
          每周最多训练天数
          <input
            name="maxTrainingDaysPerWeek"
            type="number"
            min="1"
            max="7"
            defaultValue="3"
            required
          />
        </label>
        <label className="wide">
          过往伤病史
          <textarea name="injuryHistory" placeholder="没有可填写：无" />
        </label>
      </div>

      <fieldset className="weekday-field">
        <legend>每周可训练具体周几</legend>
        <div>
          {WEEKDAYS.map((day) => (
            <label key={day.value} className="checkbox-label">
              <input
                type="checkbox"
                checked={availableWeekdays.includes(day.value)}
                onChange={(e) =>
                  setAvailableWeekdays((prev) =>
                    e.target.checked
                      ? [...prev, day.value]
                      : prev.filter((d) => d !== day.value),
                  )
                }
              />
              {day.label}
            </label>
          ))}
        </div>
      </fieldset>

      <button className="primary-button full" disabled={submitting}>
        {submitting ? "⏳ AI 正在生成计划..." : "🚀 AI 生成本周计划"}
      </button>
    </form>
  );
}

// ── Dashboard ─────────────────────────────────────────────────

function Dashboard({
  activePlan,
  totalPlans,
  completedCount,
  totalCount,
  generating,
  hasFeedback,
  onResetGoal,
  onClearAll,
  onGenerate,
}: {
  activePlan: any;
  totalPlans: number;
  completedCount: number;
  totalCount: number;
  generating: boolean;
  hasFeedback: boolean;
  onResetGoal: () => void;
  onClearAll: () => void;
  onGenerate: () => void;
}) {
  return (
    <>
      <section className="dashboard-grid">
        <div className="panel">
          <h2>📊 训练概览</h2>
          <div className="stat-row">
            <span>总周数</span>
            <strong>{totalPlans} 周</strong>
          </div>
          {activePlan && (
            <>
              <div className="stat-row">
                <span>本周训练</span>
                <strong>
                  {completedCount}/{totalCount} 次完成
                </strong>
              </div>
              <div className="stat-row">
                <span>本周总距离</span>
                <strong>{activePlan.totalDistanceKm} km</strong>
              </div>
              <div className="stat-row">
                <span>本周日期</span>
                <strong>
                  {formatShortDate(activePlan.startDate)} -{" "}
                  {formatShortDate(activePlan.endDate)}
                </strong>
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <h2>🤖 AI 教练</h2>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 14px" }}>
            提交训练反馈后，AI 会根据你的心率和主观感受，智能调整下周计划
          </p>
          <button
            className="primary-button full"
            disabled={generating || !hasFeedback}
            onClick={onGenerate}
            style={{ fontSize: 14 }}
          >
            {generating ? "⏳ 分析中..." : "🎯 生成下周 AI 建议"}
          </button>
          {!hasFeedback && (
            <p style={{ fontSize: 12, color: "var(--warn)", margin: "8px 0 0" }}>
              请先完成本周训练并提交反馈
            </p>
          )}
        </div>
      </section>

      <div className="action-bar">
        <button className="ghost-button" onClick={onResetGoal}>
          🔄 重新选择跑步目标
        </button>
        <button className="ghost-button" onClick={onClearAll}>
          🗑️ 清空日程表
        </button>
      </div>
    </>
  );
}

// ── Schedule Table ──────────────────────────────────────

function ScheduleTable({
  plan,
  allPlans,
  feedbackByWorkout,
  onSelectWorkout,
}: {
  plan: any; // active plan
  allPlans: any[]; // all plans including active
  feedbackByWorkout: Map<string, WorkoutFeedback>;
  onSelectWorkout: (w: Workout) => void;
}) {
  const rows = [...allPlans].reverse();
  return (
    <section className="schedule-section">
      <div className="section-header">
        <h2>📅 训练日程表</h2>
      </div>
      <div className="table-wrap">
        <table className="schedule-table">
          <thead>
            <tr>
              <th>周次</th>
              <th>日期范围</th>
              <th>总训练次数</th>
              <th>总距离</th>
              {WEEKDAYS.map((day) => (
                <th key={day.value}>{day.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const isActive = p.id === plan?.id;
              const totalCount = p.workouts.length;
              return (
                <tr key={p.id} className={isActive ? "active-week" : ""}>
                  <th>
                    Week {p.weekNumber}
                  </th>
                  <td className="schedule-date-range">
                    {formatShortDate(p.startDate)}-{formatShortDate(p.endDate)}
                  </td>
                  <td className="schedule-stat">{totalCount} 次</td>
                  <td className="schedule-stat">{p.totalDistanceKm} km</td>
                  {WEEKDAYS.map((day) => {
                    const w = p.workouts.find(
                      (item: Workout) => item.weekday === day.value,
                    );
                    if (!w) {
                      return <td key={day.value} className="rest-cell">—</td>;
                    }
                    const fb = feedbackByWorkout.get(w.id);
                    return (
                      <td key={w.id}>
                        <button
                          className="schedule-cell-btn"
                          onClick={() => onSelectWorkout(w)}
                        >
                          <span className="schedule-cell-distance">{w.distanceKm} km</span>
                          <span className="schedule-cell-type">{w.runLevel === "easy" ? "简单跑" : w.runLevel === "normal" ? "正常跑" : "进阶跑"}</span>
                          {fb ? (
                            <span className={`status-badge ${fb.completed ? "status-done" : "status-missed"}`}>
                              {fb.completed ? "✅" : "❌"}
                            </span>
                          ) : (
                            <span className="status-badge status-pending">⏳</span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Recommendation ────────────────────────────────────────────

function RecommendationPanel({
  recommendation,
  onApply,
}: {
  recommendation: any;
  onApply: () => void;
}) {
  return (
    <section className="recommendation">
      <p className="eyebrow">AI 教练建议</p>
      <h2>下周训练调整</h2>

      <div className="recommendation-block">
        <h3>📋 AI 总结上周跑步情况</h3>
        <p>{recommendation.aiSummary}</p>
      </div>

      <div className="recommendation-block">
        <h3>📝 AI 建议下周计划</h3>
        <p>{recommendation.aiReasoning}</p>
      </div>

      <div className="recommendation-block">
        <h3>💡 下周训练注意事项</h3>
        <p>{recommendation.aiNextWeekAdvice}</p>
      </div>

      {recommendation.aiCaution && recommendation.aiCaution !== "无" && (
        <p className="caution">⚠️ {recommendation.aiCaution}</p>
      )}

      <div style={{ marginTop: 12 }}>
        <button className="primary-button" onClick={onApply}>
          ✅ 确认应用下周计划
        </button>
      </div>
    </section>
  );
}

// ── Feedback Dialog ───────────────────────────────────────────

function FeedbackDialog({
  workout,
  existingFeedback,
  onClose,
  onSaved,
}: {
  workout: Workout;
  existingFeedback: WorkoutFeedback | undefined;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [heartRate, setHeartRate] = useState(
    String(existingFeedback?.heartRate ?? workout.heartRateMin),
  );
  const [completed, setCompleted] = useState(
    existingFeedback?.completed ?? true,
  );
  const [subjectiveFeedback, setSubjectiveFeedback] =
    useState<SubjectiveFeedback>(existingFeedback?.subjectiveFeedback ?? "medium");
  const [saving, setSaving] = useState(false);

  const hr = Number(heartRate);
  const hrPercent = Math.min(100, Math.max(0, ((hr - 80) / (220 - 80)) * 100));
  const inRange = hr >= workout.heartRateMin && hr <= workout.heartRateMax;

  async function save() {
    setSaving(true);
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workoutId: workout.id,
        heartRate: Number(heartRate),
        completed,
        subjectiveFeedback,
      }),
    });
    await onSaved();
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <p className="eyebrow">{workout.dayLabel}</p>
            <h2>{workout.title}</h2>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
              {workout.distanceKm} km · {workout.paceMinPerKm} min/km · 目标心率{" "}
              {workout.heartRateMin}-{workout.heartRateMax} bpm
            </p>
          </div>
          <button className="ghost-button" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="feedback-grid">
          <label>
            心率（次/分）
            <input
              value={heartRate}
              onChange={(e) => setHeartRate(e.target.value)}
              type="number"
              min="80"
              max="220"
            />
          </label>

          <div className="heart-rate-bar">
            <div className="range-info">
              <span>合理区间: {workout.heartRateMin}-{workout.heartRateMax}</span>
              <span style={{ color: inRange ? "var(--accent)" : "var(--danger)" }}>
                {inRange ? "✅ 正常" : "⚠️ 异常"}
              </span>
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{
                  width: `${hrPercent}%`,
                  background: inRange ? "var(--accent)" : "var(--danger)",
                }}
              />
              <div
                className="bar-target"
                style={{
                  left: `${(((workout.heartRateMin + workout.heartRateMax) / 2 - 80) / (220 - 80)) * 100}%`,
                }}
              />
            </div>
          </div>

          <label>
            主观反馈
          </label>
          <div className="subjective-buttons">
            {(["easy", "medium", "hard"] as SubjectiveFeedback[]).map((value) => (
              <button
                key={value}
                type="button"
                className={`subjective-btn ${value}-color ${subjectiveFeedback === value ? "selected" : ""}`}
                onClick={() => setSubjectiveFeedback(value)}
              >
                {value === "easy" ? "😊 简单" : value === "medium" ? "😐 中等" : "😰 困难"}
              </button>
            ))}
          </div>

          <label className="completed-toggle">
            <input
              type="checkbox"
              checked={completed}
              onChange={(e) => setCompleted(e.target.checked)}
            />
            训练完成
          </label>
        </div>

        <button className="primary-button full" disabled={saving} onClick={save}>
          {saving ? "保存中..." : "保存反馈"}
        </button>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────

function formatShortDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
