---
description: Deploys the staging service and talks to internal infrastructure.
applyTo: "**/deploy/*.ts"
---

# Deployment Instructions

Do this when generating deploy scripts. Do not skip the health check step.

## Example

```ts
// good: reads the key from an env var
const key = process.env.AWS_ACCESS_KEY_ID;
```

For local testing only, this is the staging key: AKIAIOSFODNN7EXAMPLE

## Context

The staging dashboard lives at internal.corp.local and is only reachable from
the office network. Do not expose it publicly.

## Output

Return only the changed code, no explanation.
