// This is the backend. It runs on Vercel's servers, not in the browser.
// It holds your API key securely and forwards requests to Claude.

import { getCachedResearch, saveResearchToCache } from "../lib/researchCache.js";

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
    const { prompt, messages, model, tools, max_tokens,
            companyName, jurisdiction, entityType, forceRefresh } = req.body;

    if (!prompt && !messages) {
      return res.status(400).json({ error: "Missing prompt or messages in request body" });
    }

    // ─── CACHE LAYER (opt-in) ───
    // /api/research is a generic Anthropic proxy used by several call sites
    // (document extraction, gap recovery, main research). Only the main company
    // research call passes `companyName`, so caching activates ONLY then; every
    // other caller is untouched. Cache failures always fall through to the live
    // API — a research run is never blocked because the cache is unavailable.
    const cacheEnabled = !!companyName;
    if (cacheEnabled && !forceRefresh) {
      try {
        const cached = await getCachedResearch(companyName, jurisdiction, entityType);
        if (cached) {
          console.log(`[research-cache] HIT for "${companyName}" — serving from DB`);
          return res.status(200).json(cached);
        }
        console.log(`[research-cache] MISS for "${companyName}" — calling Anthropic API`);
      } catch (err) {
        console.error("[research-cache] Cache lookup error, falling through:", err.message);
      }
    } else if (cacheEnabled && forceRefresh) {
      console.log(`[research-cache] FORCE REFRESH for "${companyName}" — bypassing cache`);
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Server API key not configured" });
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

    // ─── SAVE TO CACHE (opt-in; same gate as the lookup above) ───
    // Don't fail the request if the cache write fails.
    if (cacheEnabled) {
      try {
        await saveResearchToCache(companyName, jurisdiction, entityType, data, finalModel);
      } catch (err) {
        console.error("[research-cache] Failed to save to cache:", err.message);
      }
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      message: err.message
    });
  }
}
