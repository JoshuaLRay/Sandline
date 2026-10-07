import { parseSupplyCaches, type SupplyInventory } from '@sandline/shared';

/** Representative stock from the five planned caches, on a flat isolated fixture; not production placement. */
export const SUPPLY_FIXTURES = parseSupplyCaches([
  { id: 'P-SOUTH', feet: { x: 0, y: 0, z: 0 }, stock: { projectiles: { rocket: 6 }, primaryMagazines: 6, healthKits: 2 } },
  { id: 'P-ROAD', feet: { x: 4, y: 0, z: 0 }, stock: { primaryMagazines: 3, healthKits: 1 } },
  { id: 'P-RIDGE', feet: { x: 8, y: 0, z: 0 }, stock: { primaryMagazines: 3, healthKits: 1 } },
  { id: 'P-BASEMENT', feet: { x: 12, y: 0, z: 0 }, stock: { projectiles: { rocket: 6 }, primaryMagazines: 3, healthKits: 1 } },
  { id: 'P-OUTPOST', feet: { x: 16, y: 0, z: 0 }, stock: { projectiles: { rocket: 12 }, primaryMagazines: 6, healthKits: 3 } },
]);
export const SUPPLY_FIXTURE_INVENTORY: SupplyInventory = {
  primary: 'carbine', secondary: null, heldWeapon: 'carbine', ammo: 15, equipment: 1, pouch: [0, 0, 0, 0, 0, 0], kits: 0,
};
