"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else files.push(target);
  }
}
walk(root);

const secretPatterns = [
  ["Stripe live key", new RegExp("sk_" + "live_[A-Za-z0-9]{12,}")],
  ["AWS access key", new RegExp("AK" + "IA[0-9A-Z]{16}")],
  ["private key", new RegExp("-----BEGIN " + "(?:RSA |EC )?PRIVATE KEY-----")],
  ["JWT bearer token", new RegExp("eyJ[A-Za-z0-9_-]{20,}\\.eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}")],
];
const failures = [];
for (const file of files.filter((item) => /\.(?:js|json|md|sql|example)$/.test(item) && item !== __filename)) {
  const fileText = fs.readFileSync(file, "utf8");
  for (const [name, pattern] of secretPatterns) if (pattern.test(fileText)) failures.push(`${name}: ${path.relative(root, file)}`);
  if (file.includes(`${path.sep}fixtures${path.sep}`) && /data:image|document_image|selfie_image|biometric_template|facial_vector/i.test(fileText)) {
    failures.push(`raw identity evidence marker: ${path.relative(root, file)}`);
  }
}
if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else process.stdout.write(`IDV security scan passed (${files.length} files)\n`);
