from pathlib import Path
import ast

path = Path("intelligent-contract/sentinel_policy.py")
source = path.read_text(encoding="utf-8")
ast.parse(source, filename=str(path))
required = [
    "hashlib.sha256", "gl.nondet.web.render", "gl.nondet.exec_prompt",
    "gl.eq_principle.prompt_comparative", "EVIDENCE_DIGEST_MISMATCH",
    "@gl.public.write", "@gl.public.view",
]
missing = [item for item in required if item not in source]
if missing:
    raise SystemExit("missing required GenLayer safety constructs: " + ", ".join(missing))
print("validated Intelligent Contract syntax and required safety constructs")
