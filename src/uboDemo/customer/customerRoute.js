export const CUSTOMER_DEMO_START_PATH = "/ubo-demo/customer/";
export const CUSTOMER_OWNERSHIP_CHART_PATH = "/ubo-demo/customer/ownership-chart";
export const CUSTOMER_QUESTIONS_PATH = "/ubo-demo/customer/questions";

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
