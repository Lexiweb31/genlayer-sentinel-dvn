# LayerZero Endpoint Code Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the connected browser wallet read EndpointV2 bytecode on both configured testnets without requesting a signature or sending a transaction.

**Architecture:** A portal-bar control uses the existing EIP-1193 provider and network constants. It switches to each configured chain, executes `eth_getCode`, and presents a precise code-presence result with no readiness claim beyond the observed bytecode.

**Tech Stack:** Static HTML, browser JavaScript, Node.js built-in test runner.

## Global Constraints

- Use configured EndpointV2 address `0x6EDCE65403992e310A62460808c4b910D972f10f`.
- Query Ethereum Sepolia (`0xaa36a7`) and Arbitrum Sepolia (`0x66eee`).
- Read only: no signature, no transaction, and no private key access.
- Report code presence rather than protocol identity or deployment readiness.

---

### Task 1: Endpoint code-presence control

**Files:**
- Modify: `apps/dashboard/index.html`
- Modify: `apps/dashboard/src/app.js`
- Modify: `apps/dashboard/src/style.css`
- Test: `apps/dashboard/test/hero-shell.test.js`

**Interfaces:**
- Consumes: `window.ethereum.request`, `ethereumSepoliaChainId`, `arbitrumSepoliaChainId`.
- Produces: `checkLayerZeroEndpointCode()` and live `#layerzero-endpoint-status` text.

- [ ] **Step 1: Write the failing test**

Require an actionable `#layerzero-endpoint-check`, a live `#layerzero-endpoint-status`, `eth_getCode`, the configured address, and no `eth_sendTransaction`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/dashboard/test/hero-shell.test.js`

Expected: FAIL because the endpoint control does not exist.

- [ ] **Step 3: Write minimal implementation**

Add a portal-bar button and status. Implement `readEndpointCode(chainId,label)` using:

```js
await walletProvider.request({method:"wallet_switchEthereumChain",params:[{chainId}]});
const code=await walletProvider.request({method:"eth_getCode",params:[endpointV2Address,"latest"]});
if(typeof code!=="string"||code==="0x")throw new Error("endpoint code missing");
return `${label}: code detected`;
```

Use it sequentially for both testnets and restore the wallet display afterwards.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/dashboard/test/hero-shell.test.js`

Expected: PASS.

- [ ] **Step 5: Run repository verification and publish**

Run: `npm run build:site && npm run check:dashboard && npm run test:site && git diff --check`.

Commit the feature, push `main`, and deploy the verified static site through the existing public Sites project.
