import { customerCompanyKey } from "./customerOwnershipChartSession";

export const CUSTOMER_OWNERSHIP_CHART_PREVIEW_KEY = "ubo-demo.customer-ownership-chart-preview.v1";
const PREVIEW_VERSION = "ubo-demo-customer-ownership-chart-preview-v1";

function safeParse(raw) {
  try { return JSON.parse(raw); } catch (_) { return null; }
}

export function writeCustomerOwnershipChartPreview({ context, result, file, contentBase64 }, storage = window.sessionStorage) {
  if (!context?.demoCaseId || !result?.artifact?.artifactId || !file?.type || !contentBase64) throw new TypeError("An active chart upload is required for preview.");
  const preview = {
    contractVersion: PREVIEW_VERSION,
    demoCaseId: context.demoCaseId,
    companyKey: customerCompanyKey(context.company),
    artifactId: result.artifact.artifactId,
    originalFilename: file.name,
    mediaType: file.type,
    contentBase64,
  };
  storage.setItem(CUSTOMER_OWNERSHIP_CHART_PREVIEW_KEY, JSON.stringify(preview));
  return preview;
}

export function customerOwnershipChartPreviewFor({ context, result }, storage = window.sessionStorage) {
  const preview = safeParse(storage.getItem(CUSTOMER_OWNERSHIP_CHART_PREVIEW_KEY));
  if (preview?.contractVersion !== PREVIEW_VERSION) return null;
  if (preview.demoCaseId !== context?.demoCaseId || preview.companyKey !== customerCompanyKey(context?.company)) return null;
  if (preview.artifactId !== result?.artifact?.artifactId) return null;
  return preview;
}

export function clearCustomerOwnershipChartPreview(storage = window.sessionStorage) {
  storage.removeItem(CUSTOMER_OWNERSHIP_CHART_PREVIEW_KEY);
}
