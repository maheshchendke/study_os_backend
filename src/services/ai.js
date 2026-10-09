import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { pool } from "../config/database.js";
import { ApiError, objectBody, requiredText } from "../utils/http.js";
import { getDashboard } from "./dashboard.js";
import { createEntity, deleteEntity, getEntity, listEntities, updateEntity } from "./entities.js";
import { startPomodoro } from "./pomodoros.js";
import { z } from "zod";

const supportedActions = new Set([
  "createTask", "updateTask", "completeTask", "deleteTask", "createSubject", "createGoal", "updateGoal", "deleteGoal",
  "createNote", "updateNote", "deleteNote", "createStudyPlan", "startPomodoro", "completePomodoro",
  "createHabit", "completeHabit", "addPlacementTopic", "createPlacementRoadmap",
  "deleteHabit", "deletePlacementRoadmap", "analyzeProgress", "getDashboard", "getAnalytics", "getTasks", "getGoals", "getNotes",
]);

export const AI_SYSTEM_PROMPT = `You are StudyOS AI, a friendly general-purpose assistant. Answer any question helpfully and accurately, including programming, data structures, mathematics, science, general knowledge, careers, exams, and placements. Match the user's language and script (including Hindi, Roman-script Hinglish, Telugu, and English) and level. If uncertain, say so rather than guessing.

Start with the direct answer. Use short headings, bullets, numbered steps, and comparison tables when useful. Be concise for simple questions and detailed for complex ones.

For programming requests: give a one-line introduction, complete code in a fenced block with the correct language tag, a step-by-step explanation, sample output, relevant time and space complexity, and one or two useful tips or common mistakes. Never intentionally truncate code.

For concepts: explain simply, include a real example or analogy and key points, then optionally add a short practice question. For exams, placements, and interviews, explain clearly and give quick revision points; for interview preparation include the question, model answer, and follow-up questions.

Use supplied StudyOS data only when the user asks about their progress or plans or when it clearly helps. Never mention notes, tasks, or other personal data as filler. Never invent records or claim an action completed before the backend confirms it.

When a user clearly requests a StudyOS change, request one action using the provider's native tools if available, or append exactly one final fenced block marked studyos-action containing JSON {"type":"supportedAction","data":{...}} after the user-facing Markdown. Never expose action JSON in the user-facing answer. Ask a brief follow-up instead when required action details are missing. Never produce SQL. Use IDs from supplied data for updates, completions, and deletions. For destructive actions the backend requires confirmation. Dates use YYYY-MM-DD; priorities Low/Medium/High; task status To Do/In Progress/Completed.

Supported action types: ${[...supportedActions].join(", ")}.`;

const actionSchema = z.object({
  type: z.enum([...supportedActions]),
  data: z.record(z.string(), z.unknown()),
}).strict();

export function parseAssistantResponse(raw) {
  const match = raw.match(/(?:^|\n)```studyos-action\s*\n([\s\S]*?)\n```\s*$/i);
  if (!match) return { message: raw.trim(), action: null };
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    throw new ApiError(502, "The AI requested an invalid workspace action. Please try again.", "AI_INVALID_ACTION");
  }
  const result = actionSchema.safeParse(parsed);
  if (!result.success) throw new ApiError(502, "The AI requested an invalid workspace action. Please try again.", "AI_INVALID_ACTION");
  const visibleMessage = raw.slice(0, match.index).trim();
  return { message: visibleMessage || "Done. I've applied that to your StudyOS workspace.", action: result.data };
}

export function fallbackAnswer(message) {
  const question = message.toLowerCase();
  if (/capital of australia/.test(question)) return "The capital of Australia is **Canberra**.";
  if (/recursion/.test(question)) return "## Recursion\n\nRecursion is when a function solves a problem by calling itself on a smaller version of that problem.\n\nFor example, imagine opening nested boxes: each box contains a smaller box until you reach the last one. That last box is the **base case** that stops the calls.\n\nA recursive solution needs a base case and progress toward it.";
  if (/java|program|code|linked list/.test(question)) return "I can help with that. Please share the exact requirements (for example, the operations your program should support), and I’ll provide a complete solution with an explanation.";
  return "I can help with that. Could you share one more detail about what you want to know?";
}

