# Known bugs

Running list of reported gameplay bugs that aren't yet tracked as `PLAN.md`
tasks. Not a task queue — see `TASKS.md` for that. When a bug here gets
scoped into a task, note the task ID in its row and leave the row (don't
delete) until the task is DONE.

Status: **OPEN** (not investigated/fixed) · **IN PROGRESS** · **FIXED**

---

| # | Area | Report | Status | Task |
|---|---|---|---|---|
| B-01 | Weapons/tracers | Strafing while firing makes some bullet tracers render perpendicular to the fire direction instead of along it. | FIXED | — |
| B-02 | Weapons/effects | Running forward or backward while firing in FPS view causes visual strobing. First "fix" (PR #44, recoil kept out of the gait's facing) targeted the hidden body and was reverted; the real cause was the muzzle flash being placed from the tick's muzzle while the camera renders from the interpolated one, straddling the near plane — see CHANGELOG. | FIXED | — |
| B-03 | Grenades | Grenades are too floaty and travel too far; arc/drag needs tuning. | FIXED | — |
| B-04 | Weapons | Rocket launcher cannot be equipped or fired. | FIXED | — |
| B-05 | Downed state | Downed players should lie on their back clutching their abdomen (one shoulder off the ground), be unable to crawl, be forced into TPS view, and have no movement while downed. Currently crawling is possible and this needs to be removed. | FIXED | — |
| B-06 | Input | Holding Ctrl to crouch, then pressing another key, fires a browser shortcut (find, bookmark, print, etc.) instead of reaching the game — only Space was preventDefault'd. preventDefault now covers every key while the mouse is captured, but Ctrl+W (crouch-walk forward) is one of the browser's *reserved* combos that no amount of preventDefault can stop, so crouch was also moved off Ctrl entirely: it's now a toggle on C. Clicking into the canvas now also requests fullscreen and arms the Keyboard Lock API (Chromium only), which *does* reclaim those reserved combos while fullscreen — the HUD's "mouse captured" line says "shortcuts locked out" when it's engaged. See PLAN.md §8 R13. | FIXED | — |

---

## Report template

```
| B-XX | <area> | <what's wrong, and expected behavior if not obvious> | OPEN | — |
```
