export const SPREAD_KINDS = ['tight', 'standard', 'wide'] as const;
export type SquadSpread = (typeof SPREAD_KINDS)[number];

export const AGGRESSION_KINDS = ['hold-fire', 'defensive', 'aggressive'] as const;
export type SquadAggression = (typeof AGGRESSION_KINDS)[number];