function logProviderFailure({ category, status = null, message, providerCode = null, causeCode = null }) {
  console.error("StudyOS AI provider request failed:", JSON.stringify({
    provider: "Gemini OpenAI-compatible API",
    context: "POST /api/ai/chat (structured response and action handling)",
    category,
    httpStatus: status,
    providerCode,
    causeCode,
    message,
  }));
}

function classifyProviderFailure(status, providerError = {}) {
  const providerCode = typeof providerError.status === "string" && /^[A-Z0-9_]{1,64}$/.test(providerError.status)
    ? providerError.status
    : null;
  const providerMessage = typeof providerError.message === "string" ? providerError.message.toLowerCase() : "";
  const providerStatus = (providerCode || "").toLowerCase();
  const details = `${providerStatus} ${providerMessage}`;

  if (status === 429 || /resource_exhausted|rate.?limit|quota/.test(details)) {
    return { category: "rate_limited", providerCode, message: "Gemini rate limited the request." };
  }
  if ([401, 403].includes(status) || /api.?key|credential|unauthenticated|permission_denied/.test(details)) {
    return { category: "credentials_or_permissions", providerCode, message: "Gemini rejected backend credentials or project permissions." };
  }
  if (/model/.test(details) && /not found|unsupported|invalid|not available/.test(details)) {
    return { category: "model_unavailable", providerCode, message: "Gemini rejected the configured model." };
  }
  if (status === 404) {
    return { category: "endpoint_not_found", providerCode, message: "Gemini did not recognize the configured API endpoint or resource." };
  }
  if (status === 400) {
    return { category: "request_rejected", providerCode, message: "Gemini rejected the chat completion request format." };
  }
  if (status >= 500) {
    return { category: "provider_server_error", providerCode, message: "Gemini returned a server error." };
  }
  return { category: "provider_rejected", providerCode, message: "Gemini rejected the chat completion request." };
}

function providerErrorResponse(status, providerError = {}) {
  const diagnostic = classifyProviderFailure(status, providerError);
  logProviderFailure({ ...diagnostic, status });
  if (diagnostic.category === "rate_limited") {
    throw new ApiError(429, "The AI service is busy. Try again shortly.", "AI_RATE_LIMITED");
  }
  if (diagnostic.category === "credentials_or_permissions") {
    throw new ApiError(502, "The AI service rejected its backend configuration. Please check provider credentials and access.", "AI_PROVIDER_AUTH_ERROR");
  }
  if (diagnostic.category === "model_unavailable") {
    throw new ApiError(502, "The AI service rejected its configured model. Please check AI_MODEL in backend/.env.", "AI_MODEL_ERROR");
  }
  if (diagnostic.category === "request_rejected") {
    throw new ApiError(502, "The AI service rejected the chat request format.", "AI_REQUEST_ERROR");
  }
  throw new ApiError(502, "The AI service could not complete the request. Please try again later.", "AI_PROVIDER_ERROR");
}

async function studyContext(userId) {
  const [subjects, tasks, goals, notes, habits, dashboard] = await Promise.all([
    listEntities("subjects", userId),
    listEntities("tasks", userId),
    listEntities("goals", userId),
    listEntities("notes", userId),
    listEntities("habits", userId),
    getDashboard(userId),
  ]);
  return {
    subjects: subjects.map(({ id, name, code }) => ({ id, name, code })),
    tasks: tasks.map(({ id, title, subject, subject_id, status, priority, due_date }) => ({ id, title, subject, subject_id, status, priority, due_date })),
    goals: goals.map(({ id, title, status, deadline, progress, target }) => ({ id, title, status, deadline, progress, target })),
    notes: notes.map(({ id, title, subject, type, tags }) => ({ id, title, subject, type, tags })),
    habits: habits.map(({ id, name, streak }) => ({ id, name, streak })),
    dashboard: dashboard.stats,
    recentActivity: dashboard.recentActivity,
  };
}

