import type { Dashboard, Decision, Order } from './model';
export const decisionFields = `evaluatedAt selectedWarehouseId complete reason savingsCents policyVersion
  candidates { warehouseId eligible costCents transitDays distanceMiles reason stock { sku requested available } }`;
export const orderFields = `id customer destinationId items { sku quantity } status warehouseId scenario createdAt decision { ${decisionFields} }`;
export const dashboardQuery = `query Workspace { dashboard { storageMode orders { ${orderFields} } inventory { warehouseId sku onHand reserved available } events { id orderId action detail createdAt } } }`;
export async function graphql<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch('/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const result = await response.json();
  if (!response.ok || result.errors)
    throw new Error(result.errors?.[0]?.message || result.error || 'Request failed.');
  return result.data as T;
}
export const loadDashboard = () => graphql<{ dashboard: Dashboard }>(dashboardQuery);
export const previewOrder = (id: string) =>
  graphql<{ evaluateOrder: Decision }>(
    `query Evaluate($id: ID!) { evaluateOrder(id: $id) { ${decisionFields} } }`,
    { id },
  );
export const routeOrder = (id: string) =>
  graphql<{ routeOrder: Order }>('mutation Route($id: ID!) { routeOrder(id: $id) { id status } }', {
    id,
  });
