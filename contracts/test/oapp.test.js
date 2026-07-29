import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {ContractFactory, Interface, id, zeroPadValue} from "ethers";
import {startLocalEvm} from "./local-evm.js";

const artifact = name => JSON.parse(fs.readFileSync(`dist/contracts/${name}.json`, "utf8"));

async function deploy(name, signer, ...args) {
  const value = artifact(name);
  const contract = await new ContractFactory(value.abi, value.evm.bytecode.object, signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function fixture(t) {
  const {signers: s, close} = await startLocalEvm(8);
  t.after(close);
  const epA = await deploy("MockEndpointV2", s[0], 40161);
  const epB = await deploy("MockEndpointV2", s[1], 40231);
  await (await epA.setOptionalDvn(await s[5].getAddress())).wait();
  await (await epB.setOptionalDvn(await s[5].getAddress())).wait();
  const a = await deploy("TreasuryPolicyOApp", s[2], await epA.getAddress(), await s[2].getAddress());
  const b = await deploy("TreasuryPolicyOApp", s[3], await epB.getAddress(), await s[3].getAddress());
  const target = await deploy("ActionTarget", s[4]);
  const peerA = zeroPadValue(await a.getAddress(), 32);
  const peerB = zeroPadValue(await b.getAddress(), 32);
  await (await a.connect(s[2]).setPeer(40231, peerB)).wait();
  await (await b.connect(s[3]).setPeer(40161, peerA)).wait();
  await (await a.connect(s[2]).setAuthorizedTarget(await target.getAddress(), true)).wait();
  await (await b.connect(s[3]).setAuthorizedTarget(await target.getAddress(), true)).wait();
  return {a, b, epA, epB, target, s, peerA, peerB};
}

test("quotes, sends, decodes PacketSent, and executes through the trusted peer", async t => {
  const {a, b, epA, epB, target, s, peerA} = await fixture(t);
  const data = new Interface(["function record(bytes32)"]).encodeFunctionData("record", [id("approved")]);
  const action = {authorizationId: id("auth"), target: await target.getAddress(), value: 0, data};
  const quoted = await a.quoteAction(40231, action, "0x", false);
  const fee = {nativeFee: quoted.nativeFee, lzTokenFee: quoted.lzTokenFee};
  assert.equal(fee.nativeFee, 1000000000000n);
  const tx = await a.connect(s[2]).sendAction(40231, action, "0x", fee, {value: fee.nativeFee});
  const receipt = await tx.wait();
  const sent = receipt.logs
    .map(log => { try { return epA.interface.parseLog(log); } catch { return null; } })
    .find(log => log?.name === "PacketSent");
  assert.ok(sent);
  const feeEvent = receipt.logs
    .map(log => { try { return epA.interface.parseLog(log); } catch { return null; } })
    .find(log => log?.name === "DVNFeePaid");
  assert.ok(feeEvent);
  assert.deepEqual([...feeEvent.args.requiredDVNs], []);
  assert.deepEqual(
    [...feeEvent.args.optionalDVNs].map(value => value.toLowerCase()),
    [(await s[5].getAddress()).toLowerCase()]
  );
  assert.deepEqual([...feeEvent.args.fees], [1000000000000n]);
  const actionEvent = receipt.logs
    .map(log => { try { return a.interface.parseLog(log); } catch { return null; } })
    .find(log => log?.name === "ActionSent");
  const guid = actionEvent.args.guid;
  const message = a.interface.getAbiCoder().encode(
    ["tuple(bytes32 authorizationId,address target,uint256 value,bytes data)"],
    [action]
  );
  await (await epB.deliver(
    await b.getAddress(),
    {srcEid: 40161, sender: peerA, nonce: 1},
    guid,
    message
  )).wait();
  assert.equal(await target.recorded(), id("approved"));
  assert.equal(await target.calls(), 1n);
  await assert.rejects(async () => {
    const replay = await epB.deliver(
      await b.getAddress(),
      {srcEid: 40161, sender: peerA, nonce: 1},
      guid,
      message
    );
    await replay.wait();
  });
});

test("rejects untrusted peers and unauthorized targets", async t => {
  const {b, epB, target, s, peerA} = await fixture(t);
  const action = {
    authorizationId: id("auth2"),
    target: await target.getAddress(),
    value: 0,
    data: new Interface(["function record(bytes32)"]).encodeFunctionData("record", [id("x")])
  };
  const message = b.interface.getAbiCoder().encode(
    ["tuple(bytes32 authorizationId,address target,uint256 value,bytes data)"],
    [action]
  );
  await assert.rejects(epB.deliver(
    await b.getAddress(),
    {srcEid: 40161, sender: id("attacker"), nonce: 1},
    id("g"),
    message
  ));
  await (await b.connect(s[3]).setAuthorizedTarget(await target.getAddress(), false)).wait();
  await assert.rejects(epB.deliver(
    await b.getAddress(),
    {srcEid: 40161, sender: peerA, nonce: 1},
    id("g2"),
    message
  ));
});

test("rejects nonzero native-value actions before emitting a packet", async t => {
  const {a, epA, target, s, peerB} = await fixture(t);
  const action = {
    authorizationId: id("native-value"),
    target: await target.getAddress(),
    value: 1,
    data: new Interface(["function record(bytes32)"]).encodeFunctionData(
      "record",
      [id("must-not-send")],
    ),
  };
  await assert.rejects(a.quoteAction(40231, action, "0x", false));
  const beforeNonce = await epA.outboundNonce(await a.getAddress(), 40231, peerB);
  await assert.rejects(async () => {
    const transaction = await a.connect(s[2]).sendAction(
      40231,
      action,
      "0x",
      {nativeFee: 0, lzTokenFee: 0},
    );
    await transaction.wait();
  });
  assert.equal(
    await epA.outboundNonce(await a.getAddress(), 40231, peerB),
    beforeNonce,
  );
});