async function providerResponse(message, context, history = [], continuation = false, signal) {
  if (!env.ai.apiKey || !env.ai.model) {
    if (input.confirmationId && input.confirm === true) {
      const [pending] = await pool.execute("SELECT * FROM ai_actions WHERE id=? AND user_id=? AND status='pending_confirmation' LIMIT 1", [input.confirmationId, userId]);
      if (!pending.length) throw new ApiError(404, "Pending AI action not found.", "NOT_FOUND");
      const action = JSON.parse(pending[0].structured_action);
      const result = await executeAction(userId, action);
      await pool.execute("UPDATE ai_actions SET status='completed', result=? WHERE id=? AND user_id=?", [JSON.stringify(result), input.confirmationId, userId]);
      const response = { message: "The confirmed action has been completed.", action: action.type, result };
      onEvent({ type: "token", text: response.message }); onEvent({ type: "done", response }); return response;
    }
    throw new ApiError(503, "AI Mentor is not configured. Add AI_API_KEY and AI_MODEL to backend/.env.", "AI_NOT_CONFIGURED");
  }
  let response;
  try {
    response = await fetch(`${env.ai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.ai.apiKey}` },
      body: JSON.stringify({
        model: env.ai.model,
        temperature: 0.2,
        max_tokens: 4000,
        messages: [
          {
            role: "system",
            content: AI_SYSTEM_PROMPT,
          },
          ...history.slice(-20).map(({ role, content }) => ({ role: role === "assistant" ? "assistant" : "user", content: String(content).slice(0, 12000) })),
          { role: "user", content: `User message: ${message}${continuation ? "\n\nContinue the previous answer from exactly where it stopped. Do not repeat completed material." : ""}\n\nStudyOS data (use only when relevant):\n${JSON.stringify(context)}` },
        ],
      }),
      signal: signal || AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError";
    const causeCode = typeof error?.cause?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.cause.code)
      ? error.cause.code
      : null;
    logProviderFailure({
      category: timedOut ? "timeout" : "network_error",
      causeCode,
      message: timedOut ? "The Gemini request timed out before an HTTP response was received." : "The Gemini request failed before an HTTP response was received.",
    });
    throw new ApiError(
      timedOut ? 504 : 502,
      timedOut ? "The AI service took too long to respond. Please try again." : "The AI service is temporarily unreachable. Please try again later.",
      timedOut ? "AI_TIMEOUT" : "AI_PROVIDER_UNAVAILABLE"
    );
  }
  if (!response.ok) {
    let providerError = {};
    try {
      const payload = await response.json();
      providerError = payload?.error && typeof payload.error === "object" ? payload.error : {};
    } catch {
      providerError = {};
    }
    return providerErrorResponse(response.status, providerError);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    logProviderFailure({ category: "invalid_provider_response", status: response.status, message: "Gemini returned a successful HTTP status with invalid JSON." });
    throw new ApiError(502, "The AI service returned an invalid response. Please try again.", "AI_INVALID_PROVIDER_RESPONSE");
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    logProviderFailure({ category: "missing_completion_content", status: response.status, message: "Gemini returned no chat completion content." });
    throw new ApiError(502, "The AI service returned an empty response. Please try again.", "AI_INVALID_PROVIDER_RESPONSE");
  }
  const choice = payload?.choices?.[0];
  return { ...parseAssistantResponse(content), truncated: choice?.finish_reason === "length" || choice?.finish_reason === "max_tokens" };
}

