/**
 * The trigger, while a grenade or a rocket is in hand.
 *
 * The pouch items are equipped like the guns (5 and 6) and used with the same
 * button, each the way its kind is used in every shooter the player arrives
 * from:
 *
 * - a THROWN item is aimed while the trigger is held — the arc is drawn — and
 *   leaves the hand when it is let go;
 * - a ROCKET goes on the press, like a semi-automatic, and its arc is drawn
 *   while aiming down the sight instead.
 *
 * G keeps working as a quick throw of the selected pouch item whatever is in
 * hand: hold to aim, release to throw (T-2.32).
 *
 * Only a press made WHILE the item is in hand can throw it. Switching to the
 * grenade with the trigger already down (mid-burst on the carbine, say) must
 * not throw one on the release that ends that burst.
 *
 * No THREE and no DOM: the numbers are tested in Node, and main.ts feeds it
 * one sample per tick.
 */
import type { ProjectileDef } from '@sandline/shared';

export interface PouchTriggerSample {
  /** A pouch item is in hand (rather than a gun). */
  holding: boolean;
  /** The kind of the pouch item selected, in hand or not. */
  kind: ProjectileDef['kind'];
  /** The trigger went down since the last tick. */
  triggerEdge: boolean;
  /** The trigger is down now. */
  triggerHeld: boolean;
  /** The trigger came up since the last tick. */
  triggerReleased: boolean;
  /** Aiming down the sight. */
  ads: boolean;
  /** The quick-throw key is down now. */
  throwHeld: boolean;
  /** The quick-throw key came up since the last tick. */
  throwReleased: boolean;
}

export interface PouchTriggerResult {
  /** Draw the arc: the player is aiming this item. */
  aiming: boolean;
  /** Launch one this tick. */
  launch: boolean;
}

export class PouchTrigger {
  /** The trigger went down with the item in hand and has not come up since. */
  private armed = false;
  private last: PouchTriggerResult = { aiming: false, launch: false };

  /** The last tick's answer, for the frame loop to draw the arc from. */
  get aiming(): boolean {
    return this.last.aiming;
  }

  update(s: PouchTriggerSample): PouchTriggerResult {
    let aiming = s.throwHeld;
    let launch = s.throwReleased;
    if (!s.holding) {
      this.armed = false;
    } else if (s.kind === 'rocket') {
      this.armed = false;
      aiming ||= s.ads;
      launch ||= s.triggerEdge;
    } else {
      // A press and its release can land in the same tick (a quick click):
      // the edge arms it, and the release that follows in the same sample
      // throws it.
      if (s.triggerEdge) this.armed = true;
      if (this.armed && s.triggerHeld) aiming = true;
      if (this.armed && s.triggerReleased) {
        launch = true;
        this.armed = false;
      } else if (!s.triggerHeld) {
        // Up with no release seen: the pointer was freed or the window lost
        // focus mid-aim. A throw interrupted like that is cancelled.
        this.armed = false;
      }
    }
    this.last = { aiming, launch };
    return this.last;
  }

  /** Drop a throw in progress: the item left the hand another way, or the window lost focus. */
  cancel(): void {
    this.armed = false;
    this.last = { aiming: false, launch: false };
  }
}
