/**
 * esm-require.js — lets this CommonJS harness require() the app's ESM-syntax
 * source modules.
 *
 * WHY THIS EXISTS. The builders the smoke test must exercise for real —
 * buildChangeEvent, personType, dialogueContent (deriveSource), confirmState
 * (docDedupeKey) — are written with `import`/`export` in `.js` files, inside a
 * package with no `"type": "module"`. Node therefore parses them as CommonJS
 * and a bare require() dies with "Cannot use import statement outside a
 * module"; `import()` resolves them the same way, so it fails identically. Only
 * the CRA/Jest toolchain (babel-jest) can currently load them.
 *
 * The alternative was to hand-copy those builders' logic into the fixture,
 * which would defeat the entire point: a copy cannot catch a drift in the
 * original, and shape drift is exactly the bug class this harness exists to
 * catch (see the source_tier and fieldMetadata failures).
 *
 * HOW. A conditional `require.extensions[".js"]` hook: read the file, and only
 * if it actually contains ESM syntax, transpile it to CJS with @babel/core
 * before compiling. Plain CJS modules (the engine, the DAL, api/ handlers) take
 * the original loader untouched, so nothing about their behaviour changes.
 * Nested imports resolve through the same hook automatically, which is why this
 * is a loader hook and not a one-off transform helper.
 *
 * node_modules is always excluded: dependencies ship their own correct formats
 * and transpiling them would be both slow and wrong.
 *
 * SCOPE: test tooling only. Nothing in api/ or src/ imports this, and it must
 * never become a production code path — the right long-term fix is for those
 * four modules to be authored as CJS like the engine and the DAL already are
 * (see the "requireable by node --test" note in src/reresearch/searchPolicy.js).
 */

const fs = require("node:fs");
const path = require("node:path");

// Cheap pre-filter. Only files that look like ESM pay the babel cost.
const ESM_SYNTAX = /^\s*(?:import\s|export\s|export\{|import\{)/m;

let installed = false;

function installEsmRequire() {
  if (installed) return;
  installed = true;

  // eslint-disable-next-line node/no-deprecated-api -- require.extensions is
  // deprecated but is the only interception point that also covers the nested
  // ESM->ESM imports (confirmState -> personType). Test-only.
  const compileJs = require.extensions[".js"];

  require.extensions[".js"] = function (module_, filename) {
    if (filename.includes("node_modules")) return compileJs(module_, filename);

    const source = fs.readFileSync(filename, "utf8");
    if (!ESM_SYNTAX.test(source)) return compileJs(module_, filename);

    // Required lazily: only an ESM-syntax file ever needs babel, so a run that
    // touches none of them does not pay the load cost.
    const babel = require("@babel/core");
    const { code } = babel.transformSync(source, {
      filename,
      babelrc: false,
      configFile: false,
      sourceMaps: "inline",
      presets: [
        [require.resolve("@babel/preset-env"), { targets: { node: "current" } }],
      ],
    });
    return module_._compile(code, filename);
  };
}

/** Require an app module by repo-relative path, ESM or CJS alike. */
function appRequire(relativePath) {
  installEsmRequire();
  return require(path.resolve(__dirname, "..", "..", relativePath));
}

module.exports = { installEsmRequire, appRequire };
