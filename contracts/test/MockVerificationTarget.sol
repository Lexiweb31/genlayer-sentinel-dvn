// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract MockVerificationTarget { bytes32 public last; function verify(bytes32 value) external { last = value; } function fail() external pure { revert("fail"); } }
