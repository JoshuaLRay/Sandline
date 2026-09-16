# ADR-010: Vite + pnpm workspaces

- **Status:** Accepted
- **Date:** 2026-09-16
- **Plan reference:** §2, §3

## Context

Five packages — `shared`, `client`, `server`, `bot`, `tools` — with `shared`
consumed by all four, and `shared` needing to build for both browser and Node
(ADR-003).

## Decision

pnpm workspaces for the monorepo, Vite for the client build and dev server,
TypeScript project references for inter-package types. A single root `pnpm verify`
runs typecheck, lint, and test — the command every task must leave passing.

## Consequences

- `workspace:` protocol means `shared` is consumed from source, so a change is
  immediately visible to all consumers without a publish step.
- Vite's dev server must be configured with COOP/COEP headers from the start
  (T-0.06). Multithreaded WASM needs `crossOriginIsolated`, and retrofitting
  those headers after the fact is disruptive.
- `pnpm verify` as a single gate is what makes task acceptance criteria checkable
  by an agent without knowing the project layout.

## Alternatives rejected

- **npm or yarn workspaces.** Rejected on pnpm's stricter dependency isolation,
  which prevents a package from importing something it does not declare — a class
  of bug that is especially nasty when `shared` must stay platform-free.
- **Nx or Turborepo.** Rejected as premature at five packages. Revisit if build
  times become a problem.
- **Separate repositories.** Rejected: `shared` changing in lockstep with its
  consumers is the entire point of the architecture.
