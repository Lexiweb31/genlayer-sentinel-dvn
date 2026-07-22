import test from "node:test";
import assert from "node:assert/strict";
import {verifyMessage} from "ethers";
import {startLocalEvm} from "./local-evm.js";

test("starts an isolated Shanghai node with funded unlocked signers and idempotent cleanup", async t => {
  const evm = await startLocalEvm(8);
  t.after(evm.close);
  const network = await evm.provider.getNetwork();
  assert.equal(network.chainId, 31337n);
  assert.equal(evm.signers.length, 8);
  const addresses = await Promise.all(evm.signers.map(signer => signer.getAddress()));
  assert.equal(new Set(addresses.map(address => address.toLowerCase())).size, 8);
  assert.ok(await evm.provider.getBalance(addresses[0]) > 0n);
  const signature = await evm.signers[0].signMessage("sentinel-local-evm");
  assert.equal(verifyMessage("sentinel-local-evm", signature).toLowerCase(), addresses[0].toLowerCase());
  await evm.close();
  await evm.close();
});
