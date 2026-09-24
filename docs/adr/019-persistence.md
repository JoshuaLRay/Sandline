# ADR-019: Campaign progress lives on the host

- **Status:** Accepted. **Q5 was decided by the owner on 2026-09-24:
  progress is the host's** (T-4.21). The identity, storage and privacy
  lines below are the agent's defaults, which follow from that choice.
  They are written down so the identity task (T-4.22) can start. The owner
  may overrule any of them before campaign saves (T-4.23) land.
  **Storage changed by the owner, 2026-09-24:** SQLite on a Fly volume,
  replacing Postgres. See the addendum.
- **Date:** 2026-09-24
- **Plan reference:** §7.11 (E-4.6, T-4.21–T-4.24), §9 Q5; ADR-001, ADR-011

## Context

§9 Q5 asked: "Does a campaign save belong to the host, or does every
player carry their own soldier's progression across sessions?" The answer
shapes E-4.6.

- **Per player:** each person's soldier, rank and XP follow them into any
  room. It needs accounts early, a record per person, and rules for what
  happens when a levelled soldier joins a fresh campaign.
- **Per host:** a campaign is one shared thing. Missions done, checkpoints,
  and the squad's soldiers with their ranks and XP all belong to it. Whoever
  plays in it plays those soldiers.

The project's thesis is the six-slot squad (ADR-001): a squad is six slots,
and a bot fills any slot a person does not. A host-owned campaign matches
that directly. The squad is the campaign's, a slot's soldier persists
whether a person or a bot is playing it, and people come and go.

Hosting is regional, session-based and authoritative (ADR-011). One Fly app
runs rooms, and rooms are short-lived process state, not durable. So
"the host" has to mean a durable **campaign** record kept by the hosting
service, not the memory of one room process.

## Decision

