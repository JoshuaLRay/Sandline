# Mobile spectator and commander controls

**Status:** Approved interaction requirements (2026-09-28). This document specifies the touch interface; implementation and validation belong to the client change.

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
