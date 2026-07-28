# GenLayer direct-mode conformance audit — 2026-07-28

## Scope and conclusion

This audit records the local, reproducible evidence for executing `intelligent-contract/sentinel_policy.py` with GenLayer's official direct-mode testing package and GenVM linter. It closes the earlier question of whether the contract can be linted and executed in the pinned direct runner. It does **not** prove Studio or Bradbury compatibility, live web-render stability, independent-validator consensus, model diversity, live GenLayer transaction finality, account-provider safety, or deployment readiness.

The tested contract stores a structured immutable record keyed by LayerZero GUID, binds that record to the packet digest, evidence URI and digest, decoded action, policy, and policy version, and exposes a versioned compatibility view. The coordinator independently recomputes the same request binding before accepting a finalized record. The contract status is `DECIDED`; only the existing off-chain `FINALIZED`/`7`/successful-execution/`latest-final` gate can authorize signing.

## Primary sources reviewed

- [GenLayer testing suite](https://docs.genlayer.com/api-references/genlayer-test) — direct mode is intended for fast unit/CI execution with controlled mocks; Studio covers fuller network and multi-validator behavior.
- [Direct-mode API](https://docs.genlayer.com/api-references/genlayer-test/direct) — direct deployment, strict mocks, web/LLM mocks, validator re-execution, time warping, and pickling checks.
- [Intelligent Contract tooling setup](https://docs.genlayer.com/developers/intelligent-contracts/tooling-setup) — Python 3.12+, `genvm-lint check`, direct tests, and the separate Studio/integration boundary.
- [Storage](https://docs.genlayer.com/developers/intelligent-contracts/storage) and [dataclass storage](https://docs.genlayer.com/developers/intelligent-contracts/types/dataclasses) — `@allow_storage`, structured dataclasses, and storage containers.
- [Transaction context](https://docs.genlayer.com/developers/intelligent-contracts/features/transaction-context) — caller context and deterministic transaction timestamp.
- [Error handling](https://docs.genlayer.com/developers/intelligent-contracts/features/error-handling) — contract/user error behavior.
- [genlayer-test on PyPI](https://pypi.org/project/genlayer-test/) — `0.29.2`, published 2026-04-20, Python 3.12 or newer, Beta classifier.
- [genvm-linter on PyPI](https://pypi.org/project/genvm-linter/) — `0.11.0`, published 2026-06-04, Beta classifier.
- [cloudpickle on PyPI](https://pypi.org/project/cloudpickle/) — `3.1.2`, published 2025-11-03. It is pinned explicitly because direct-mode pickling checks import it but `genlayer-test==0.29.2` does not declare it.

Versions and dates above were rechecked against the official documentation and package registry on 2026-07-28. Beta classifiers are retained as a release-risk signal, not interpreted as production approval.

## Reproducible environment

Observed in the repository-local `.venv`:

```text
Python 3.12.13
pip 26.1.2
pytest 8.4.2
cloudpickle 3.1.2
genlayer-test 0.29.2
genvm-linter 0.11.0
```

The full installed environment, resolved by the hash-locked `requirements/intelligent-contract-test.lock`, was:

```text
aiohappyeyeballs==2.7.1
aiohttp==3.14.3
aiosignal==1.4.0
annotated-types==0.8.0
attrs==26.1.0
bitarray==3.9.2
certifi==2026.7.22
charset-normalizer==3.4.9
ckzg==2.1.8
click==8.4.2
cloudpickle==3.1.2
colorama==0.4.6
cytoolz==1.1.0
eth_abi==5.2.0
eth-account==0.13.7
eth-hash==0.8.0
eth-keyfile==0.8.1
eth-keys==0.7.0
eth-rlp==2.2.0
eth-typing==6.0.0
eth-utils==6.0.0
frozenlist==1.8.0
genlayer-py==0.16.3
genlayer-test==0.29.2
genvm-linter==0.11.0
hexbytes==1.3.1
idna==3.18
iniconfig==2.3.0
multidict==6.7.1
nodeenv==1.10.0
numpy==2.5.1
packaging==26.2
parsimonious==0.10.0
pip==26.1.2
pluggy==1.6.0
propcache==0.5.2
pycryptodome==3.23.0
pydantic==2.13.4
pydantic_core==2.46.4
Pygments==2.20.0
pyright==1.1.411
pytest==8.4.2
python-dotenv==1.2.2
pyunormalize==17.0.0
PyYAML==6.0.3
regex==2026.7.19
requests==2.34.2
rlp==4.1.0
toolz==1.1.0
types-requests==2.33.0.20260712
typing_extensions==4.16.0
typing-inspection==0.4.2
urllib3==2.7.0
web3==7.16.0
websockets==15.0.1
yarl==1.24.5
```

The contract declares this exact dependency header:

```text
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
```

The runner pins GenVM bundle `v0.2.16`. The setup-time bundle observed SHA-256 was:

```text
4f0b358ec98ec148be9b95cdfb0f0e1a6cbe64da0194fdfac3fffc6f5d1d93e2
```

That value is evidence, not an enforcement claim: the wrapper pins the requested version and confines it to the repository, while the upstream downloader currently controls bundle retrieval. Deployment review must add an authenticated upstream checksum or vendored artifact policy before treating bundle identity as independently verified.

## Setup and commands

Explicit setup is the only network-enabled step:

```bash
npm run setup:ic:direct
```

It creates `.venv`, installs the hash-locked Python graph, downloads GenVM `v0.2.16`, and prepares the SDK runner under:

```text
.cache/genlayer-sentinel/gltest-direct
```

The official linter and direct suite are then invoked through:

```bash
npm run lint:ic
npm run test:ic:direct
```

The effective linter command is:

```text
.venv/bin/python scripts/genlayer-tool.py lint check intelligent-contract/sentinel_policy.py
```

The effective test command is:

```text
.venv/bin/python -m pytest -p no:gltest -W error intelligent-contract/tests -q
```

The Studio pytest plugin is deliberately disabled because this suite is direct mode only. Strict mocks, pickling checks, and deterministic warped time are enabled by the test fixture. Normal lint and test commands refuse to bootstrap or download a missing runner; repeated checks consume only the prepared repository-local `.venv` and `.cache/genlayer-sentinel` paths. The wrapper also passes an allowlisted environment and does not forward wallet, private-key, API-key, RPC, or cloud credentials.

## Tested behavior

The direct suite proves:

- coordinator-only evaluation and constructor validation;
- exact 32-byte GUID, packet-digest, and evidence-digest validation;
- credential-free HTTPS evidence URIs and UTF-8 byte bounds;
- immutable one-record-per-GUID behavior;
- evidence SHA-256 verification before any LLM call;
- JSON framing of action, policy, and evidence as untrusted data;
- fail-closed web, LLM, malformed-output, oversized-output, and ambiguous-output behavior;
- structured audit fields, deterministic timestamp, action and policy digests;
- the distinction between contract `DECIDED` and off-chain `FINALIZED`;
- controlled leader/validator agreement, changed decision, changed authorization, and changed renderer evidence; and
- one exact request-binding vector implemented independently in Python and TypeScript:

```text
0xe8539dc6d81fbd8491d86ca707cccc0d0e3a91629565eda34e7e1b5a85693b42
```

The TypeScript decoder additionally rejects malformed, oversized, mismatched, or differently bound compatibility records before the existing GenLayer finality adapter can return an `ALLOW`.

## Controlled comparator limitation

`genlayer-test==0.29.2` captures and re-executes the validator, but its direct WASI mock does not implement the `ExecPromptTemplate`/`EqComparative` host call used by `prompt_comparative`. The validator-variance tests therefore install a narrowly named, test-only hook that compares the captured leader and validator answers. This proves that the captured validator path accepts identical controlled evidence/authorization and rejects controlled changes. It does **not** execute GenLayer's real NLP equivalence comparator and is not evidence of decentralized semantic consensus.

The production contract retains `gl.eq_principle.prompt_comparative`; no decision-only or deterministic equality shortcut was added to contract code.

## Remaining gates

Before any funded testnet deployment or signer authorization:

1. Run the exact contract in current Studio with multiple validators and record reproducible transaction evidence.
2. Confirm Bradbury deployment and SDK-header compatibility with GenLayer.
3. Exercise the real equivalence comparator with model and validator diversity, including changed authorization with the same `ALLOW` token.
4. Measure live `web.render(..., mode="text")` reproducibility, evidence availability, timeout, and content-digest behavior.
5. Implement and test the approved account-aware submit/read client without repository keys.
6. Confirm the exact transaction-finality consumption path, appeal behavior, `FINALIZED`/`7` interpretation, latency, and reorg/rollback handling.
7. Retain independent LayerZero DVNs and isolated 3-of-5 Sentinel signers; direct mode never produces a DVN signature.
8. Complete live EndpointV2/ULN302 pathway validation, production confirmation settings, monitoring, fuzzing, static analysis, and independent audit.

No deployment, funding, Studio/Bradbury session, cloud resource, GitHub publication, external message, or secret handling occurred during this audit.
