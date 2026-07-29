import { createHash } from "node:crypto";
import path from "node:path";

const impacts = new Set(["High", "Medium", "Low", "Informational"]);
const confidences = new Set(["High", "Medium", "Low"]);
const detectorKeys = [
  "elements",
  "description",
  "markdown",
  "first_markdown_element",
  "id",
  "check",
  "impact",
  "confidence",
];
const typedElementKeys = ["type", "name", "source_mapping", "type_specific_fields"];
const contractElementKeys = ["type", "name", "source_mapping"];
const annotatedNodeElementKeys = [...typedElementKeys, "additional_fields"];
const mappingKeys = [
  "start",
  "length",
  "filename_relative",
  "filename_absolute",
  "filename_short",
  "is_dependency",
  "lines",
  "starting_column",
  "ending_column",
];
const fingerprintKeys = [
  "detector",
  "impact",
  "confidence",
  "path",
  "elementType",
  "elementName",
  "contractName",
  "functionName",
  "start",
  "length",
  "descriptionSha256",
  "sourceSnippetSha256",
];
const entryKeys = [...fingerprintKeys, "reviewedAt", "rationale"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const expected = new Set(keys);
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label} is missing key: ${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`${label} has unexpected key: ${key}`);
  }
}

function requireString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be a nonempty string`);
  }
  return value;
}

function requireInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer at least ${minimum}`);
  }
  return value;
}

function mappedPath(mapping, root, dependencyMode) {
  const relative = requireString(mapping.filename_relative, "source relative path");
  if (relative.includes("\\") || path.posix.normalize(relative) !== relative) {
    throw new Error("Slither finding is outside contracts/src/");
  }
  const production = relative.startsWith("contracts/src/") && relative.endsWith(".sol");
  const dependency = relative.startsWith("node_modules/") && relative.endsWith(".sol");
  if (!production && !(dependencyMode === "partition" && dependency)) {
    throw new Error("Slither finding is outside contracts/src/");
  }
  const resolvedRoot = path.resolve(root);
  const resolvedRelative = path.resolve(resolvedRoot, relative);
  if (!resolvedRelative.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Slither finding is outside the repository");
  }
  const absolute = path.resolve(requireString(
    mapping.filename_absolute,
    "source absolute path",
  ));
  if (absolute !== resolvedRelative) {
    throw new Error("Slither absolute source path is outside the repository");
  }
  if (typeof mapping.is_dependency !== "boolean") {
    throw new Error("Slither dependency marker must be boolean");
  }
  if (production && mapping.is_dependency !== false) {
    throw new Error("Slither dependency finding is not permitted");
  }
  return { path: relative, dependency };
}

function normalizeElement(raw, root, dependencyMode) {
  if (!isRecord(raw)) throw new Error("element must be an object");
  const type = requireString(raw.type, "element type");
  if (!["contract", "event", "function", "modifier", "node", "variable", "pragma"].includes(type)) {
    throw new Error(`unknown Slither element type: ${type}`);
  }
  if (type === "contract") {
    exactKeys(raw, contractElementKeys, "element");
  } else if (type === "node" && Object.hasOwn(raw, "additional_fields")) {
    exactKeys(raw, annotatedNodeElementKeys, "element");
    exactKeys(raw.additional_fields, ["underlying_type"], "element additional_fields");
    requireString(raw.additional_fields.underlying_type, "element underlying type");
  } else if (type === "variable" && Object.hasOwn(raw, "additional_fields")) {
    exactKeys(raw, annotatedNodeElementKeys, "element");
    exactKeys(raw.additional_fields, ["target", "convention"], "element additional_fields");
    requireString(raw.additional_fields.target, "element variable target");
    requireString(raw.additional_fields.convention, "element variable convention");
  } else {
    exactKeys(raw, typedElementKeys, "element");
  }
  const name = requireString(raw.name, "element name", { allowEmpty: true });
  if (type !== "contract" && !isRecord(raw.type_specific_fields)) {
    throw new Error("element type_specific_fields must be an object");
  }
  const mapping = raw.source_mapping;
  exactKeys(mapping, mappingKeys, "source mapping");
  const mapped = mappedPath(mapping, root, dependencyMode);
  const start = requireInteger(mapping.start, "source start");
  const length = requireInteger(mapping.length, "source length", 1);
  requireString(mapping.filename_short, "source short path");
  if (!Array.isArray(mapping.lines) || mapping.lines.length === 0
    || mapping.lines.some((line) => !Number.isSafeInteger(line) || line < 1)) {
    throw new Error("source lines must contain positive integers");
  }
  requireInteger(mapping.starting_column, "source starting column", 1);
  requireInteger(mapping.ending_column, "source ending column", 1);
  const parent = raw.type_specific_fields?.parent;
  const parentOfParent = parent?.type_specific_fields?.parent;
  let contractName = type === "contract" ? name : "";
  let functionName = ["function", "modifier"].includes(type) ? name : "";
  if (isRecord(parent) && parent.type === "contract" && typeof parent.name === "string") {
    contractName = parent.name;
  }
  if (isRecord(parent) && ["function", "modifier"].includes(parent.type)
    && typeof parent.name === "string") {
    functionName = parent.name;
  }
  if (isRecord(parentOfParent) && parentOfParent.type === "contract"
    && typeof parentOfParent.name === "string") {
    contractName = parentOfParent.name;
  }
  return {
    type,
    name,
    path: mapped.path,
    start,
    length,
    contractName,
    functionName,
    dependency: mapped.dependency,
  };
}

