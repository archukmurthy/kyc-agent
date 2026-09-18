export const CUSTOMER_DEMO_START_PATH = "/ubo-demo/customer/";
export const CUSTOMER_OWNERSHIP_CHART_PATH = "/ubo-demo/customer/ownership-chart";
export const CUSTOMER_QUESTIONS_PATH = "/ubo-demo/customer/questions";
export const CUSTOMER_IDV_PATH = "/ubo-demo/customer/idv";
export const CUSTOMER_COMPLETE_PATH = "/ubo-demo/customer/complete";

export function isCustomerCompanyPath(pathname) {
  return pathname === "/ubo-demo/customer" || pathname === CUSTOMER_DEMO_START_PATH;
}

export function isCustomerOwnershipChartPath(pathname) {
  return pathname === CUSTOMER_OWNERSHIP_CHART_PATH
    || pathname === `${CUSTOMER_OWNERSHIP_CHART_PATH}/`;
}

export function isCustomerQuestionsPath(pathname) {
  return pathname === CUSTOMER_QUESTIONS_PATH
    || pathname === `${CUSTOMER_QUESTIONS_PATH}/`;
}

export function isCustomerIdvPath(pathname) {
  return pathname === CUSTOMER_IDV_PATH || pathname === `${CUSTOMER_IDV_PATH}/`;
}

export function isCustomerCompletePath(pathname) {
  return pathname === CUSTOMER_COMPLETE_PATH || pathname === `${CUSTOMER_COMPLETE_PATH}/`;
}
