import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDemoCapability,
  publicDemoCapability
} from "../../../dist/services/coordinator/src/demo-capability.js";

const valid = {
  mode: "LOCAL_WALLET_DEMO",
  chainId: "31337",
  chainName: "Sentinel Local",
  rpcUrl: "http://127.0.0.1:8545/",
  sourceOApp: "0x1111111111111111111111111111111111111111",
  sourceEndpoint: "0x2222222222222222222222222222222222222222",
  destinationEid: 40231,
  authorizedTarget: "0x3333333333333333333333333333333333333333",
  actionSelector: "0xb5c645bd",
  actionSignature: "record(bytes32)",
  approvedRecordLabel: "approved",
  approvedArgument: "0x2b29265fc125740ae6bbc5035ae7af720b6932f4a3e44ba5ac02955c21ca9a05",
  approvedAuthorizationId: "0x5555555555555555555555555555555555555555555555555555555555555555",
  options: "0x",
  payInLzToken: false,
  semanticSource: "LOCAL_POLICY_FIXTURE"
};

test("parses and publishes only a canonical local wallet capability", () => {
  const parsed = parseDemoCapability(valid);
  assert.equal(parsed.chainId, 31337n);
  assert.equal(parsed.sourceOApp, valid.sourceOApp);
  assert.equal(parsed.approvedRecordLabel, "approved");
  assert.deepEqual(publicDemoCapability(parsed), valid);
});

test("rejects capabilities that weaken the local or fixed-action boundary", () => {
  const invalid = [
    {...valid, rpcUrl: "https://rpc.example/"},
    {...valid, rpcUrl: "http://user:secret@127.0.0.1:8545/"},
    {...valid, rpcUrl: "http://127.0.0.1:8545/?secret=value"},
    {...valid, chainId: "1"},
    {...valid, actionSelector: "0xdeadbeef"},
    {...valid, actionSignature: "transfer(address,uint256)"},
    {...valid, approvedRecordLabel: "changed"},
    {...valid, approvedRecordLabel: "control\ncharacter"},
    {...valid, approvedRecordLabel: "x".repeat(81)},
    {...valid, approvedArgument: "0x" + "0".repeat(64)},
    {...valid, options: "0x01"},
    {...valid, payInLzToken: true},
    {...valid, semanticSource: "GENLAYER_LIVE"},
    {...valid, privateKey: "0xsecret"}
  ];
  for (const value of invalid) {
    assert.throws(() => parseDemoCapability(value));
  }
});
