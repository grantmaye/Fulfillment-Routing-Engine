import {
  DESTINATIONS,
  PRODUCTS,
  WAREHOUSES,
  type DestinationId,
  type LineItem,
  type WarehouseId,
} from './model';

export interface ShippingProvider {
  quote(
    warehouseId: WarehouseId,
    destinationId: DestinationId,
    items: LineItem[],
  ): Promise<{
    costCents: number;
    transitDays: number;
    distanceMiles: number;
  }>;
}
export function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (n: number) => (n * Math.PI) / 180;
  const a =
    Math.sin(radians(lat2 - lat1) / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lon2 - lon1) / 2) ** 2;
  return Math.round(3959 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Deliberately synthetic: distance and weight make decisions reproducible offline.
// This is not a carrier tariff, delivery promise, or road-distance calculation.
export class SimulatedShippingProvider implements ShippingProvider {
  constructor(private readonly unavailable: WarehouseId[] = []) {}
  async quote(warehouseId: WarehouseId, destinationId: DestinationId, items: LineItem[]) {
    if (this.unavailable.includes(warehouseId))
      throw new Error('Simulated shipping provider unavailable');
    const warehouse = WAREHOUSES.find((w) => w.id === warehouseId)!;
    const destination = DESTINATIONS[destinationId];
    const miles = distanceMiles(warehouse.lat, warehouse.lon, destination.lat, destination.lon);
    const weight = items.reduce(
      (total, item) => total + PRODUCTS.find((p) => p.sku === item.sku)!.weightLb * item.quantity,
      0,
    );
    return {
      costCents: Math.round(650 + miles * 0.72 + weight * 85),
      transitDays: Math.min(6, Math.max(1, Math.ceil(miles / 650))),
      distanceMiles: miles,
    };
  }
}
