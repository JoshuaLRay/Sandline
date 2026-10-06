import type { MoveConfig } from './CharacterController.ts';

export const DEFAULT_MOVE_CONFIG: MoveConfig = {
  walkSpeed: 4.2,
  sprintSpeed: 6.8,
  crouchSpeed: 1.9,
  gravity: -19.6,
  jumpSpeed: 6.0,
  groundY: 0,
  maxFallSpeed: -55,
  radius: 0.35,
  height: 1.8,
  crouchHeight: 1.2,
  // Matches DEFAULT_HITBOX's prone capsule (server/net/lagComp.ts): 2 * (0.05 + 0.35).
  proneHeight: 0.8,
  proneSpeed: 1.1,
  stepHeight: 0.45,
  vaultMaxHeight: 1.25,
  vaultDistance: 1.5,
  vaultSeconds: 0.55,
  vaultProbe: 0.35,
  vaultLip: 0.15,
};
