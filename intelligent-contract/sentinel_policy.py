# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

class SentinelPolicy(gl.Contract):
    records: TreeMap[str, str]
    coordinator: str
    policy_version: str

    def __init__(self, coordinator: str, policy_version: str):
        self.coordinator = coordinator
        self.policy_version = policy_version

    @gl.public.write
    def evaluate(self, guid: str, packet_digest: str, evidence_uri: str, evidence_digest: str, decoded_action: str, policy: str):
        if str(gl.message.sender_address).lower() != self.coordinator.lower():
            raise gl.vm.UserError("unauthorized coordinator")
        if self.records.get(guid, "") != "":
            raise gl.vm.UserError("GUID already recorded")
        prompt = "Return ALLOW or DENY and a short reason. Determine whether ACTION exactly matches an unexpired governance authorization in EVIDENCE and complies with POLICY. Fail closed on ambiguity. ACTION=" + decoded_action + " POLICY=" + policy
        def leader():
            evidence = gl.nondet.web.render(evidence_uri, mode="text")
            answer = gl.nondet.exec_prompt(prompt + " EVIDENCE=" + evidence)
            return answer
        answer = gl.eq_principle.prompt_comparative(leader)
        decision = "ALLOW" if answer.strip().upper().startswith("ALLOW") else "DENY"
        # Canonical bindings are stored with the consensus result; off-chain signers wait for chain finality.
        self.records[guid] = decision + "|" + packet_digest + "|" + evidence_digest + "|" + self.policy_version + "|" + answer

    @gl.public.view
    def get_record(self, guid: str) -> str:
        return self.records.get(guid, "")
