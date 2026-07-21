// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILayerZeroDVN {
    struct AssignJobParam { uint32 dstEid; bytes packetHeader; bytes32 payloadHash; uint64 confirmations; address sender; }
    function assignJob(AssignJobParam calldata, bytes calldata) external payable returns (uint256);
    function getFee(uint32, uint64, address, bytes calldata) external view returns (uint256);
}

/// @notice Prototype adapter. It is not an onboarded LayerZero DVN and must be optional in testnet ULN config.
contract SentinelDVNAdapter is ILayerZeroDVN {
    error Unauthorized(); error InvalidQuorum(); error Replay(); error Expired(); error InvalidSignatureOrder();
    event JobAssigned(bytes32 indexed jobId, uint32 indexed dstEid, bytes32 payloadHash, uint64 confirmations, address sender);
    event Verified(bytes32 indexed guid, bytes32 indexed packetDigest, bytes32 evidenceDigest);
    address public immutable messageLib; uint256 public immutable quorum; mapping(address=>bool) public signer; mapping(bytes32=>bool) public used;
    constructor(address lib, address[] memory signers, uint256 q) { if(lib==address(0)||q==0||q>signers.length) revert InvalidQuorum(); messageLib=lib; quorum=q; for(uint i;i<signers.length;i++) signer[signers[i]]=true; }
    function getFee(uint32,uint64,address,bytes calldata) external pure returns(uint256){ return 0; }
    function assignJob(AssignJobParam calldata p, bytes calldata) external payable returns(uint256){ if(msg.sender!=messageLib) revert Unauthorized(); bytes32 id=keccak256(abi.encode(p.dstEid,p.packetHeader,p.payloadHash,p.confirmations,p.sender)); emit JobAssigned(id,p.dstEid,p.payloadHash,p.confirmations,p.sender); return 0; }
    function submit(bytes32 guid,bytes32 packetDigest,bytes32 evidenceDigest,uint64 expiry,bytes[] calldata signatures) external {
        if(block.timestamp>expiry) revert Expired(); bytes32 d=keccak256(abi.encode(block.chainid,address(this),guid,packetDigest,evidenceDigest,expiry)); if(used[d]) revert Replay();
        address previous; uint count; for(uint i;i<signatures.length;i++){ address recovered=_recover(d,signatures[i]); if(recovered<=previous) revert InvalidSignatureOrder(); previous=recovered; if(signer[recovered]) count++; }
        if(count<quorum) revert InvalidQuorum(); used[d]=true; emit Verified(guid,packetDigest,evidenceDigest);
    }
    function _recover(bytes32 d,bytes calldata sig) private pure returns(address){ if(sig.length!=65)return address(0); bytes32 r;bytes32 s;uint8 v;assembly{r:=calldataload(sig.offset)s:=calldataload(add(sig.offset,32))v:=byte(0,calldataload(add(sig.offset,64)))} return ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32",d)),v,r,s); }
}
