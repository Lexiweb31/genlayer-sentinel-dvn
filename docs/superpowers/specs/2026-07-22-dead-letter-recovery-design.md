# Durable Ingestion Recovery Design

**Status:** Accepted for the testnet prototype  
**Date:** 2026-07-22

## Problem

The coordinator currently redelivers an unacknowledged packet forever. That protects against loss, but a permanently invalid packet can block every later packet because the durable inbox returns pending work before scanning new blocks. Operators also have no durable failure history or safe recovery operation.

## Decision

Add a separate SQLite-backed recovery ledger beside the listener checkpoint. Each failed ingestion records the full detected packet, an allowlisted error code, attempt count, and first/last failure times. When the configured positive attempt limit is reached, the record becomes `DEAD`; the ingestion runner then acknowledges the listener packet so later packets can progress.

This ordering is deliberately recoverable:

1. Persist or update the recovery record.
2. If it is dead-lettered, acknowledge the listener packet.

A crash between those steps redelivers the packet. Re-recording an already-dead record is idempotent and the next attempt completes the acknowledgement. The system never acknowledges before durable quarantine.

## Operator Recovery

`RecoveryService.requeue(transactionHash)` is an explicit local operator operation, not an unauthenticated HTTP mutation. It reads the quarantined packet, idempotently restores it to the listener pending queue, then removes its recovery record. A crash between restore and removal is safe because listener requeue is transaction-hash idempotent.

The dashboard API remains read-only and exposes only sanitized dead-letter metadata. It does not expose encoded payloads, evidence, raw errors, or a requeue endpoint.

## Interfaces

- `RecoveryStore.recordFailure(pathwayKey, packet, errorCode, now, maximumAttempts)` returns `RETRY` or `DEAD`.
- `RecoveryStore.listDead(pathwayKey)` returns durable sanitized records with the packet retained internally for recovery.
- `RecoveryStore.findDead(pathwayKey, transactionHash)` retrieves one recoverable record.
- `RecoveryStore.resolve(pathwayKey, transactionHash)` removes a record after safe requeue.
- `PacketInbox.requeue(packet)` restores a packet idempotently.
- `IngestionRunner` accepts a failure policy and acknowledges only successful or durably dead-lettered packets.

## Error Classification

The first prototype stores only `INGESTION_FAILED`. Raw exception messages can include provider URLs, upstream content, or operational details and must not be persisted or returned by the API. More granular codes require explicit typed errors and a separate review.

## Configuration

`runtime.maxIngestionAttempts` is a required positive integer. The checked-in example uses `3` and labels it as a test value. Production tuning requires alerting and pathway-specific operational evidence.

## Dashboard

The operational dashboard adds a quarantine section populated from `GET /api/dead-letters`. It shows transaction hash, block number, attempt count, code, and timestamps. It states that requeue is an authenticated local operator action and that the browser cannot mutate state.

## Alternatives Rejected

- **Infinite retry:** preserves at-least-once delivery but permits one poison packet to halt the pathway indefinitely.
- **Retry metadata inside listener JSON:** couples scanning state to operational incident history and makes independent inspection and migration harder.
- **HTTP requeue endpoint:** unsafe without a complete authentication, authorization, audit, and CSRF design.
- **Acknowledging before quarantine:** creates a packet-loss window on crash.

## Limitations

- Retry is tick-based and has no exponential delay in this prototype.
- Requeue is exposed as a programmatic operator service; a hardened CLI is future work.
- SQLite is single-host durability, not replicated production infrastructure.
- Quarantine does not prove that an upstream transient failure is permanent; operators must investigate before requeue.

