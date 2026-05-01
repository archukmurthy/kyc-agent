// This is the backend. It runs on Vercel's servers, not in the browser.
// It holds your API key securely and forwards requests to Claude.

export default async function handler(req, res) {
  // Allow CORS from any origin (safe because this only accepts POST with specific body)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt, messages, model, tools, max_tokens } = req.body;

    if (!prompt && !messages) {
      return res.status(400).json({ error: "Missing prompt or messages in request body" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Server API key not configured" });
    }

    const finalMessages = messages || [{ role: "user", content: prompt }];
    const finalModel = model || "claude-sonnet-4-5";
    const finalMaxTokens = max_tokens || 8000;
    const finalTools = Array.isArray(tools)
      ? tools
      : [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];

    const requestBody = {
      model: finalModel,
      max_tokens: finalMaxTokens,
      messages: finalMessages,
    };
    if (finalTools.length > 0) requestBody.tools = finalTools;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Claude API error",
        details: data
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      message: err.message
    });
  }
}
