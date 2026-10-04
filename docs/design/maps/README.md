# Map design records

Use the [map and mission creation standard](../MAP-MISSION-CREATION.md) and copy
[TEMPLATE.md](TEMPLATE.md) for every new campaign map before level authoring.
A mission brief links its map record; a map record links every mission using it.
Use the registered world ID as the filename to avoid confusing mission numbers
with the legacy `mission-01` world.

| World / missions | Record | Scope |
|---|---|---|
| `qalat-road` / campaign mission 1 | [The Qalat Road](qalat-road.md) | Existing map; distinct-lane rework specified, geometry implementation pending |
| Campaign missions 2–10 | Create one record per map from the template when each mission is designed | Not yet designed; the shared standard applies to all |

`mission-01` is the preserved clear-and-hold QA slice, `greybox-01` its layout
fixture, `range` a QA range, and `kit-gallery` a kit inspection world. They are not
forthcoming campaign maps and are outside this redesign. Do not retrofit their
fixtures as a side effect of the Qalat rework. If one becomes a campaign map,
create its map record and apply the standard first.
