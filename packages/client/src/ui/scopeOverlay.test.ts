/**
 * The marksman's scope (QA: the scope has to be usable): the view narrows to
 * the scope's field, the look slows with it, and once shouldered the rifle
 * is hidden so its tube cannot fill the view — for the scoped weapon only.
 */
import { describe, expect, it } from 'vitest';
import { getWeapon } from '@sandline/shared';
import { ViewModel, type ViewModelState } from '../weapons/viewModel.ts';
import { SCOPE_IN, scopedFov, scopedLookScale } from './scopeOverlay.ts';

const AIMED: ViewModelState = { visible: true, held: 'marksman', ads: true, winding: false, kickBack: 0, kickUp: 0, reload: 0, speed: 0, dt: 0.05, aspect: 16 / 9, scoped: true };

function settle(vm: ViewModel, state: ViewModelState, frames = 60): void {
  for (let i = 0; i < frames; i++) vm.update(state);
}

describe('the scope', () => {
  it('eases the view from the base field to the scope field with the ADS blend', () => {
    const scope = getWeapon('marksman').scopeFovDeg!;
    expect(scope).toBeLessThan(30);
    expect(scopedFov(60, scope, 0)).toBe(60);
    expect(scopedFov(60, scope, 1)).toBe(scope);
    expect(scopedFov(60, scope, 0.5)).toBeCloseTo((60 + scope) / 2, 9);
    expect(scopedFov(60, scope, 2)).toBe(scope);
  });

  it('slows the look by the zoom, never speeds it up', () => {
    expect(scopedLookScale(60, 60)).toBeCloseTo(1, 9);
    const through = scopedLookScale(60, 15);
    expect(through).toBeGreaterThan(0.1);
    expect(through).toBeLessThan(0.3);
    expect(scopedLookScale(60, 90)).toBe(1);
    expect(scopedLookScale(0, 15)).toBe(1);
  });

  it('hides the rifle once it is shouldered, and brings it back when the aim comes off', () => {
    const vm = new ViewModel();
    vm.update({ ...AIMED, ads: false });
    expect(vm.scoped).toBe(false);
    settle(vm, AIMED);
    expect(vm.adsAmount).toBeGreaterThan(SCOPE_IN);
    expect(vm.scoped).toBe(true);
    settle(vm, { ...AIMED, ads: false }, 1);
    expect(vm.scoped).toBe(false);
  });

  it('is not a scope on iron sights, however long they are aimed', () => {
    const vm = new ViewModel();
    settle(vm, { ...AIMED, held: 'carbine', scoped: false });
    expect(vm.adsAmount).toBeGreaterThan(SCOPE_IN);
    expect(vm.scoped).toBe(false);
  });
});
