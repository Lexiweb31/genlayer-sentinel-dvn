import {network} from "hardhat";
import {JsonRpcProvider} from "ethers";

export async function startLocalEvm(signerCount = 8) {
  const server = await network.createServer({network: "sentinelTest"}, "127.0.0.1", 0);
  let provider;
  let closing;
  try {
    const {address, port} = await server.listen();
    provider = new JsonRpcProvider(`http://${address}:${port}`, 31337, {staticNetwork: true});
    const actual = await provider.getNetwork();
    if (actual.chainId !== 31337n) throw new Error("local EVM chain ID mismatch");
    const signers = await Promise.all(
      Array.from({length: signerCount}, (_, index) => provider.getSigner(index))
    );
    const close = () => {
      if (!closing) {
        closing = (async () => {
          provider.destroy();
          const closed = server.afterClosed();
          await server.close();
          await closed;
        })();
      }
      return closing;
    };
    return {provider, signers, close};
  } catch (error) {
    provider?.destroy();
    const closed = server.afterClosed();
    await server.close();
    await closed;
    throw error;
  }
}
