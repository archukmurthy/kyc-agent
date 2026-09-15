export const CUSTOMER_OWNERSHIP_CHART_PATH = "/ubo-demo/customer/ownership-chart";

export function isCustomerCompanyPath(pathname) {
  return pathname === "/ubo-demo" || pathname === "/ubo-demo/";
}

export function isCustomerOwnershipChartPath(pathname) {
  return pathname === CUSTOMER_OWNERSHIP_CHART_PATH
    || pathname === `${CUSTOMER_OWNERSHIP_CHART_PATH}/`;
}
