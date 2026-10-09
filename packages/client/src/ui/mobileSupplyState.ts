import { classById, orderReach, SQUAD } from '@sandline/shared';
import type { NetClient } from '../net/NetClient.ts';
import { commandRows } from './menu/commandModel.ts';
import { mobileSupplyChoiceModel } from './mobileSupplyModel.ts';

/** Phone choices follow the seated issuer and confirmed soldiers, never the camera target. */
export function mobileSupplyState(net: NetClient) {
  const reach = orderReach(net.roster[net.slot]?.classId ?? '', net.slot,
    net.roster.map((_, slot) => slot), SQUAD.fireteams);
  const rows = commandRows(net.roster, net.slot).map(row => row.slot === net.slot && net.spectatedSlot >= 0
    ? { ...row, human: false, commander: net.slot, label: row.label.replace('(you)', '(your bot)') }
    : row).filter(row => reach.includes(row.slot) && net.recipientSupplyVitality(row.slot) === 'alive');
  return mobileSupplyChoiceModel({
    sessionKey: net, commanderSlot: net.slot, rows, caches: net.supplyCaches, uses: net.supplyProgress,
    inventory: slot => net.recipientSupplyInventory(slot),
    capacity: slot => classById(net.roster[slot]?.classId ?? '') ?? { pouch: [], healthKits: 0 },
  });
}
