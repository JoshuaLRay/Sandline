import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * ADR-003: `packages/shared` must run headless in Node and in the browser, so it
 * may not import anything platform-specific.
 *
 * ADR-014: ECMAScript does not specify transcendental functions to bit
 * precision, so they drift between a Node (V8) server and a Safari (JSC) or
 * Firefox (SpiderMonkey) client. Banned in shared; use shared/math instead.
 * Math.sqrt and the arithmetic operators ARE exactly specified by IEEE-754 and
 * are deliberately NOT on this list.
 */
const BANNED_MATH = [
  'sin', 'cos', 'tan', 'atan', 'atan2', 'exp', 'log', 'pow', 'hypot', 'random',
].map((property) => ({
  object: 'Math',
  property,
  message:
    `Math.${property} is not cross-engine deterministic (ADR-014). ` +
    `Use the table trig or seeded PRNG in @sandline/shared math/.`,
}));

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'three', message: 'shared must stay platform-free (ADR-003).' },
          { name: 'ws', message: 'shared must stay platform-free (ADR-003).' },
          { name: 'fs', message: 'shared must stay platform-free (ADR-003).' },
        ],
        patterns: [
          { group: ['node:*'], message: 'shared must stay platform-free (ADR-003).' },
        ],
      }],
      'no-restricted-properties': ['error', ...BANNED_MATH],
    },
  },
  {
    /**
     * The one legitimate exception. trig.test.ts validates the lookup table
     * AGAINST Math.sin/cos — checking the table stays within 1e-6 of the real
     * function is the entire point of the test, and it cannot be written
     * without calling the thing it is checking.
     *
     * The table itself is generated in packages/tools (unrestricted, since it
     * is a build step whose output is committed as literals), so shared/src
     * ships zero transcendental calls outside this file.
     */
    files: ['packages/shared/src/math/trig.test.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
);
