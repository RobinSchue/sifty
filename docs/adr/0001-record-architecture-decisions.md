# 0001. Record architecture decisions

## Status

Accepted

## Context

We need to record the architectural decisions made on this project so that
current and future contributors understand why the codebase looks the way it
does, without having to reconstruct the reasoning from commit history or
memory.

## Decision

We will use Architecture Decision Records (ADRs), as described by Michael
Nygard in
[Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

Each ADR is a single Markdown file stored under `docs/adr/`, named
`NNNN-kebab-case-title.md`, where `NNNN` is a four-digit, sequentially
incrementing number. New ADRs are created by copying `docs/adr/template.md`.

## Consequences

Decisions and their context become explicit, discoverable, and versioned
alongside the code. Contributors gain a lightweight, low-overhead process for
proposing and reviewing decisions. The record only stays useful if new
significant decisions are captured as ADRs going forward; superseded
decisions should be marked accordingly rather than deleted.
