import type { RunLevel, RunPrescription, Weekday } from "./types";

export const WEEKDAYS: Array<{ value: Weekday; label: string; short: string }> = [
  { value: 1, label: "周一", short: "一" },
  { value: 2, label: "周二", short: "二" },
  { value: 3, label: "周三", short: "三" },
  { value: 4, label: "周四", short: "四" },
  { value: 5, label: "周五", short: "五" },
  { value: 6, label: "周六", short: "六" },
  { value: 0, label: "周日", short: "日" },
];

export const PRESCRIPTIONS: Record<RunLevel, RunPrescription> = {
  easy: {
    level: "easy",
    label: "简单跑",
    paceMinPerKm: 10,
    heartRateMin: 130,
    heartRateMax: 142,
  },
  normal: {
    level: "normal",
    label: "正常跑",
    paceMinPerKm: 7,
    heartRateMin: 142,
    heartRateMax: 160,
  },
  advanced: {
    level: "advanced",
    label: "进阶跑",
    paceMinPerKm: 5,
    heartRateMin: 160,
    heartRateMax: 172,
  },
};
