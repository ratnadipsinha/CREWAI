// Serverless proxy to an OpenAI-compatible LLM API.
// The browser calls /llm/chat/completions (same origin); Netlify rewrites it here.
// The API key lives in a Netlify env var (LLM_API_KEY) — never shipped to the browser.

export async function handler(event) {
  const upstream = (process.env.LLM_UPSTREAM || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const key = process.env.LLM_API_KEY || "";

  if (!key) {
    return json(500, { error: "LLM_API_KEY not set in Netlify environment variables" });
  }

  // path after the function name, e.g. "/chat/completions"
  const sub =
    event.path.split("/.netlify/functions/llm")[1] ||
    event.path.replace(/^\/llm/, "") ||
    "/chat/completions";

  try {
    const res = await fetch(upstream + sub, {
      method: event.httpMethod,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: event.httpMethod === "GET" ? undefined : event.body,
    });
    const text = await res.text();
    return {
      statusCode: res.status,
      headers: { "Content-Type": "application/json" },
      body: text,
    };
  } catch (e) {
    return json(502, { error: `proxy failed: ${e.message}` });
  }
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}
