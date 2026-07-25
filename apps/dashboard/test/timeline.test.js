import test from "node:test";
import assert from "node:assert/strict";
import {deliveryTimelineIndex} from "../src/timeline.js";

test("places delivery failures at the phase where they occurred",()=>{
  assert.equal(deliveryTimelineIndex({state:"SIGNING"}),4);
  assert.equal(deliveryTimelineIndex({state:"READY"}),5);
  assert.equal(deliveryTimelineIndex({state:"SUBMITTED",transactionHash:"0x01"}),6);
  assert.equal(deliveryTimelineIndex({state:"CONFIRMED",transactionHash:"0x01"}),7);
  assert.equal(deliveryTimelineIndex({state:"FAILED",failureCode:"SIGNING_EXPIRED"}),4);
  assert.equal(deliveryTimelineIndex({state:"FAILED",failureCode:"EVENT_MISMATCH",transactionHash:"0x01"}),7);
  assert.equal(deliveryTimelineIndex({state:"FAILED",failureCode:"OTHER_FAILURE"}),6);
  assert.equal(deliveryTimelineIndex({state:"RECOVERY_REQUIRED",failureCode:"SUBMISSION_AMBIGUOUS"}),6);
});
