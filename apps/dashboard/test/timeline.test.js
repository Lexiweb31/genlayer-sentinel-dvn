import test from "node:test";
import assert from "node:assert/strict";
import {deliveryTimelineIndex,verificationSummary} from "../src/timeline.js";

test("places delivery failures at the phase where they occurred",()=>{
  assert.equal(deliveryTimelineIndex({state:"SIGNING"}),4);
  assert.equal(deliveryTimelineIndex({state:"READY"}),5);
  assert.equal(deliveryTimelineIndex({state:"SUBMITTED",transactionHash:"0x01"}),6);
  assert.equal(deliveryTimelineIndex({state:"CONFIRMED",transactionHash:"0x01"}),7);
  assert.equal(deliveryTimelineIndex({state:"FAILED",failureCode:"SIGNING_EXPIRED"}),4);
  assert.equal(deliveryTimelineIndex({state:"FAILED",failureCode:"EVENT_MISMATCH",transactionHash:"0x01"}),7);
  assert.equal(deliveryTimelineIndex({state:"FAILED",failureCode:"OTHER_FAILURE"}),6);
  assert.equal(deliveryTimelineIndex({state:"RECOVERY_REQUIRED",failureCode:"SUBMISSION_AMBIGUOUS"}),6);
  assert.equal(deliveryTimelineIndex({state:"CONFIRMED",executionFailureCode:"LOCAL_EXECUTION_RECOVERY_REQUIRED"}),8);
});

test("labels the persisted historical source configuration proof",()=>{
  const shorten=value=>`short(${value})`;
  assert.equal(
    verificationSummary({
      blockHash:"0xblock",
      payloadHash:"0xpayload",
      configurationDigest:"0xconfiguration"
    },shorten),
    "Block short(0xblock) · payload short(0xpayload) · source config short(0xconfiguration)"
  );
});
