# GenLayer Receipt Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a keyless, fail-closed reader for documented GenLayer finalized transaction receipts without treating raw GenVM call data as signer authorization.

**Architecture:** `JsonRpcGenLayerReceiptReader` makes two documented JSON-RPC calls through an injected fetch capability: `gen_getTransactionStatus`, then `gen_getTransactionReceipt`. It returns a canonical receipt only after finality and bindings validate. It does not implement the decoded signer-witness interface.

**Tech Stack:** Node.js 22, TypeScript 5.8, built-in `node:test`, Fetch API.

## Global Constraints

- Accept only credential-free HTTPS endpoints, reject redirects, and enforce positive bounded timeouts.
- Make only documented read RPC calls; submit no wallet, secret, or transaction.
- Require `FINALIZED` / `7` before reading a receipt.
- Return fixed public errors without endpoint, call-data, or provider-response leakage.
- Keep the live GenLayer finality readiness gate false.

---

### Task 1: Test and implement the finalized receipt reader

**Files:**
- Create: `services/coordinator/test/genlayer-receipt-reader.test.js`
- Create: `services/coordinator/src/genlayer-receipt-reader.ts`

**Interfaces:**
- Produces `GenLayerFinalizedReceipt = { transactionId: Hex; recipient: Hex; statusCode: 7; rawCallData: Hex; executionResult: number }`.
- Produces `JsonRpcGenLayerReceiptReader.getFinalizedReceipt(transactionId: Hex, expectedRecipient: Hex): Promise<GenLayerFinalizedReceipt>`.

- [ ] **Step 1:** Write a failing happy-path test asserting the result fields and exact method order `gen_getTransactionStatus`, `gen_getTransactionReceipt`.
- [ ] **Step 2:** Run `npm run build && node --test services/coordinator/test/genlayer-receipt-reader.test.js` and observe the missing-module failure.
- [ ] **Step 3:** Implement the reader. It calls the existing status reader, refuses any state other than `FINALIZED`/7, then performs a bounded no-redirect receipt request.
- [ ] **Step 4:** Run the focused test and verify it passes.

### Task 2: Make response parsing fail closed

**Files:**
- Modify: `services/coordinator/test/genlayer-receipt-reader.test.js`
- Modify: `services/coordinator/src/genlayer-receipt-reader.ts`

**Interfaces:**
- Refuses non-final status without fetching a receipt.
- Refuses mismatched RPC IDs, transaction IDs, recipients, status, malformed hex, RPC errors, HTTP errors, and transport errors.

- [ ] **Step 1:** Add failing rejection tests, including a provider response containing `secret` and a non-final status with exactly one fetch.
- [ ] **Step 2:** Run the focused test and observe the malformed-response failure.
- [ ] **Step 3:** Add strict validation with only the fixed errors `GenLayer receipt transport failed`, `GenLayer receipt HTTP failure`, `GenLayer receipt RPC failure`, `GenLayer receipt is not finalized`, and `invalid GenLayer receipt response`.
- [ ] **Step 4:** Run `npm run build && node --test services/coordinator/test/genlayer-receipt-reader.test.js services/coordinator/test/genlayer-status-reader.test.js`.

### Task 3: Record the unresolved signer boundary

**Files:**
- Modify: `README.md`
- Modify: `docs/UNKNOWNS.md`
- Modify: `docs/MILESTONES.md`
- Create: `docs/research/2026-08-11-genlayer-receipt-transport-audit.md`

- [ ] **Step 1:** Call the reader an “official-RPC receipt transport adapter” and document the two methods and fields.
- [ ] **Step 2:** State that raw `txCallData` requires a reviewed decoder before it can satisfy `GenLayerSignerWitnessReader`.
- [ ] **Step 3:** Verify the readiness gate is still false and run build plus the receipt, status, and signer-finality tests.
- [ ] **Step 4:** Commit only the verified code, tests, and documents.
