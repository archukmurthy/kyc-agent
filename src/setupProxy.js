// Local dev only. CRA auto-loads this file when running `npm start` and
// registers the middleware on the webpack-dev-server Express instance.
// Mirrors api/research.js so /api/research works locally the same way it
// does on Vercel in production. This file is NOT bundled into the React
// app — it only runs in the dev server process.
//
// Requires ANTHROPIC_API_KEY in .env.local (CRA loads it automatically).

module.exports = function (app) {
  app.post("/api/research", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", async () => {
      try {
        const body = JSON.parse(raw || "{}");
        const { prompt, messages, model, tools, max_tokens } = body;
        if (!prompt && !messages) {
          return res.status(400).json({ error: "Missing prompt or messages in request body" });
        }

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          return res.status(500).json({
            error: "Server API key not configured",
            message: "Add ANTHROPIC_API_KEY=sk-ant-... to .env.local at the repo root and restart `npm start`.",
          });
        }

        const finalMessages = messages || [{ role: "user", content: prompt }];
        const finalModel = model || "claude-sonnet-4-5";
        const finalMaxTokens = max_tokens || 16000;
        const finalTools = Array.isArray(tools)
          ? tools
          : [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];

        const requestBody = {
          model: finalModel,
          max_tokens: finalMaxTokens,
          messages: finalMessages,
        };
        if (finalTools.length > 0) requestBody.tools = finalTools;

        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(requestBody),
        });

        const data = await r.json();
        if (!r.ok) {
          return res.status(r.status).json({ error: "Claude API error", details: data });
        }
        res.status(200).json(data);
      } catch (err) {
        res.status(500).json({ error: "Server error", message: err.message });
      }
    });
  });
};