1. **A campaign is the unit of progress (owner's choice).**
   - **What it holds:** the missions completed, the current checkpoint
     (T-4.16), and the squad: six soldiers, one per slot, each with a
     class, a rank and XP.
   - **Who creates it:** starting a campaign from the lobby creates it and
     issues it a **campaign code**. It is a longer, durable cousin of the
     four-character room code.
   - **Resuming:** hosting a room with a campaign code restores it into the
     room, at its checkpoint, with its squad.
   - **Who owns it:** the player who created it. Only they may delete it or
     reset it. Anyone with the code may play in it.
2. **Soldiers belong to the campaign, not to people.**
   - **XP (T-4.24):** it goes to the slot's soldier, and only while a person
     is playing that soldier. A bot earns nothing (ADR-001: a bot is nobody's
     soldier).
   - **Ranks:** a person who plays slot 3 advances slot 3's soldier. In
     another campaign they play that campaign's soldiers.
   - **Nothing follows a person between campaigns**, except their identity
     and display name.
3. **Identity is anonymous and durable (default).**
   - **How it is issued:** the host issues a random player ID on the first
     Join, signed by the host, and the client keeps it (T-4.22). It is used
     for campaign ownership, seat history and after-action credit.
   - **Accounts:** none in the slice. If one is ever wanted, for instance
     to move a campaign between devices, it links to this ID. That would be
     an addendum here, not a change.
4. **Storage is one Postgres, next to the host (default).**
   - **Where:** Fly Postgres, in the host's region.
   - **Redis:** only if a need is measured.
   - **Writes:** the server writes at checkpoints and at mission end,
     never per tick. Writes are idempotent, retried on failure and versioned
     from the first save (T-4.23).
   - **Backup:** daily snapshots, kept for 7 days.
   - **Runtime dependency:** the server gains `pg` (node-postgres) under this
     ADR (rule 3). It is the only new one, and it is server-only.
5. **Only what is needed is stored (default).**
   - **Per player:** the player ID, the display name they typed, and when
     they were first and last seen.
   - **Per campaign:** its code, its owner's ID and its state.
   - **Nothing else:** no email, no IP addresses at rest (logs keep IPs no
     longer than the host's log retention), and no chat.
   - **Retention:** a campaign untouched for 180 days is deleted, and a
     player ID with no campaign and no visit for 180 days is deleted.
   - **Deletion on request:** the owner can delete a campaign from the
     lobby.

§9 Q5 is answered.

## Consequences

- **The campaign code is the key.** Losing it means losing access, unless
  the creator's identity finds it: the lobby lists campaigns you own. Anyone
  holding the code can play, which matches how room codes already work.
- **No cross-campaign progression.** A player's standing is per campaign.
  It is simpler and matches the squad thesis. Carrying a soldier between
  campaigns would need a new ADR.
- **XP credits people, but is stored on soldiers.** The after-action screen
  (T-4.28) can say "you earned 120 XP for Rifleman 3". The saved total lives
  on the soldier.
- **One database to run.** It is a real cost and a backup duty on Fly.
  Tearing the host down between playtests (`docs/DEPLOYING.md`) must not
  tear down the database, which T-4.23 documents.
- **Multi-region (E-4.9) must keep a campaign in one region, or move it
  explicitly.** A campaign pins to the region of its database row until
  T-4.30's addendum says otherwise.
- **The plan's wording changes to match.** T-4.23 and T-4.24 now read "per
  campaign", and T-4.24's XP is saved on the campaign's soldier, credited to
  the player.

## Alternatives rejected

- **Per-player progression** (Q5's other answer). The owner chose the host.
  It needs accounts earlier and has no natural home for a bot-filled slot's
  soldier.
- **Keeping progress in the room process.** Rooms are ephemeral (ADR-011).
  A crash or a deploy (T-4.32) would lose the campaign.
- **Saving on the client.** Easy to forge, and the host is authoritative
  everywhere else (ADR-012).
- **A managed third-party database.** Another vendor and account for one
  small table set. Fly Postgres sits beside the host. The owner can swap to
  a managed service without changing the code, because it is still
  Postgres.

## Addendum — 2026-09-24: storage is SQLite on a Fly volume (owner's choice)

The owner looked at the alternatives to decision 4's Postgres default and
chose **SQLite on a Fly volume**. Decisions 1–3 and 5 stand. Decision 4
now reads as follows.

- **Where.** One SQLite database file on a Fly volume mounted into the host
  machine (`fly.toml` gains a `[mounts]` section, T-4.23). There is no
  database server, no second app and no Redis.
- **How it is reached.** Node's built-in `node:sqlite`, so the server gains
  **no new runtime dependency**, and `pg` is not added. `node:sqlite` still
  prints an experimental warning on Node 22. If T-4.23 finds it unfit (a
  missing feature, or a crash under test), **`better-sqlite3` is the
  allowed fallback** under this addendum (rule 3), server-only, and the
  swap is recorded in T-4.23's completion note.
- **Writes are unchanged:** at checkpoints and mission end, never per tick;
  idempotent, retried, and versioned from the first save. The database runs
  in WAL mode, and every save is one transaction, so a crash mid-write
  loses nothing that was acknowledged.
- **Backups.** Fly's daily volume snapshots, with retention set to 7 days.
  Continuous replication (Litestream) is added only if losing up to a day
  is ever judged too much.
- **CI.** Save and restore are tested against a real SQLite file, so the
  Postgres service container T-4.23 planned is not needed.

**What this changes.**
- **One machine holds the data.** A Fly volume attaches to one machine in
  one region. The host already runs one machine (`fly.toml`), so nothing
  changes today. Multi-region (E-4.9) must either keep a campaign in its
  home region's file or replicate (LiteFS), and T-4.30's addendum decides
  which.
- **Teardown must spare the volume.** Stopping the machine between
  playtests is safe, because the volume stays. `fly apps destroy` deletes
  the volume and every campaign with it. `docs/DEPLOYING.md` says so when
  T-4.23 lands.
- **Cheaper, and one fewer thing to run.** The cost is a volume of a few
  gigabytes and its snapshots.

