# Architecture Decision Records (ADR)

This directory contains the Architecture Decision Records (ADRs) for this
project.

## What is an ADR?

An ADR (Architecture Decision Record) documents a single significant
architectural decision: the context, the decision that was made, and its
consequences. ADRs make decisions traceable and version-controlled, instead
of leaving them only in commit history or memory. The format follows the
proposal by Michael Nygard
([Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)).

## Naming convention

Each ADR is its own Markdown file following this naming scheme:

```
NNNN-kebab-case-title.md
```

- `NNNN` is a 4-digit, sequentially incrementing number (e.g. `0001`,
  `0002`, ...).
- `kebab-case-title` is a short, descriptive title in lowercase with
  hyphens.

Example: `0002-use-zod-for-validation.md`

## Creating a new ADR

To create a new ADR, copy [`template.md`](./template.md), name it with the
next available number, and fill it in.
