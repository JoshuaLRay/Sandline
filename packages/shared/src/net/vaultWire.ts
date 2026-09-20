/**
 * The Vault component's wire fields (T-2.21), encoded on the server and
 * decoded on the client, so the field order is written down once beside the
 * schema and a predictor handed the result continues the vault exactly.
 */
import type { VaultState } from '../sim/CharacterController.ts';
import { POSITION, dequantize, quantize, quantizeAngle } from './quantize.ts';

/** `[active, elapsedMs, yaw, fromX, fromY, fromZ, topY]`; all zero when not vaulting. */
export function vaultToLevels(vault: VaultState | null | undefined): number[] {
  if (!vault) return [0, 0, 0, 0, 0, 0, 0];
  const ms = Math.round(vault.elapsed * 1000);
  return [
    1,
    ms < 0 ? 0 : ms > 1023 ? 1023 : ms,
    quantizeAngle(vault.yaw),
    quantize(vault.fromX, POSITION),
    quantize(vault.fromY, POSITION),
    quantize(vault.fromZ, POSITION),
    quantize(vault.topY, POSITION),
  ];
}

export function vaultFromLevels(levels: readonly number[] | undefined): VaultState | null {
  if (!levels || (levels[0] as number) !== 1) return null;
  return {
    elapsed: (levels[1] as number) / 1000,
    yaw: levels[2] as number,
    fromX: dequantize(levels[3] as number, POSITION),
    fromY: dequantize(levels[4] as number, POSITION),
    fromZ: dequantize(levels[5] as number, POSITION),
    topY: dequantize(levels[6] as number, POSITION),
  };
}
