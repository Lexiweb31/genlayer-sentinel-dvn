# Official LayerZero runtime-code review workflow — 2026-08-13

## Purpose

This workflow records a narrow evidence path for the five LayerZero contracts
used by Sentinel's Ethereum Sepolia → Arbitrum Sepolia candidate. It allows one
runtime identity to be reviewed at a time, but Sentinel remains blocked until
all five identities are reviewed and match an audited observation.

The five required identities are Ethereum Sepolia `EndpointV2`, `SendUln302`,
and Executor, plus Arbitrum Sepolia `EndpointV2` and `ReceiveUln302`.

## Required evidence before a pin

For one entry, the reviewer must retain the raw bytes and SHA-256 digest of:

1. an official LayerZero deployment-address record identifying the exact
   checksummed address, chain ID, and endpoint ID; and
2. an official LayerZero V2 source/release record with a pinned revision.

At one canonical block, the reviewer must read the contract runtime bytes from
both reviewed public RPC operator families, verify equality, compute their
Keccak-256 digest, and record the block number and hash. The review registry
must bind those two evidence digests, the source revision, address, chain ID,
endpoint ID, block, and runtime digest. The two primary-source records are
named for that exact contract; they cannot be shared across a different
contract name merely because it uses the same chain or address-book file.

No value may be copied from an explorer, local compilation, a provider result
alone, or an unpinned branch URL. A source revision is provenance evidence; it
does not by itself prove a byte-for-byte reproduction of a historical deploy.

## Current evidence discovery

The official LayerZero deployment page identifies Ethereum Sepolia EndpointV2
at `0x6EDCE65403992e310A62460808c4b910D972f10f`, SendUln302 at
`0xcc1ae8Cf5D3904Cef3360A9532B477529b177cCE`, and Executor at
`0x718B92b5CB0a5552039B593faF724D182A881eDA`.

The official LayerZero address-book source also includes the Sepolia constants.
Its moving `main` branch is discovery material only; it is not a review record
until a reviewer captures the exact commit URL and raw-byte digest. The same
rule applies to LayerZero V2 source files and to the Arbitrum Sepolia records.

No runtime hash is committed by this document. The checked-in registry remains
empty because a reproducible two-provider capture plus pinned official source
records for an individual contract has not yet been committed.

## Nonclaims and readiness

An individual reviewed pin adds only per-contract drift detection. All five
pins must match before code identity can stop blocking the pathway. Even then,
Sentinel is not deployed: no OApps or adapters exist on the candidate chains,
LayerZero has not onboarded Sentinel as a DVN, no independent five-party signer
set is operating, and live GenLayer finality integration is unproven.

This procedure makes no availability, censorship-resistance, ownership,
mainnet-readiness, or LayerZero approval claim.
