import {defineConfig} from "hardhat/config";

export default defineConfig({
  networks: {
    sentinelTest: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
      hardfork: "shanghai",
      loggingEnabled: false,
      mining: {auto: true}
    }
  }
});
