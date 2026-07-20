const nodeRulePacks =
  typeof require === "function"
    ? {
        UK: {
          LOA: require("./UK/loaRulePack"),
        },
        SG: {
          LOA: require("./SG/loaRulePack"),
        },
      }
    : null;

function getBrowserRulePacks() {
  return {
    UK: {
      LOA: window.UkLoaRulePack,
    },
    SG: {
      LOA: window.SgLoaRulePack,
    },
  };
}

function normalizeMarket(market) {
  const value = String(market || "").trim().toUpperCase();
  if (value === "GB") return "UK";
  if (value === "SINGAPORE") return "SG";
  if (value === "UNITED KINGDOM") return "UK";
  return value;
}

function loadRulePack({ market, documentType = "LOA" } = {}) {
  const normalizedMarket = normalizeMarket(market);
  const normalizedDocumentType = String(documentType || "LOA").toUpperCase();
  const registry = nodeRulePacks || getBrowserRulePacks();
  const rulePack = registry[normalizedMarket] && registry[normalizedMarket][normalizedDocumentType];

  if (!rulePack) {
    throw new Error(`No validation rule pack for ${normalizedMarket}/${normalizedDocumentType}`);
  }

  return rulePack;
}

var rulePackLoaderExported = {
  loadRulePack,
  normalizeMarket,
};

if (typeof module !== "undefined") {
  module.exports = rulePackLoaderExported;
}

if (typeof window !== "undefined") {
  window.ValidationRulePackLoader = rulePackLoaderExported;
}
