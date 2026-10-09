# Mobile spectator and commander controls

**Status:** Approved scope (2026-09-28), interaction upgrade requested 2026-10-03 (U-102). This document specifies the touch interface; implementation and validation belong to the client change.

## Scope

A phone or tablet participant watches squad members and commands eligible bots. Mobile does not expose manual soldier movement, weapon aim or firing. Watching a human remains observation only. Existing server rules for who may command each bot and what orders are valid still apply.

## Screen layout

- Remove the large opaque spectator/command box that covers the play area. A small unobtrusive overview may explain: “Watch the squad, choose who receives an order, choose the order, then double tap the scene to place it. Drag to pan the camera.” Keep it dismissible or otherwise out of the scene’s way.
- Keep two translucent, clearly labeled primary controls near the bottom corners, clear of device safe areas: **Who** on the left and **Order** on the right. The scene and current spectated soldier remain visible.
- Tapping **Who** opens a modern, easy to tap menu of valid recipients, including “All commanded bots” and individual eligible bots. Show the current selection on the closed control. A menu choice closes or settles the menu without issuing an order.
- Tapping **Order** opens an equally touch friendly menu of available orders. Show the selected order on the closed control. A menu choice alone does not issue an order.
- Preserve a discoverable way to switch the soldier being watched, change valid bot commander assignments, and leave the session. These secondary actions must not force the full screen box to remain open.

## Scene gestures

- A one finger drag across the scene pans the spectator camera. Starting on an interactive menu or button must operate that control instead.
- A double tap on an unobstructed scene location submits the currently selected order for the selected recipient at the pointed location. Use the scene location, not the screen center or the last drag location. Do not send an order on a single tap, a drag, or a double tap on controls.
- Give a clear, brief acknowledgement or failure message. If a selected recipient or order becomes invalid, refresh the choice and prevent an accidental command to a different target.

## Acceptance checks

1. At phone portrait and landscape sizes, the large panel no longer blocks the scene; the two corner controls remain reachable within safe areas.
2. Both menus can be opened, navigated and closed by touch; their labels and current selections are understandable without hover.
3. Dragging pans the camera without issuing an order. Double tapping a scene point sends one location based order to the chosen recipient; tapping a control does not.
4. Watching another soldier, commander assignment and leaving remain available. Mobile never gains manual walking, aiming or firing controls.


## U-102 interaction update (2026-10-03)

The owner requested fewer taps and a modern camera/control feel. This supersedes
menu-first placement requirements above while preserving spectator/commander scope.

- A visible squad strip watches a soldier with one tap; eligible bots also become
  the recipient. All selects all commanded bots. Watching a human does not grant
  command permission or silently change the order recipient.
- Five visible order buttons allow dragging onto the scene and releasing to send.
  Tapping an order arms one scene tap instead; Cancel order clears it. Existing
  double tap placement remains available. Selection alone never sends an order.
- Dragging or pinching the scene cancels armed placement. Control drops, pointer
  cancellation, focus loss, hidden UI and roster changes clear placement.
- The camera orbits the watched soldier's chest; pinch controls distance within
  U-038 limits, and Recenter restores heading and elevation. Scenery shortens the
  camera arm. Crosshairs remain hidden on mobile.
- Squad menu retains assignments, independent recipient selection and leaving.
  A brief message reports local submission or invalid placement; it does not
  claim authoritative execution. Owner real-device feel review remains pending.

## U-145 commander resupply decision (2026-10-08)

The owner approved commander resupply within the existing spectator/commander
scope. A mobile participant selects one eligible bot they command and one
compatible supply type, then orders that bot to collect it from a cache while
staying in commander view. The host validates bot authority and cache use and
owns stock, progress and transfers. Watching a human grants no resupply authority;
manual walking, aiming and firing remain excluded by ADR-002.

Implementation, safe interruption and physical-phone acceptance belong to
[U-145](../backlog/U-145.md), split into U-146–U-148 after the owner accepted
[U-134](../backlog/U-134.md)'s desktop/physical-phone UI/play review.

U-148 adds a **Supplies** control beside the camera controls. Its scrollable panel
chooses exactly one commanded bot, cache and item; it displays the recipient's
confirmed capacity, host stock and host collection progress. Closing the panel,
changing its recipient/cache, using another command control, losing focus or
entering a menu cancels collection. Opening Supplies disarms order placement.
Without an eligible recipient, stock remains observable. A request without host
confirmation is cancelled after five seconds; accepted travel has no local clock.
The new physical-phone presentation/play acceptance remains open in U-148;
earlier delivered-UI approvals do not cover this interaction.
