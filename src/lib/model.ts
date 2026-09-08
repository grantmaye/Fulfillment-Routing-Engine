export const WAREHOUSES = [
  { id: 'BUF', name: 'Buffalo', state: 'NY', region: 'East coast', lat: 42.8864, lon: -78.8784 },
  { id: 'RNO', name: 'Reno', state: 'NV', region: 'West coast', lat: 39.5296, lon: -119.8138 },
] as const;
export type WarehouseId = (typeof WAREHOUSES)[number]['id'];
export const DESTINATIONS = {
  NYC: { city: 'New York', state: 'NY', zip: '10001', lat: 40.7128, lon: -74.006 },
  SFO: { city: 'San Francisco', state: 'CA', zip: '94103', lat: 37.7749, lon: -122.4194 },
  SEA: { city: 'Seattle', state: 'WA', zip: '98101', lat: 47.6062, lon: -122.3321 },
  CHI: { city: 'Chicago', state: 'IL', zip: '60601', lat: 41.8781, lon: -87.6298 },
  CLT: { city: 'Charlotte', state: 'NC', zip: '28202', lat: 35.2271, lon: -80.8431 },
  DEN: { city: 'Denver', state: 'CO', zip: '80202', lat: 39.7392, lon: -104.9903 },
} as const;
export type DestinationId = keyof typeof DESTINATIONS;
export const PRODUCTS = [
  { sku: 'PH-100', name: 'Desk phone', weightLb: 2.4 },
  { sku: 'HS-200', name: 'Wireless headset', weightLb: 0.8 },
  { sku: 'SW-800', name: '8-port network switch', weightLb: 3.6 },
  { sku: 'GW-400', name: 'Voice gateway', weightLb: 4.2 },
  { sku: 'LAB-001', name: 'Demo adapter · last unit', weightLb: 0.4 },
] as const;
export type LineItem = { sku: string; quantity: number };
export type Inventory = {
  warehouseId: WarehouseId;
  sku: string;
  onHand: number;
  reserved: number;
  available: number;
};
export type Candidate = {
  warehouseId: WarehouseId;
  eligible: boolean;
  costCents: number | null;
  transitDays: number | null;
  distanceMiles: number;
  reason: string;
  stock: { sku: string; requested: number; available: number }[];
};
export type Decision = {
  evaluatedAt: string;
  selectedWarehouseId: WarehouseId | null;
  complete: boolean;
  reason: string;
  candidates: Candidate[];
  savingsCents: number;
  policyVersion: string;
};
export type Order = {
  id: string;
  customer: string;
  destinationId: DestinationId;
  items: LineItem[];
  status: 'PENDING' | 'ALLOCATED' | 'REVIEW' | 'CANCELLED';
  warehouseId: WarehouseId | null;
  decision: Decision | null;
  scenario: 'NORMAL' | 'QUOTE_OUTAGE';
  createdAt: string;
};
export type AuditEvent = {
  id: string;
  orderId: string | null;
  action: string;
  detail: string;
  createdAt: string;
};
export type Dashboard = {
  orders: Order[];
  inventory: Inventory[];
  events: AuditEvent[];
  storageMode: string;
};
