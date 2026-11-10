# Contract: Capacity Gate

**Feature**: `032-test-suite-tiering` | **Status**: Draft

## Purpose

Decide once per run whether the machine may execute tests in parallel. Low-spec and unknown machines run serially; capable machines may parallelize. The decision is shared by Vitest, Playwright, and the shard scripts.

## Inputs

| Source | Field | Fallback |
|---|---|---|
| OS | `os.availableParallelism()` | `os.cpus().length` |
| OS | `os.totalmem()` | none — unreadable means unknown |
| Linux cgroup v2 | `/sys/fs/cgroup/cpu.max` (`quota period`) | ignore |
| Linux cgroup v2 | `/sys/fs/cgroup/memory.max`, `/sys/fs/cgroup/memory.high` | ignore |
| Linux cgroup v1 | `/sys/fs/cgroup/cpu/cpu.cfs_quota_us`, `.../cpu.cfs_period_us` | ignore |
| Linux cgroup v1 | `/sys/fs/cgroup/memory/memory.limit_in_bytes` | ignore |
| Environment | `MAYON_TEST_PARALLEL=auto\|on\|off` | `auto` |
| Environment | `MAYON_TEST_MAX_WORKERS=<positive integer>` | unset |

The effective CPU count and memory are the **minimum** of the host readings and any readable cgroup limit. This prevents a container that exposes host CPUs but caps memory (or vice versa) from being treated as capable.

## Thresholds

| Mode | Condition |
|---|---|
| `capable` | logical CPUs ≥ 8 **and** usable memory ≥ 8 GiB (8 × 1024³ bytes) **and** no contradictory reading |
| `low-spec` | either threshold is below 8 |
| `unknown` | a required reading cannot be determined reliably |

`unknown` MUST behave exactly like `low-spec` for concurrency.

## Effective concurrency

| Mode | Vitest | Playwright | Shards |
|---|---|---|---|
| `capable` | `fileParallelism: true`, `maxWorkers` = capability-derived (default 4, capped by CPUs) | `fullyParallel: true`, `workers` = capability-derived (default 4) | up to one shard per capable runner; never more than the runner can sustain |
| `low-spec` | `fileParallelism: false`, `maxWorkers: 1` | `fullyParallel: false`, `workers: 1` | one shard at a time |
| `unknown` | same as low-spec | same as low-spec | same as low-spec |

`MAYON_TEST_MAX_WORKERS` caps the effective worker count in every mode. `MAYON_TEST_PARALLEL=off` forces serial. `MAYON_TEST_PARALLEL=on` forces parallel mode only when `MAYON_TEST_MAX_WORKERS` is also set; without an explicit worker count the runner exits 2 with `override 'on' requires MAYON_TEST_MAX_WORKERS`. Forced oversubscription must be deliberate and visible: a forced mode is printed with the reason and does not silently change the default.

## Required output

At run start, both runners MUST print one line:

```text
[test-capacity] mode=capable cpus=8 mem=15.6GiB override=auto workers=4 reason=thresholds-met
```

and for low-spec:

```text
[test-capacity] mode=low-spec cpus=4 mem=7.8GiB override=auto workers=1 reason=memory-below-8GiB
```

## Config integration

Vitest (root config):

```ts
import { readCapacity } from './scripts/test-capacity.mjs';

const cap = readCapacity();
export default defineConfig({
  test: {
    maxWorkers: cap.workers,
    minWorkers: 1,
    fileParallelism: cap.fileParallelism,
    projects: [/* unit, browser */]
  }
});
```

Playwright:

```ts
import { readCapacity } from './scripts/test-capacity.mjs';

const cap = readCapacity();
export default defineConfig({
  fullyParallel: cap.fullyParallel,
  workers: cap.workers,
  // ...
});
```

The browser project may use a lower cap than the Node project (browser instances are heavier). The lower cap must still be `1` on low-spec/unknown.

## Failure modes

- A reading that throws is caught and recorded; the run continues as `unknown`.
- A cgroup value of `max` means unlimited; the host reading applies.
- A value below 1 is treated as unreadable, not as zero capacity.
- The gate never changes which tests are selected.
- The gate never causes a test to be skipped.
- An explicit override that forces parallel mode below the threshold is allowed for diagnostics but MUST be reported and MUST be visible in the CI log.
