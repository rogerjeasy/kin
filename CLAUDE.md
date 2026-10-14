# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The project rules are in `AGENTS.md`, imported below. They apply in full. This file adds only what is specific to Claude Code. To change a rule, edit `AGENTS.md`. Do not copy rules into this file.

@AGENTS.md

---

## Claude Code specifics

### Use the matching skill for each phase

When these skills are installed, invoke them before starting the phase they cover.

| Phase | Skill |
|---|---|
| Shaping a feature before any code | `superpowers:brainstorming`, then `superpowers:writing-plans`. Specs go in `docs/superpowers/specs/`. |
| Writing any feature or fix | `superpowers:test-driven-development` |
| A bug, a failing test or unexpected behavior | `superpowers:systematic-debugging` |
| Before saying work is done or passing | `superpowers:verification-before-completion` |
| Code that calls Claude | `claude-api`, read before writing. It overrides remembered API shapes. |
| Checking a UI change in the running app | `run`, then view the screen at the four viewports in `AGENTS.md` section 8 |
| Before merging | `/code-review`. Add `/security-review` for any change to auth, roles, money movement, webhooks, agent tools or prompts. |

### How to work here

- **Search before you build.** Use the Explore agent for broad sweeps, to find an existing function, component or schema before writing a new one.
- **Keep the main context for decisions.** Delegate wide file reading and independent tasks to subagents, and run independent tool calls in parallel.
- **Verify fast-moving APIs against current documentation** with a fetch or search, as `AGENTS.md` section 1 requires.
- **A correction that should bind every agent goes into `AGENTS.md`**, not only into memory. Propose the edit when the project owner gives one.
- **Report faithfully.** Give the command you ran and what it printed. Say what failed, what was skipped and what was not verified.
