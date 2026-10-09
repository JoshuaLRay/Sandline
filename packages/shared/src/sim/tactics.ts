export const SPREAD_KINDS = ['tight', 'standard', 'wide'] as const;
export type SquadSpread = (typeof SPREAD_KINDS)[number];

export const AGGRESSION_KINDS = ['hold-fire', 'defensive', 'aggressive'] as const;
export type SquadAggression = (typeof AGGRESSION_KINDS)[number];

/**
 * U-153: the stance a player holds a bot in. `auto` is the bot's own choice
 * (crouching behind low cover); `crouch` and `prone` are held while it holds,
 * moves and fires, until it must rise to vault, revive, heal or interact.
 */
export const STANCE_KINDS = ['auto', 'crouch', 'prone'] as const;
export type SquadStance = (typeof STANCE_KINDS)[number];
