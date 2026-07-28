import os
from pathlib import Path

import pytest
from gltest.direct import sdk_loader

from conftest import (
    ACTION,
    EVIDENCE,
    EVIDENCE_DIGEST,
    EVIDENCE_URI,
    GUID,
    PACKET_DIGEST,
    POLICY,
)


CONTRACT = "intelligent-contract/sentinel_policy.py"


def deploy(direct_vm, direct_deploy, coordinator):
    direct_vm.sender = coordinator
    return direct_deploy(CONTRACT, coordinator, "treasury-v1")


def record_field(record, name):
    if isinstance(record, dict):
        return record[name]
    return getattr(record, name)


def test_uses_repository_local_sdk_cache():
    configured = Path(os.environ["GENLAYER_SENTINEL_GENVM_CACHE"]).resolve()
    assert sdk_loader.CACHE_DIR.resolve() == configured
    assert "genlayer-sentinel-dvn" in configured.parts


def test_deployment_and_empty_views(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    assert contract.get_record(GUID) == ""
    assert record_field(contract.get_record_details(GUID), "status") == ""


def test_rejects_zero_coordinator(direct_vm, direct_deploy):
    with direct_vm.expect_revert("invalid coordinator"):
        direct_deploy(CONTRACT, bytes(20), "treasury-v1")


@pytest.mark.parametrize("version", ["", "bad|version", "x" * 65])
def test_rejects_invalid_policy_version(
    direct_vm, direct_deploy, direct_alice, version
):
    with direct_vm.expect_revert("invalid policy version"):
        direct_deploy(CONTRACT, direct_alice, version)


def test_rejects_unauthorized_coordinator(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("unauthorized coordinator"):
            contract.evaluate(
                GUID,
                PACKET_DIGEST,
                EVIDENCE_URI,
                EVIDENCE_DIGEST,
                ACTION,
                POLICY,
            )
    assert contract.get_record(GUID) == ""


def test_rejects_invalid_deterministic_inputs(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    invalid = [
        (
            "0x01",
            PACKET_DIGEST,
            EVIDENCE_URI,
            EVIDENCE_DIGEST,
            ACTION,
            POLICY,
            "invalid GUID",
        ),
        (
            GUID,
            "0x01",
            EVIDENCE_URI,
            EVIDENCE_DIGEST,
            ACTION,
            POLICY,
            "invalid packet digest",
        ),
        (
            GUID,
            PACKET_DIGEST,
            "http://governance.example/7",
            EVIDENCE_DIGEST,
            ACTION,
            POLICY,
            "invalid evidence URI",
        ),
        (
            GUID,
            PACKET_DIGEST,
            "https://user:pass@governance.example/7",
            EVIDENCE_DIGEST,
            ACTION,
            POLICY,
            "invalid evidence URI",
        ),
        (
            GUID,
            PACKET_DIGEST,
            EVIDENCE_URI,
            "0x01",
            ACTION,
            POLICY,
            "invalid evidence digest",
        ),
        (
            GUID,
            PACKET_DIGEST,
            EVIDENCE_URI,
            EVIDENCE_DIGEST,
            "",
            POLICY,
            "invalid decoded action",
        ),
        (
            GUID,
            PACKET_DIGEST,
            EVIDENCE_URI,
            EVIDENCE_DIGEST,
            ACTION,
            "",
            "invalid policy",
        ),
    ]
    for *args, message in invalid:
        with direct_vm.expect_revert(message):
            contract.evaluate(*args)


def test_enforces_utf8_byte_limits(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    with direct_vm.expect_revert("invalid decoded action"):
        contract.evaluate(
            GUID,
            PACKET_DIGEST,
            EVIDENCE_URI,
            EVIDENCE_DIGEST,
            "é" * 4097,
            POLICY,
        )
    with direct_vm.expect_revert("invalid policy"):
        contract.evaluate(
            GUID,
            PACKET_DIGEST,
            EVIDENCE_URI,
            EVIDENCE_DIGEST,
            ACTION,
            "é" * 4097,
        )
    with direct_vm.expect_revert("invalid evidence URI"):
        contract.evaluate(
            GUID,
            PACKET_DIGEST,
            "https://governance.example/" + ("é" * 1012),
            EVIDENCE_DIGEST,
            ACTION,
            POLICY,
        )


def test_accepts_exact_action_and_policy_byte_limits(
    direct_vm, direct_deploy, direct_alice
):
    direct_vm.mock_web(
        r"governance\.example/proposal/7",
        {"status": 200, "body": EVIDENCE},
    )
    direct_vm.mock_llm(r".*", "DENY boundary fixture")
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    action_guid = "0x" + ("22" * 32)
    policy_guid = "0x" + ("33" * 32)
    contract.evaluate(
        action_guid,
        PACKET_DIGEST,
        EVIDENCE_URI,
        EVIDENCE_DIGEST,
        "a" * 8192,
        POLICY,
    )
    contract.evaluate(
        policy_guid,
        PACKET_DIGEST,
        EVIDENCE_URI,
        EVIDENCE_DIGEST,
        ACTION,
        "p" * 8192,
    )
    assert contract.get_record(action_guid).startswith("v1|DENY|")
    assert contract.get_record(policy_guid).startswith("v1|DENY|")


def test_rejects_duplicate_guid_without_overwrite(
    direct_vm, direct_deploy, direct_alice
):
    direct_vm.mock_web(
        r"governance\.example/proposal/7",
        {"status": 200, "body": EVIDENCE},
    )
    direct_vm.mock_llm(r".*", "ALLOW proposal 7")
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    contract.evaluate(
        GUID,
        PACKET_DIGEST,
        EVIDENCE_URI,
        EVIDENCE_DIGEST,
        ACTION,
        POLICY,
    )
    first = contract.get_record(GUID)
    with direct_vm.expect_revert("GUID already recorded"):
        contract.evaluate(
            GUID,
            PACKET_DIGEST,
            EVIDENCE_URI,
            EVIDENCE_DIGEST,
            "different",
            POLICY,
        )
    assert contract.get_record(GUID) == first
