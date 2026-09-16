export const CUSTOMER_DEMO_START_PATH = "/ubo-demo/customer/";
export const CUSTOMER_OWNERSHIP_CHART_PATH = "/ubo-demo/customer/ownership-chart";

export function isCustomerCompanyPath(pathname) {
  return pathname === "/ubo-demo/customer" || pathname === CUSTOMER_DEMO_START_PATH;
}

export function isCustomerOwnershipChartPath(pathname) {
  return pathname === CUSTOMER_OWNERSHIP_CHART_PATH
    || pathname === `${CUSTOMER_OWNERSHIP_CHART_PATH}/`;
}
