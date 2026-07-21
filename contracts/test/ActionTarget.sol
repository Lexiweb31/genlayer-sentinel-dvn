// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract ActionTarget { bytes32 public recorded; uint256 public calls; function record(bytes32 value) external payable { recorded=value; ++calls; } }