async function logAction(userId, request, action, status, result = null, id = randomUUID()) {
  await pool.execute(
    `INSERT INTO ai_actions (id,user_id,action_type,request,structured_action,status,result)
     VALUES (?,?,?,?,?,?,?)`,
    [id, userId, action?.type || "conversation", request, JSON.stringify(action || {}), status, result ? JSON.stringify(result) : null]
  );
  return id;
}

function validateAction(action) {
  if (!action || typeof action !== "object" || !supportedActions.has(action.type)) {
    throw new ApiError(400, "AI requested an unsupported action.", "UNSUPPORTED_AI_ACTION");
  }
  if (!action.data || typeof action.data !== "object" || Array.isArray(action.data)) {
    throw new ApiError(400, "AI action data is invalid.", "INVALID_AI_ACTION");
  }
  return action;
}

async function executeAction(userId, action) {
  const data = action.data;
  switch (action.type) {
    case "createSubject": return createEntity("subjects", userId, data);
    case "createTask":
      if (!data.title || !data.due_date || !data.subject) {
        return { clarification: "What subject should I associate with this task, and when is it due?" };
      }
      return createEntity("tasks", userId, data);
    case "updateTask": return updateEntity("tasks", userId, requiredText(String(data.id || ""), "task id", 64), data);
    case "completeTask": return updateEntity("tasks", userId, requiredText(String(data.id || ""), "task id", 64), { status: "Completed" });
    case "deleteTask": return deleteEntity("tasks", userId, requiredText(String(data.id || ""), "task id", 64));
    case "createGoal": return createEntity("goals", userId, data);
    case "updateGoal": return updateEntity("goals", userId, requiredText(String(data.id || ""), "goal id", 64), data);
    case "deleteGoal": return deleteEntity("goals", userId, requiredText(String(data.id || ""), "goal id", 64));
    case "createNote": return createEntity("notes", userId, data);
    case "updateNote": return updateEntity("notes", userId, requiredText(String(data.id || ""), "note id", 64), data);
    case "deleteNote": return deleteEntity("notes", userId, requiredText(String(data.id || ""), "note id", 64));
    case "createStudyPlan": return createEntity("study-plans", userId, data);
    case "startPomodoro": return startPomodoro(userId, data);
    case "completePomodoro": {
      const [rows] = await pool.execute("UPDATE pomodoro_sessions SET status='completed', completed_at=NOW() WHERE id=? AND user_id=? AND status='running'", [requiredText(String(data.id || ""), "session id", 64), userId]);
      if (!rows.affectedRows) throw new ApiError(404, "Running Pomodoro session not found.", "NOT_FOUND");
      return { id: data.id, status: "completed" };
    }
    case "createHabit": return createEntity("habits", userId, data);
    case "deleteHabit": return deleteEntity("habits", userId, requiredText(String(data.id || ""), "habit id", 64));
    case "completeHabit": {
      const habit = await getEntity("habits", userId, requiredText(String(data.id || ""), "habit id", 64));
      const today = new Date().toISOString().slice(0, 10);
      const entries = Array.isArray(habit.completions) ? habit.completions : [];
      if (!entries.includes(today)) entries.push(today);
      const result = await updateEntity("habits", userId, habit.id, { completions: entries, streak: Number(habit.streak || 0) + 1, last_completed: today });
      await (await import("./events.js")).recordEvent(userId, "HABIT_COMPLETED", "habit", habit.id, { name: habit.name });
      return result;
    }
    case "addPlacementTopic": {
      const { savePlacementTopic } = await import("./placement.js");
      return savePlacementTopic(userId, data);
    }
    case "createPlacementRoadmap": return createEntity("placement-roadmaps", userId, data);
    case "deletePlacementRoadmap": return deleteEntity("placement-roadmaps", userId, requiredText(String(data.id || ""), "roadmap id", 64));
    case "getDashboard": return getDashboard(userId);
    case "getAnalytics": return (await import("./analytics.js")).getAnalytics(userId, Number(data.days) || 7);
    case "getTasks": return listEntities("tasks", userId);
    case "getGoals": return listEntities("goals", userId);
    case "getNotes": return listEntities("notes", userId);
    case "analyzeProgress": return (await import("./analytics.js")).getAnalytics(userId, Number(data.days) || 30);
    default: throw new ApiError(400, "AI action is not supported.", "UNSUPPORTED_AI_ACTION");
  }
}

