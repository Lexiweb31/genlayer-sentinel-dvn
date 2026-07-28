from pathlib import Path
import ast

path = Path("intelligent-contract/sentinel_policy.py")
source = path.read_text(encoding="utf-8")
tree = ast.parse(source, filename=str(path))
required = [
    "@allow_storage",
    "class PolicyRecord",
    "SENTINEL_POLICY_REQUEST_V1",
    "gl.nondet.web.render",
    "gl.nondet.exec_prompt",
    "gl.eq_principle.prompt_comparative",
    "EVIDENCE_DIGEST_MISMATCH",
    "datetime.now(timezone.utc)",
    "get_record_details",
    "@gl.public.write",
    "@gl.public.view",
]
missing = [item for item in required if item not in source]
if missing:
    raise SystemExit("missing required GenLayer safety constructs: " + ", ".join(missing))

contract = next(
    (
        node
        for node in tree.body
        if isinstance(node, ast.ClassDef) and node.name == "SentinelPolicy"
    ),
    None,
)
if contract is None:
    raise SystemExit("missing SentinelPolicy contract")

storage = {
    node.target.id: ast.unparse(node.annotation)
    for node in contract.body
    if isinstance(node, ast.AnnAssign)
    and isinstance(node.target, ast.Name)
}
if storage.get("records") != "TreeMap[str, PolicyRecord]":
    raise SystemExit("records must be TreeMap[str, PolicyRecord]")
if storage.get("coordinator") != "Address":
    raise SystemExit("coordinator must be Address")

forbidden = {"os", "requests", "socket", "subprocess"}
imports = set()
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        imports.update(alias.name.split(".", 1)[0] for alias in node.names)
    elif isinstance(node, ast.ImportFrom) and node.module:
        imports.add(node.module.split(".", 1)[0])
disallowed = sorted(imports & forbidden)
if disallowed:
    raise SystemExit("forbidden Intelligent Contract imports: " + ", ".join(disallowed))

print("validated Intelligent Contract syntax and required safety constructs")
