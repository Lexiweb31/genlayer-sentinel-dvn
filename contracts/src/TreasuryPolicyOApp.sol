// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Endpoint-facing application core; EndpointV2 integration is intentionally deferred to M1 package pinning.
contract TreasuryPolicyOApp {
    error Unauthorized(); error Replay(); error InvalidPeer(); error InvalidAction();
    event ActionSent(bytes32 indexed authorizationId, uint32 indexed dstEid, address target, uint256 value, bytes data);
    event ActionExecuted(bytes32 indexed authorizationId, address target, uint256 value);
    address public immutable endpoint; address public owner; mapping(uint32=>bytes32) public peer; mapping(bytes32=>bool) public executed;
    constructor(address ep,address admin){endpoint=ep;owner=admin;}
    function setPeer(uint32 eid,bytes32 p) external {if(msg.sender!=owner)revert Unauthorized();peer[eid]=p;}
    function encodeAction(bytes32 authorizationId,uint32 dstEid,address target,uint256 value,bytes calldata data) external returns(bytes memory){if(msg.sender!=owner)revert Unauthorized();if(peer[dstEid]==0)revert InvalidPeer();emit ActionSent(authorizationId,dstEid,target,value,data);return abi.encode(authorizationId,target,value,data);}
    function lzReceive(uint32 srcEid,bytes32 sender,bytes32 guid,bytes calldata message) external {if(msg.sender!=endpoint)revert Unauthorized();if(peer[srcEid]!=sender)revert InvalidPeer();if(executed[guid])revert Replay();(bytes32 auth,address target,uint256 value,bytes memory data)=abi.decode(message,(bytes32,address,uint256,bytes));if(target==address(0))revert InvalidAction();executed[guid]=true;(bool ok,)=target.call{value:value}(data);require(ok);emit ActionExecuted(auth,target,value);}
    receive() external payable {}
}
