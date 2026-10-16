# On-demand agent reference

Optional troubleshooting and terminology moved out of the auto-loaded entry point.
Canonical policy remains in [AGENTS.md](../AGENTS.md). Open this file only when
one of these topics matters to the selected task.

## Known traps

- HTTPS pages need `wss://`; a blocked `ws://` looks exactly like a dead host.
- A slot keeps its soldier's position between occupants (ADR-001): joining
  possesses a bot's entity. That is design, not a spawn bug. Per-client state
  (camera, HUD, input) must reset on join and on switch.
- Art is code: generators in `packages/tools/src/art`, outputs in
  `packages/client/public/assets`. Edit the generator and regenerate.
- The audio pipeline exists but real voice recordings do not (ADR-017); fixture
  tests passing does not mean voices exist.
- The game is `packages/server/src/session/Session.ts` (~7,000 lines; grep for
  the method, never read it whole). `shared/src/sim/Simulation.ts` is only a
  bootstrap, and `data/regions.json` means hosting regions. See CODEMAP.
- Wire changes bump `PROTOCOL_VERSION` in `packages/shared/src/net/protocol.ts`
  and the tests pinning it (`grep -rn "PROTOCOL_VERSION).toBe" packages`).

## Glossary

**Slot** one of six squad positions (0–5), each bound to one **character**
(Preach, Brennan, Holloway, Ortiz, Marsh, Vance). **Starting loadout** a
character's default equipment, not a class (ADR-024). **Possession** a human taking
a slot's soldier; leaving hands it back to a bot. **Commander** the human a bot
answers to; a player may **switch** into a bot they command. **Fireteams** slots
0–2 (assault) and 3–5 (overwatch). **Escorted character** a non-slot friendly
such as a rescued POW. **World / level / mission** registry entry / geometry /
objectives (`campaignRegistry.ts`). **Director budget** encounter scaling by
human count. **Campaign run / replay run** newest mission vs an already-beaten
one, with separate prisoner pools.
