# Implementation Plans — Index

This directory contains four phased implementation plans for the Staff Performance Analysis platform.

**Spec:** [`../specs/2026-04-19-staff-performance-platform-design.md`](../specs/2026-04-19-staff-performance-platform-design.md)

| Phase | Window | Plan | Status |
|---|---|---|---|
| 1 | 2026-04 → 2026-06 | [Foundation](./2026-04-19-phase-1-foundation.md) | Ready to execute |
| 2 | 2026-07 → 2026-09 | [PMS + Workflow](./2026-04-19-phase-2-pms-workflow.md) | Roadmap — expand before executing |
| 3 | 2026-10 → 2026-11 | [AI + Dashboards](./2026-04-19-phase-3-ai-dashboards.md) | Roadmap — expand before executing |
| 4 | 2026-12 → 2027-01 | [Hardening + Cutover](./2026-04-19-phase-4-hardening-cutover.md) | Roadmap — expand before executing |

## How to use these documents

**Phase 1** is written at full TDD fidelity — every test, every implementation, every command, every commit. It is directly executable via `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

**Phases 2–4** are concrete roadmaps: complete task lists, exact file paths, goals, acceptance criteria, and design notes. They are **not** directly executable. Before starting each phase, re-open that plan through the `superpowers:writing-plans` skill to expand tasks into bite-sized TDD steps. By then the prior phase's codebase exists and the expansion can reference real files and types.

## Dependency order

```
Phase 1  ────▶  Phase 2  ────▶  Phase 3  ────▶  Phase 4
```

Do not start Phase 2 until Phase 1's exit checklist is green. The foundations in each phase (audit, RBAC, state machine, forms library) are load-bearing for what follows.

## Scope-creep protection

Each phase has an exit criteria list at the top of its document. Any new feature request that shows up mid-phase must:

1. Displace something already planned (not add to the window).
2. Be written into the plan document as a tracked task.
3. Never compromise audit, RBAC, or compliance tasks — those are non-negotiable.

## When the plan drifts from reality

Reality always drifts from plans. When that happens:

- Small local adjustment (file name, minor refactor): make it, mark the task done, keep moving.
- Shape change (a service now needs a background job it didn't plan for): update the plan document in the same commit as the code, so the plan stays truthful.
- Big divergence (an assumption turned out wrong): stop, re-open through brainstorming skill, revise the spec, then re-do the affected plan tasks.

A plan that silently diverges from the codebase is worse than no plan.
