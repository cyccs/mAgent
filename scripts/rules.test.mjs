import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rules = readFileSync(new URL("../src/lib/training-rules.ts", import.meta.url), "utf8");
const constants = readFileSync(new URL("../src/lib/constants.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");

assert.match(rules, /maxTrainingDaysPerWeek/);
assert.match(rules, /availableWeekdays/);
assert.match(rules, /highHeartRateCount > 3/);
assert.match(rules, /hardFeedbackCount > 3/);
assert.match(rules, /incompleteCount > 0/);
assert.match(constants, /heartRateMin: 130/);
assert.match(constants, /heartRateMax: 172/);

assert.match(page, /周次/);
assert.match(page, /日期范围/);
assert.match(page, /待反馈/);
assert.match(page, /生成下周 AI 建议/);

console.log("Rule/UI smoke checks passed");