export async function chat(userId, body) {
  const input = objectBody(body);
  const message = requiredText(input.message, "message", 8000);
  if (input.confirmationId && input.confirm === true) {
    const [pending] = await pool.execute(
      "SELECT * FROM ai_actions WHERE id=? AND user_id=? AND status='pending_confirmation' LIMIT 1",
      [input.confirmationId, userId]
    );
    if (!pending.length) throw new ApiError(404, "Pending AI action not found.", "NOT_FOUND");
    const action = JSON.parse(pending[0].structured_action);
    const result = await executeAction(userId, action);
    await pool.execute("UPDATE ai_actions SET status='completed', result=? WHERE id=? AND user_id=?", [JSON.stringify(result), input.confirmationId, userId]);
    return { message: "The confirmed action has been completed.", action: action.type, result };
  }
  const context = await studyContext(userId);
  const history = Array.isArray(input.history) ? input.history.filter((entry) => entry && ["user", "assistant"].includes(entry.role) && typeof entry.content === "string") : [];
  const answer = await providerResponse(message, context, history, input.continue === true);
  const response = { message: requiredText(String(answer.message || "I could not determine a response.", "message", 20000), "message", 20000), truncated: Boolean(answer.truncated) };
  if (!answer.action) {
    await logAction(userId, message, null, "completed", response);
    return response;
  }
  const action = validateAction(answer.action);
  const destructive = action.type.startsWith("delete");
  if (destructive) {
    const confirmationId = await logAction(userId, message, action, "pending_confirmation");
    return { ...response, confirmationRequired: true, confirmationId, action: action.type };
  }
  const result = await executeAction(userId, action);
  await logAction(userId, message, action, "completed", result);
  if (result?.clarification) return { message: result.clarification, clarificationRequired: true };
  return { ...response, action: action.type, result };
}

