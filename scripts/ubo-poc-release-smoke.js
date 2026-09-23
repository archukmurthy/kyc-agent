"use strict";

const { chromium } = require("playwright");

const BASE_URL = process.env.POC_BASE_URL || "http://localhost:3000";
const TERMINAL = new Set(["COMPLETE", "PARTIAL", "FAILED"]);
const timeoutMs = Number(process.env.POC_SMOKE_TIMEOUT_MS || 240000);

async function post(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok || payload.success === false) {
      throw new Error(`${path} returned ${response.status}: ${payload.message || payload.error || "unknown error"}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function researchCompany() {
  const result = await post("/api/ubo-discovery", {
    entityName: "HIGGS LLP",
    registrationNumber: "OC435996",
    jurisdiction: "GB",
    tenantId: "nium",
    forceRefresh: false,
    jobId: `ubo-poc-smoke-${Date.now()}`,
  });
  if (!TERMINAL.has(result.terminalState) || result.terminalState === "FAILED") {
    throw new Error(`Company research did not produce a usable terminal result (${result.terminalState || "unknown"}).`);
  }
  return result;
}

async function ownershipPdf() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head><style>
      body { font-family: Arial, sans-serif; margin: 64px; color: #102f38; }
      h1 { font-size: 28px; } .box { border: 2px solid #0b7564; padding: 22px; margin: 28px 0; }
      .arrow { text-align: center; font-size: 22px; font-weight: bold; }
      small { display: block; margin-top: 8px; }
    </style></head><body>
      <h1>CURRENT OWNERSHIP CHART</h1><p>Effective date: 23 September 2026</p>
      <div class="box"><strong>ALICE MORGAN</strong><small>Natural person</small></div>
      <div class="arrow">OWNS 40% OF SHARES IN</div>
      <div class="box"><strong>HIGGS LLP</strong><small>Legal entity · UK LLP OC435996</small></div>
      <p>This chart contains one ownership relationship: Alice Morgan owns exactly 40 percentage points of shares in HIGGS LLP.</p>
    </body></html>`);
    return await page.pdf({ format: "A4", printBackground: true });
  } finally {
    await browser.close();
  }
}

async function processToTerminal(job) {
  let current = job;
  const deadline = Date.now() + timeoutMs;
  while (!TERMINAL.has(current.state)) {
    if (Date.now() >= deadline) throw new Error(`Extraction job ${current.jobId} did not reach a terminal state.`);
    if (current.nextAttemptAt) {
      const delay = Math.max(50, new Date(current.nextAttemptAt).getTime() - Date.now() + 25);
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 10000)));
    }
    ({ job: current } = await post("/api/ubo-demo-customer-ownership-chart", {
      operation: "PROCESS_EXTRACTION_JOB",
      jobId: current.jobId,
    }));
  }
  return current;
}

function assertReleaseResult(job) {
  if (job.state !== "COMPLETE") throw new Error(`Evidence extraction ended ${job.state}; COMPLETE is required.`);
  const result = job.result || {};
  const sourceRelationships = result.sourceGraph?.relationships?.length || 0;
  const projectedRelationships = result.sourceGraph?.summary?.totalRelationships || sourceRelationships;
  const questions = result.chartAnalysis?.view?.plan?.summary?.openInformationNeeds
    || result.chartAnalysis?.informationNeeds?.length
    || result.ubo?.issues?.length
    || result.assertions?.filter((item) => item?.issues?.length).length
    || 0;
  const uboAssessments = result.owners?.filter((owner) => owner?.partyType === "NATURAL_PERSON" && owner?.measurement?.type === "EXACT" && Number(owner.measurement.value) >= 25).length || 0;
  if (sourceRelationships < 1 || projectedRelationships < 1) throw new Error("The ownership graph did not render a relationship.");
  if (questions < 1) throw new Error("No ownership questions/information needs were generated.");
  if (result.chartAnalysis?.state !== "EVALUATED" || uboAssessments < 1) throw new Error("The natural-person UBO calculation did not run.");
  return { sourceRelationships, projectedRelationships, questions, uboAssessments };
}

async function main() {
  const research = await researchCompany();
  const bytes = await ownershipPdf();
  const demoCaseId = `poc-release-smoke-higgs-v3`;
  const upload = {
    demoContext: {
      demoCaseId,
      referenceCaseId: "POC-RELEASE-SMOKE",
      company: { legalName: "HIGGS LLP", registrationNumber: "OC435996", countryCode: "GB", countryName: "United Kingdom", ownershipType: "LLP" },
    },
    file: { originalFilename: "higgs-ownership-chart.pdf", declaredMediaType: "application/pdf", sizeBytes: bytes.length, contentBase64: bytes.toString("base64") },
  };
  const started = (await post("/api/ubo-demo-customer-ownership-chart", upload)).job;
  const completed = await processToTerminal(started);
  const counts = assertReleaseResult(completed);

  const reused = (await post("/api/ubo-demo-customer-ownership-chart", upload)).job;
  if (reused.jobId !== completed.jobId || reused.artifactId !== completed.artifactId || reused.state !== "COMPLETE" || reused.attemptCount !== completed.attemptCount) {
    throw new Error("Re-upload did not reuse the validated COMPLETE Artifact and extraction job.");
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    baseUrl: BASE_URL,
    research: { jobId: research.jobId, terminalState: research.terminalState, cache: research.cache?.layer || null, relationships: research.ownershipGraph?.edges?.length || 0 },
    extraction: { jobId: completed.jobId, artifactId: completed.artifactId, correlationId: completed.correlationId, state: completed.state, attemptCount: completed.attemptCount, reused: reused.reused, ...counts },
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`[ubo-poc-release-smoke] ${error.message}`);
  process.exitCode = 1;
});
