"use strict";

// Versioned name-equivalence rule tables (Phase 6). Each rule carries a stable
// ID so a resolved case can record exactly which rule (and version) explained
// it - the doc requires decisions to be reconstructable. Pure data + helpers.

const RULE_TABLE_VERSION = "name-rules-1.0.0";

// Transliteration equivalence groups: any two tokens in the same group are
// transliteration-equivalent. One group = one rule id.
const TRANSLITERATION = [
  { id: "translit-muhammad", variants: ["muhammad", "mohammed", "mohamed", "mohammad", "muhammed", "mohd"] },
  { id: "translit-yusuf", variants: ["yusuf", "yousef", "yousuf", "yosef", "youssef"] },
  { id: "translit-mikhail", variants: ["mikhail", "michail", "mihail"] },
  { id: "translit-aleksandr", variants: ["aleksandr", "alexander", "alexandr", "aleksander"] },
  { id: "translit-sergei", variants: ["sergei", "sergey", "serguei"] },
  { id: "translit-ahmed", variants: ["ahmed", "ahmad", "ahmet"] },
  { id: "translit-nikolai", variants: ["nikolai", "nikolay", "nicolai"] },
];

// Patronymic particles (separate forename tokens) and surname suffixes to
// normalize away for a base-name comparison. One rule id for the whole class.
const PATRONYMIC = Object.freeze({
  id: "patronymic-normalize",
  particles: new Set(["bin", "binti", "bint", "ibn", "al", "el", "abu", "van", "von", "de", "da", "del", "della", "der", "ben"]),
  suffixes: ["ovich", "evich", "ovna", "evna", "yevich", "yevna", "sson", "son", "sen", "dottir", "datter"],
});

const PHONETIC = Object.freeze({ id: "phonetic-soundex" });

// American Soundex.
function soundex(str) {
  const s = String(str || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!s) return "";
  const codes = { B: 1, F: 1, P: 1, V: 1, C: 2, G: 2, J: 2, K: 2, Q: 2, S: 2, X: 2, Z: 2, D: 3, T: 3, L: 4, M: 5, N: 5, R: 6 };
  let out = s[0];
  let prev = codes[s[0]] || 0;
  for (let i = 1; i < s.length && out.length < 4; i++) {
    const c = codes[s[i]] || 0;
    if (c !== 0 && c !== prev) out += c;
    if (s[i] !== "H" && s[i] !== "W") prev = c;
  }
  return (out + "000").slice(0, 4);
}

// Return the rule id if a and b are in the same transliteration group, else null.
function transliterationRule(a, b) {
  if (a === b) return null;
  for (const group of TRANSLITERATION) {
    if (group.variants.includes(a) && group.variants.includes(b)) return group.id;
  }
  return null;
}

function phoneticRule(a, b) {
  if (!a || !b || a === b) return null;
  return soundex(a) === soundex(b) ? PHONETIC.id : null;
}

// Strip a known patronymic suffix from a surname to expose its base.
function surnameBase(token) {
  for (const suf of PATRONYMIC.suffixes) {
    if (token.length > suf.length + 2 && token.endsWith(suf)) return token.slice(0, token.length - suf.length);
  }
  return token;
}

// Remove leading/standalone patronymic particles from a forename token list.
function dropParticles(forenames) {
  const kept = (forenames || []).filter((t) => !PATRONYMIC.particles.has(t));
  return { tokens: kept.length ? kept : (forenames || []), dropped: kept.length !== (forenames || []).length };
}

module.exports = {
  RULE_TABLE_VERSION, TRANSLITERATION, PATRONYMIC, PHONETIC,
  soundex, transliterationRule, phoneticRule, surnameBase, dropParticles,
};
