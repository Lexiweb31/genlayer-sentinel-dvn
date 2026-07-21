# Contract test status

M0 includes reviewable Solidity sources but no claim that they compile against production LayerZero packages. Foundry/Hardhat integration, EndpointV2 mocks, signature malleability tests, fuzzing, static analysis, and fork tests are M1 blockers. The TypeScript state-machine tests exercise the sign-before-finality and replay-domain invariants today.