function normalizeDetector(raw, root, dependencyMode) {
  exactKeys(raw, detectorKeys, "detector");
  if (!Array.isArray(raw.elements) || raw.elements.length === 0) {
    throw new Error("detector elements must be a nonempty array");
  }
  requireString(raw.description, "detector description");
  requireString(raw.markdown, "detector markdown", { allowEmpty: true });
  requireString(raw.first_markdown_element, "detector first markdown element", {
    allowEmpty: true,
  });
  requireString(raw.id, "detector id");
  requireString(raw.check, "detector check");
  if (!impacts.has(raw.impact)) throw new Error(`unknown Slither impact: ${raw.impact}`);
  if (!confidences.has(raw.confidence)) {
    throw new Error(`unknown Slither confidence: ${raw.confidence}`);
  }
  const elements = raw.elements
    .map((element) => normalizeElement(element, root, dependencyMode))
    .filter((element) => !element.dependency)
    .map(({ dependency: _dependency, ...element }) => element);
  if (elements.length === 0 && dependencyMode === "partition") return null;
  return {
    check: raw.check,
    impact: raw.impact,
    confidence: raw.confidence,
    description: raw.description,
    elements,
  };
}

export function normalizeSlitherReport(raw, root, { dependencyMode = "reject" } = {}) {
  if (!["reject", "partition"].includes(dependencyMode)) {
    throw new Error("unknown Slither dependency mode");
  }
  exactKeys(raw, ["success", "error", "results"], "report");
  if (typeof raw.success !== "boolean") throw new Error("report success must be boolean");
  if (raw.error !== null && typeof raw.error !== "string") {
    throw new Error("report error must be null or string");
  }
  exactKeys(raw.results, ["detectors"], "results");
  if (!Array.isArray(raw.results.detectors)) {
    throw new Error("results detectors must be an array");
  }
  if (!raw.success) throw new Error("Slither analysis failed");
  if (raw.error !== null) throw new Error("successful Slither report has an error");
  return raw.results.detectors
    .map((detector) => normalizeDetector(detector, root, dependencyMode))
    .filter((finding) => finding !== null);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedDescription(description) {
  return description.trim().replace(/\s+/g, " ");
}

export function findingFingerprint(finding, sourceBytes) {
  if (!isRecord(finding) || !Array.isArray(finding.elements) || finding.elements.length === 0) {
    throw new Error("normalized finding has no source element");
  }
  const primary = finding.elements[0];
  if (!(sourceBytes instanceof Uint8Array)) throw new Error("source bytes are required");
  if (primary.start + primary.length > sourceBytes.byteLength) {
    throw new Error("source mapping exceeds source bytes");
  }
  return {
    detector: finding.check,
    impact: finding.impact,
    confidence: finding.confidence,
    path: primary.path,
    elementType: primary.type,
    elementName: primary.name,
    contractName: primary.contractName,
    functionName: primary.functionName,
    start: primary.start,
    length: primary.length,
    descriptionSha256: sha256(normalizedDescription(finding.description)),
    sourceSnippetSha256: sha256(
      sourceBytes.subarray(primary.start, primary.start + primary.length),
    ),
  };
}

function fingerprintIdentity(value) {
  return JSON.stringify(fingerprintKeys.map((key) => value[key]));
}

function validateFingerprintFields(entry) {
  for (const key of [
    "detector",
    "impact",
    "confidence",
    "path",
    "elementType",
    "elementName",
    "contractName",
    "functionName",
    "descriptionSha256",
    "sourceSnippetSha256",
  ]) {
    requireString(entry[key], `allowlist ${key}`, {
      allowEmpty: ["elementName", "contractName", "functionName"].includes(key),
    });
  }
  if (!impacts.has(entry.impact)) throw new Error(`unknown Slither impact: ${entry.impact}`);
  if (entry.impact === "High" || entry.impact === "Medium") {
    throw new Error(`${entry.impact} findings cannot be allowlisted`);
  }
  if (!confidences.has(entry.confidence)) {
    throw new Error(`unknown Slither confidence: ${entry.confidence}`);
  }
  requireInteger(entry.start, "allowlist start");
  requireInteger(entry.length, "allowlist length", 1);
  if (!/^[a-f0-9]{64}$/.test(entry.descriptionSha256)
    || !/^[a-f0-9]{64}$/.test(entry.sourceSnippetSha256)) {
    throw new Error("allowlist fingerprint contains invalid SHA-256");
  }
}

export function validateAllowlist(raw) {
  exactKeys(raw, ["version", "entries"], "allowlist");
  if (raw.version !== 1) throw new Error("unsupported Slither allowlist version");
  if (!Array.isArray(raw.entries)) throw new Error("allowlist entries must be an array");
  const seen = new Set();
  for (const entry of raw.entries) {
    exactKeys(entry, entryKeys, "allowlist entry");
    validateFingerprintFields(entry);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewedAt)) {
      throw new Error("allowlist reviewedAt must be YYYY-MM-DD");
    }
    if (typeof entry.rationale !== "string"
      || entry.rationale.length < 40
      || entry.rationale.length > 400
      || /\b(?:todo|tbd|generic|intended and bounded)\b/i.test(entry.rationale)) {
      throw new Error("allowlist rationale must be a concrete 40-400 character review");
    }
    const identity = fingerprintIdentity(entry);
    if (seen.has(identity)) throw new Error("duplicate allowlist entry");
    seen.add(identity);
  }
  return structuredClone(raw);
}

function parseAuditDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("assurance audit date must be YYYY-MM-DD");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("assurance audit date is invalid");
  }
  return date;
}

export function enforceSlitherFindings(findings, allowlist, sources, now) {
  if (!Array.isArray(findings) || !(sources instanceof Map)) {
    throw new Error("Slither enforcement inputs are invalid");
  }
  const auditDate = parseAuditDate(now);
  const counts = { High: 0, Medium: 0, Low: 0, Informational: 0 };
  const entries = new Map(
    allowlist.entries.map((entry) => [fingerprintIdentity(entry), entry]),
  );
  const used = new Set();
  const acceptedDetectorIds = [];

  for (const finding of findings) {
    counts[finding.impact] += 1;
    if (finding.impact === "High" || finding.impact === "Medium") {
      throw new Error(`unacceptable ${finding.impact} Slither finding: ${finding.check}`);
    }
    const path = finding.elements[0]?.path;
    const sourceBytes = sources.get(path);
    if (!(sourceBytes instanceof Uint8Array)) {
      throw new Error(`source bytes are missing for Slither finding: ${finding.check}`);
    }
    const fingerprint = findingFingerprint(finding, sourceBytes);
    const identity = fingerprintIdentity(fingerprint);
    const entry = entries.get(identity);
    if (!entry) {
      throw new Error(`unreviewed ${finding.impact} Slither finding: ${finding.check}`);
    }
    const reviewDate = parseAuditDate(entry.reviewedAt);
    if (reviewDate > auditDate) throw new Error("future Slither allowlist review");
    const ageDays = (auditDate - reviewDate) / 86_400_000;
    if (ageDays > 366) throw new Error("expired Slither allowlist review");
    used.add(identity);
    acceptedDetectorIds.push(finding.check);
  }
  for (const [identity, entry] of entries) {
    if (!used.has(identity)) {
      throw new Error(`unused Slither allowlist entry: ${entry.detector}`);
    }
  }
  acceptedDetectorIds.sort();
  return { counts, acceptedDetectorIds };
}
