/**
 * LLM 调用工具 — 支持 OpenAI 和 Google Vertex AI (Gemini)
 *
 * 配置方式 (环境变量):
 * - Vertex AI: GCP_CREDENTIALS_PATH, GEMINI_MODEL (默认 gemini-3.5-flash)
 * - OpenAI: OPENAI_API_KEY, OPENAI_MODEL (默认 gpt-4o-mini)
 * - 通用: LLM_PROVIDER (vertex | openai), LLM_TEMPERATURE
 */

import crypto from "node:crypto";
import fs from "node:fs";

export type LlmProvider = "openai" | "vertex";

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  temperature: number;
}

/**
 * 从环境变量读取 LLM 配置
 */
export function getLlmConfig(): LlmConfig {
  const provider = (process.env.LLM_PROVIDER || "vertex") as LlmProvider;
  const model =
    provider === "openai"
      ? process.env.OPENAI_MODEL || "gpt-4o-mini"
      : process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const temperature = Number(process.env.LLM_TEMPERATURE) || 0.3;
  return { provider, model, temperature };
}

/**
 * 清理 LLM 响应中的 JSON 文本（去掉 markdown 代码块标记等）
 */
function cleanJsonText(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    const idx = t.indexOf("\n");
    if (idx > -1) t = t.slice(idx + 1);
    else t = t.slice(3);
  }
  if (t.endsWith("```")) t = t.slice(0, -3);
  return t.trim();
}

/**
 * 调用 LLM 并返回结构化 JSON 结果
 */
export async function callLlmWithJson<T = Record<string, unknown>>(
  systemPrompt: string,
  userContent: string,
  config?: LlmConfig,
): Promise<T> {
  const cfg = config ?? getLlmConfig();
  const text = await callLlmRaw(systemPrompt, userContent, cfg);
  const cleaned = cleanJsonText(text);
  return JSON.parse(cleaned) as T;
}

/**
 * 调用 LLM 返回原始文本
 */
async function callLlmRaw(
  systemPrompt: string,
  userContent: string,
  config: LlmConfig,
): Promise<string> {
  if (config.provider === "openai") return callOpenAi(systemPrompt, userContent, config);
  return callVertexAi(systemPrompt, userContent, config);
}

// ── OpenAI ────────────────────────────────────────────────

async function callOpenAi(
  systemPrompt: string,
  userContent: string,
  config: LlmConfig,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 未设置");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API 错误 (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI 返回了空响应");
  return content;
}

// ── Google Vertex AI ───────────────────────────────────────

let _cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt) return _cachedToken.token;

  const credPath = process.env.GCP_CREDENTIALS_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) throw new Error("需要设置 GCP_CREDENTIALS_PATH 环境变量");

  let creds: { client_email: string; private_key: string; project_id?: string };
  try { creds = JSON.parse(fs.readFileSync(credPath, "utf8")); }
  catch { throw new Error(`无法读取 GCP 凭据文件: ${credPath}`); }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const b64url = (s: string) => Buffer.from(s).toString("base64url");
  const assertion = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(claimSet));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(assertion);
  const jwt = assertion + "." + signer.sign(creds.private_key, "base64url");

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const data = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error(`GCP OAuth2 认证失败: ${JSON.stringify(data)}`);

  _cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60000 };
  return data.access_token;
}

async function callVertexAi(systemPrompt: string, userContent: string, config: LlmConfig): Promise<string> {
  const credPath = process.env.GCP_CREDENTIALS_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) throw new Error("GCP_CREDENTIALS_PATH 未设置");

  const creds = JSON.parse(fs.readFileSync(credPath, "utf8"));
  const projectId = creds.project_id;
  if (!projectId) throw new Error("凭据文件中缺少 project_id");

  const accessToken = await getAccessToken();
  const response = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${config.model}:generateContent`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: userContent }] }],
        system_instruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: config.temperature },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    const parsed = tryParseJson(text);
    throw new Error((parsed as any)?.error?.message || `Vertex AI 错误 (${response.status})`);
  }

  const result = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Vertex AI 返回了空响应");
  return text;
}

function tryParseJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text) as Record<string, unknown>; }
  catch { return null; }
}
