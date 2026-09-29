# Spectator command authority and watched soldier status

**Status:** Owner-approved gameplay and interface requirements (2026-09-28). Applies to desktop and mobile spectators.

## Command recipients

- A spectator may issue orders only to bots currently assigned to that spectator as commander. Watching a bot does not transfer command authority; multiple players may watch the same bot at once.
- **All** targets every eligible bot commanded by the issuing player, including the watched bot when that bot is among them. It must never include a bot commanded by another player or a human-controlled soldier.
- Apply the same eligibility rule to the desktop command wheel and mobile **Who** menu, including individual targets and fireteams. The host must check current ownership when an order arrives, because assignments and control can change after a menu opens.
- When a watched bot changes commander or becomes human-controlled, update the available targets immediately. An obsolete choice must fail safely without redirecting an order to a different soldier.

## Watched soldier indicator

Show a clear, persistent status next to the watched character's identity on desktop and mobile:

| Status | Meaning | Spectator options |
|---|---|---|
| **Human-controlled** | A human is playing this soldier. | Watch; no takeover or orders to this soldier. |
| **Bot · commanded by another player** | The soldier is a bot assigned to someone else, even if several people watch it. | Watch; no orders to this bot until legitimately reassigned. Desktop takeover follows the existing spectate input rule and then assigns command to the controlling player. |
| **Bot · under your command** | The soldier is a bot assigned to the local player. | Watch and order this bot individually or through **All**. Desktop takeover remains available. |

Mobile remains spectator/commander only: no manual walking, aiming, firing, or takeover. The indicator describes the watched soldier, while the recipient picker describes which bots the local player can order; these may differ. When command or human control changes, update both without relying on which client saw the change first.

## Acceptance checks

1. Two players can watch the same bot. Only its current commander can select it for orders. A command forged by the other spectator is rejected by the host.
2. For either desktop or mobile, **All** includes the watched bot when it is commanded by the sender. Watching someone else's bot or a human does not extend **All** to that soldier; the sender's other commanded bots remain eligible.
3. The watched status distinguishes human control, another player's command, and the local player's command. It updates after reassignment, takeover, release, or a spectator switch.
4. An old selection cannot order a bot after its command assignment changes. No order is silently retargeted.
