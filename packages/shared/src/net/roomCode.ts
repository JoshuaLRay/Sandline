/**
 * Room codes (T-1.5.04).
 *
 * A code is what one person reads aloud to another over voice chat, so the
 * alphabet drops every pair that sounds or looks alike: no I/1/L, no O/0/Q,
 * no S/5, no B/8, no Z/2. Twenty-four symbols at four places is 331,776
 * codes, which is plenty for a host that holds a handful of rooms at once and
 * far too few to be worth guessing at when the prize is a seat in a playtest.
 *
 * Normalisation is forgiving about the things a person does while typing —
 * lower case, a space or hyphen in the middle — and strict about the alphabet,
 * so a code that cannot exist is refused with a clear answer rather than
 * quietly turned into one nobody created.
 */
export const ROOM_CODE_ALPHABET = 'ACDEFGHJKMNPRTUVWXY34679';
export const ROOM_CODE_LENGTH = 4;

/** Upper-case and strip the separators people put in the middle. */
export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s_-]+/g, '');
}

/** True for a string `generateRoomCode` could have produced. */
export function isRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/**
 * A fresh code from a unit-interval source.
 *
 * The source is injected rather than `Math.random` for the usual reason: the
 * registry's tests want a code they can predict, and `shared` bans
 * non-deterministic Math anyway (T-0.03). Uniqueness is the caller's job — the
 * registry retries on collision.
 */
export function generateRoomCode(unit: () => number): string {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    const index = Math.min(
      ROOM_CODE_ALPHABET.length - 1,
      Math.floor(Math.max(0, unit()) * ROOM_CODE_ALPHABET.length),
    );
    out += ROOM_CODE_ALPHABET[index];
  }
  return out;
}
