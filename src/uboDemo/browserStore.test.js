import fs from "fs";
import path from "path";
import { forgetLegacyBrowserCopies, uboStore } from "./browserStore";

// UBO-22 / invariant 5: people's names never go into the browser's storage.

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(js|jsx)$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name) ? [full] : [];
  });
}

test("no UBO screen writes to the browser's storage", () => {
  const offenders = sourceFiles(__dirname)
    .filter((file) => !file.endsWith("browserStore.js"))
    .filter((file) => /\b(localStorage|sessionStorage|indexedDB)\b/.test(fs.readFileSync(file, "utf8")));
  expect(offenders.map((file) => path.relative(__dirname, file))).toEqual([]);
});

test("the working copy lives in memory and behaves like Storage", () => {
  uboStore.clear();
  uboStore.setItem("a", { toString: () => "1" });
  expect(uboStore.getItem("a")).toBe("1");
  expect(uboStore.length).toBe(1);
  expect(uboStore.key(0)).toBe("a");
  uboStore.removeItem("a");
  expect(uboStore.getItem("a")).toBeNull();
});

test("what earlier versions saved in the browser is removed, and nothing else", () => {
  window.localStorage.setItem("ubo-demo.case.v1", JSON.stringify({ people: ["Alice Morgan"] }));
  window.localStorage.setItem("ubo-control-demo.cross-source-party-resolution.v1", "[]");
  window.sessionStorage.setItem("ubo-demo.customer-ownership-chart-preview.v1", "{}");
  window.localStorage.setItem("kyc-something-else", "kept");
  forgetLegacyBrowserCopies();
  expect(window.localStorage.getItem("ubo-demo.case.v1")).toBeNull();
  expect(window.localStorage.getItem("ubo-control-demo.cross-source-party-resolution.v1")).toBeNull();
  expect(window.sessionStorage.getItem("ubo-demo.customer-ownership-chart-preview.v1")).toBeNull();
  expect(window.localStorage.getItem("kyc-something-else")).toBe("kept");
});
