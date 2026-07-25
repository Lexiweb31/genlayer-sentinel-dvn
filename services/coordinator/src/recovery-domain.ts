import{AbiCoder,keccak256}from"ethers";
import type{Hex}from"../../../packages/core/src/types.js";
import type{RuntimeConfig}from"./runtime-config.js";

export function recoveryDeploymentDigest(config:RuntimeConfig):Hex{
  const encoded=AbiCoder.defaultAbiCoder().encode(
    ["uint256","uint256","uint32","uint32","address","address","address","address","address","address","address","address"],
    [config.pathway.sourceChainId,config.destination.chainId,config.pathway.srcEid,config.pathway.dstEid,config.pathway.endpoint,config.pathway.sendLibrary,config.pathway.sourceOAppAddress,config.destination.oapp,config.pathway.sentinelDvn,config.destination.adapter,config.destination.receiveLibrary,config.genlayer.policyContract]
  );
  return keccak256(encoded).toLowerCase()as Hex;
}
