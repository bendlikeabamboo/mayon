---
card: 005
name: multi-user-isolation
origin: dealt
bet: Wins if the deployment is actually headed for shared use and what scared you was everyone living in one unsegregated database
played: yes
---

# Card 005 — Multi-user isolation

## Story

You flip the premise: maybe the fear isn't strangers, it's that shared use and shared data don't mix. You add real accounts — email, password, TOTP — and stamp every table with an owner so each person's chats, settings, and history are isolated inside the same Postgres. You can then worry less about who arrives, because "locking it" has become "letting people in safely, each to their own copy".

## Playthrough (2026-08-31)

- **What checked**: launch mayon publicly, gated so only invited people can reach the app and its APIs (why: prod stack has no front door today).
- **How it goes**: accounts (email, password, TOTP) plus an owner column on every table — chats, settings, history partitioned per person; the door can stay open because strangers can only ever reach their own data. The premise flip only pays if the deployment is headed for shared use. For this user's stated goal it re-incurs all of Card 001's auth costs plus a schema-wide ownership migration, buying unwanted capacity.
- **Snags**: everything Card 001 costs (sessions, middleware discipline, self-service resets, TOTP plumbing) plus schema-wide ownership stamping; per-user provisioning of settings; longest time-to-value in the deck.
- **Trade-offs**: maximum flexibility (open launch, shared use, per-person data) at the highest build and maintenance price; capacity that a single-user deployment never uses.
- **Delivers the what?**: fully for the inverted goal ("safely let many in") — but the actual goal is "keep almost everyone out", which this card serves only incidentally.
- **Difficulty vs payoff**: difficulty L · payoff L (for this goal) · time-to-first-value 3–4 weeks (estimates).
- **Your take**: effectively pre-ruled at Card 001 — "not really looking for a multi-user setup"; dead on the user's own ruling.
