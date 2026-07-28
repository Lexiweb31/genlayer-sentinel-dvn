import hashlib
import os
from pathlib import Path

import pytest
from gltest.direct import sdk_loader


_CACHE_ENV = "GENLAYER_SENTINEL_GENVM_CACHE"
if _CACHE_ENV not in os.environ:
    raise RuntimeError("GenLayer direct cache is not configured; use npm run test:ic:direct")
sdk_loader.CACHE_DIR = Path(os.environ[_CACHE_ENV]).resolve()


GUID = "0x" + "11" * 32
PACKET_DIGEST = "0x" + "44" * 32
EVIDENCE = "Proposal 7 authorizes transfer 1 token until 2030-01-01T00:00:00Z."
EVIDENCE_DIGEST = "0x" + hashlib.sha256(EVIDENCE.encode("utf-8")).hexdigest()
EVIDENCE_URI = "https://governance.example/proposal/7"
ACTION = "transfer 1 token"
POLICY = "Require an exact, unexpired governance authorization."


@pytest.fixture(autouse=True)
def strict_direct_vm(direct_vm):
    direct_vm.strict_mocks = True
    direct_vm.check_pickling = True
    direct_vm.warp("2026-07-28T12:00:00+00:00")
    yield