export async function streamChat(userId, body, onEvent, signal) {
  const input = objectBody(body);
  const message = requiredText(input.message, "message", 8000);
  const history = Array.isArray(input.history) ? input.history.filter((entry) => entry && ["user", "assistant"].includes(entry.role) && typeof entry.content === "string") : [];
  if (!env.ai.apiKey || !env.ai.model) {
    const response = { message: fallbackAnswer(message), fallback: true, truncated: false };
    onEvent({ type: "notice", message: "AI key is not configured; showing a local fallback." });
    onEvent({ type: "token", text: response.message });
    onEvent({ type: "done", response });
    return response;
  }
  let providerResponseObject;
  try {
    const context = await studyContext(userId);
    const provider = await fetch(`${env.ai.baseUrl}/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.ai.apiKey}` }, signal,
      body: JSON.stringify({ model: env.ai.model, temperature: 0.2, max_tokens: 4000, stream: true, messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        ...history.slice(-20).map(({ role, content }) => ({ role, content: String(content).slice(0, 12000) })),
        { role: "user", content: `User message: ${message}${input.continue ? "\n\nContinue the previous answer without repeating completed material." : ""}\n\nStudyOS data (use only when relevant):\n${JSON.stringify(context)}` },
      ] }),
    });
    if (!provider.ok || !provider.body) return providerErrorResponse(provider.status, await provider.json().catch(() => ({})));
    if (provider.headers.get("content-type")?.includes("text/event-stream")) providerResponseObject = provider;
    else {
      const payload = await provider.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new ApiError(502, "The AI service returned an invalid response.", "AI_INVALID_PROVIDER_RESPONSE");
      const parsed = parseAssistantResponse(content);
      const publicResponse = { message: parsed.message, truncated: payload.choices[0].finish_reason === "length" };
      if (parsed.action) {
        const action = validateAction(parsed.action);
        if (action.type.startsWith("delete")) Object.assign(publicResponse, { confirmationRequired: true, confirmationId: await logAction(userId, message, action, "pending_confirmation"), action: action.type });
        else { const result = await executeAction(userId, action); await logAction(userId, message, action, "completed", result); Object.assign(publicResponse, { action: action.type, result }); if (result?.clarification) publicResponse.message = result.clarification; }
      } else await logAction(userId, message, null, "completed", publicResponse);
      onEvent({ type: "token", text: publicResponse.message }); onEvent({ type: "done", response: publicResponse }); return publicResponse;
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    const answer = await providerResponse(message, await studyContext(userId), history, input.continue === true, signal);
    const publicResponse = { message: answer.message, truncated: Boolean(answer.truncated) };
    if (answer.action) {
      const action = validateAction(answer.action);
      const result = action.type.startsWith("delete")
        ? null
        : await executeAction(userId, action);
      const confirmationId = action.type.startsWith("delete") ? await logAction(userId, message, action, "pending_confirmation") : null;
      if (!confirmationId) await logAction(userId, message, action, "completed", result);
      Object.assign(publicResponse, confirmationId ? { confirmationRequired: true, confirmationId, action: action.type } : { action: action.type, result });
    } else await logAction(userId, message, null, "completed", publicResponse);
    onEvent({ type: "token", text: publicResponse.message }); onEvent({ type: "done", response: publicResponse });
    return publicResponse;
  }
  const reader = providerResponseObject.body.getReader();
  const decoder = new TextDecoder();
  let buffer = ""; let raw = ""; let finishReason = null;
  let streamPending = ""; let actionMetadataStarted = false;
  const actionMarker = "```studyos-action";
  const publishSafeText = (text, final = false) => {
    if (actionMetadataStarted) return;
    streamPending += text;
    const markerIndex = streamPending.indexOf(actionMarker);
    if (markerIndex >= 0) {
      actionMetadataStarted = true;
      const visible = streamPending.slice(0, markerIndex).replace(/\n+$/, "");
      if (visible) onEvent({ type: "token", text: visible });
      streamPending = "";
      return;
    }
    const safeLength = final ? streamPending.length : Math.max(0, streamPending.length - actionMarker.length + 1);
    if (safeLength) {
      onEvent({ type: "token", text: streamPending.slice(0, safeLength) });
      streamPending = streamPending.slice(safeLength);
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n"); buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      let event; try { event = JSON.parse(line.slice(6)); } catch { continue; }
      const choice = event.choices?.[0];
      if (choice?.delta?.content) { raw += choice.delta.content; publishSafeText(choice.delta.content); }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    }
  }
  if (buffer.startsWith("data: ") && buffer !== "data: [DONE]") {
    try { const event = JSON.parse(buffer.slice(6)); const choice = event.choices?.[0]; if (choice?.delta?.content) { raw += choice.delta.content; publishSafeText(choice.delta.content); } if (choice?.finish_reason) finishReason = choice.finish_reason; } catch { /* Ignore a final incomplete provider event. */ }
  }
  publishSafeText("", true);
  const parsed = parseAssistantResponse(raw);
  const publicResponse = { message: parsed.message, truncated: finishReason === "length" || finishReason === "max_tokens" };
  if (parsed.action) {
    const action = validateAction(parsed.action);
    if (action.type.startsWith("delete")) {
      Object.assign(publicResponse, { confirmationRequired: true, confirmationId: await logAction(userId, message, action, "pending_confirmation"), action: action.type });
    } else {
      const result = await executeAction(userId, action); await logAction(userId, message, action, "completed", result);
      Object.assign(publicResponse, { action: action.type, result });
      if (result?.clarification) publicResponse.message = result.clarification;
    }
  } else await logAction(userId, message, null, "completed", publicResponse);
  onEvent({ type: "done", response: publicResponse });
  return publicResponse;
}
