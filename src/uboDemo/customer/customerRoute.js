export const CUSTOMER_OWNERSHIP_CHART_PATH = "/ubo-demo/customer/ownership-chart";

export function isCustomerOwnershipChartPath(pathname) {
  return pathname === CUSTOMER_OWNERSHIP_CHART_PATH
    || pathname === `${CUSTOMER_OWNERSHIP_CHART_PATH}/`;
}
