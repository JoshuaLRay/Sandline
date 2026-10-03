export const SPREAD_KINDS = ['tight', 'standard', 'wide'] as const;
export type SquadSpread = (typeof SPREAD_KINDS)[number];
