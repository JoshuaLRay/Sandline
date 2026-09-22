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
| B-02 | Weapons/animation | Running forward or backward while firing in FPS view causes visual strobing. | FIXED | — |
| B-03 | Grenades | Grenades are too floaty and travel too far; arc/drag needs tuning. | FIXED | — |
| B-04 | Weapons | Rocket launcher cannot be equipped or fired. | OPEN | — |
| B-05 | Downed state | Downed players should lie on their back clutching their abdomen (one shoulder off the ground), be unable to crawl, be forced into TPS view, and have no movement while downed. Currently crawling is possible and this needs to be removed. | OPEN | — |

---

## Report template

```
| B-XX | <area> | <what's wrong, and expected behavior if not obvious> | OPEN | — |
```
