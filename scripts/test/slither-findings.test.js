import assert from "node:assert/strict";
import test from "node:test";
import {
  createDependencyAudit,
  enforceSlitherFindings,
  findingFingerprint,
  normalizeSlitherReport,
  validateAllowlist,
} from "../slither-findings.mjs";

const root = "/sentinel";
const source = Buffer.from("contract A { function f() external {} }\n");
const report = {
  success: true,
  error: null,
  results: {
    detectors: [{
      elements: [{
        type: "function",
        name: "f",
        source_mapping: {
          start: 0,
          length: 10,
          filename_relative: "contracts/src/SentinelDVNAdapter.sol",
          filename_absolute: "/sentinel/contracts/src/SentinelDVNAdapter.sol",
          filename_short: "contracts/src/SentinelDVNAdapter.sol",
          is_dependency: false,
          lines: [1],
          starting_column: 1,
          ending_column: 11,
        },
        type_specific_fields: {
          parent: {
            type: "contract",
            name: "A",
          },
          signature: "f()",
        },
      }],
      description: " Informational   example\n",
      markdown: "Informational example",
      first_markdown_element: "contracts/src/SentinelDVNAdapter.sol#L1",
      id: "fixture-id",
      check: "fixture-detector",
      impact: "Informational",
      confidence: "High",
    }],
  },
};

const expectedFinding = {
  check: "fixture-detector",
  impact: "Informational",
  confidence: "High",
  description: " Informational   example\n",
  elements: [{
    type: "function",
    name: "f",
    path: "contracts/src/SentinelDVNAdapter.sol",
    start: 0,
    length: 10,
    contractName: "A",
    functionName: "f",
  }],
};

const expectedFingerprint = {
  detector: "fixture-detector",
  impact: "Informational",
  confidence: "High",
  path: "contracts/src/SentinelDVNAdapter.sol",
  elementType: "function",
  elementName: "f",
  contractName: "A",
  functionName: "f",
  start: 0,
  length: 10,
  descriptionSha256: "6acd6a4f32f1b56e720b55be29495b43ec9e689e773e7cada38b042175cc5522",
  sourceSnippetSha256: "0aa15ed98b88a151ba4e3c5cc870eb461c47ca48767f4ec4fb1946a0f1126f86",
};

const reviewedEntry = {
  ...expectedFingerprint,
  reviewedAt: "2026-07-29",
  rationale: "fixture-detector reports A.f; this fixture has no state or external-call surface.",
};

test("accepts a clean real-shaped Slither report", () => {
  assert.deepEqual(
    normalizeSlitherReport({
      success: true,
      error: null,
      results: { detectors: [] },
    }, root),
    [],
  );
});

test("normalizes one production finding without host-only fields", () => {
  assert.deepEqual(normalizeSlitherReport(report, root), [expectedFinding]);
});

test("accepts Slither's discriminated contract and annotated-node element shapes", () => {
  const contractElement = structuredClone(report);
  contractElement.results.detectors[0].elements[0].type = "contract";
  contractElement.results.detectors[0].elements[0].name = "A";
  delete contractElement.results.detectors[0].elements[0].type_specific_fields;
  assert.deepEqual(normalizeSlitherReport(contractElement, root), [{
    ...expectedFinding,
    elements: [{
      ...expectedFinding.elements[0],
      type: "contract",
      name: "A",
      functionName: "",
    }],
  }]);

  const annotatedNode = structuredClone(report);
  annotatedNode.results.detectors[0].elements[0].type = "node";
  annotatedNode.results.detectors[0].elements[0].name = "target.call(data)";
  annotatedNode.results.detectors[0].elements[0].additional_fields = {
    underlying_type: "external_calls",
  };
  assert.deepEqual(normalizeSlitherReport(annotatedNode, root), [{
    ...expectedFinding,
    elements: [{
      ...expectedFinding.elements[0],
      type: "node",
      name: "target.call(data)",
      functionName: "",
    }],
  }]);

  const annotatedVariable = structuredClone(report);
  annotatedVariable.results.detectors[0].elements[0].type = "variable";
  annotatedVariable.results.detectors[0].elements[0].name = "_value";
  annotatedVariable.results.detectors[0].elements[0].additional_fields = {
    target: "parameter",
    convention: "mixedCase",
  };
  assert.deepEqual(normalizeSlitherReport(annotatedVariable, root), [{
    ...expectedFinding,
    elements: [{
      ...expectedFinding.elements[0],
      type: "variable",
      name: "_value",
      functionName: "",
    }],
  }]);

  const eventElement = structuredClone(report);
  eventElement.results.detectors[0].elements[0].type = "event";
  eventElement.results.detectors[0].elements[0].name = "Verified";
  assert.deepEqual(normalizeSlitherReport(eventElement, root), [{
    ...expectedFinding,
    elements: [{
      ...expectedFinding.elements[0],
      type: "event",
      name: "Verified",
      functionName: "",
    }],
  }]);
});

test("fails closed when Slither reports analysis failure", () => {
  assert.throws(
    () => normalizeSlitherReport({
      success: false,
      error: "/Users/operator/secret/path: compiler exploded",
      results: { detectors: [] },
    }, root),
    (error) => {
      assert.match(error.message, /Slither analysis failed/);
      assert.doesNotMatch(error.message, /operator|compiler exploded/);
      return true;
    },
  );
});

test("rejects missing and extra fields at every closed-schema boundary", () => {
  const extraRoot = structuredClone(report);
  extraRoot.version = "0.11.5";
  assert.throws(() => normalizeSlitherReport(extraRoot, root), /report has unexpected key: version/);

  const missingResult = structuredClone(report);
  delete missingResult.results.detectors;
  assert.throws(() => normalizeSlitherReport(missingResult, root), /results is missing key: detectors/);

  const extraDetector = structuredClone(report);
  extraDetector.results.detectors[0].unknown = true;
  assert.throws(() => normalizeSlitherReport(extraDetector, root), /detector has unexpected key: unknown/);

  const missingElement = structuredClone(report);
  delete missingElement.results.detectors[0].elements[0].type_specific_fields;
  assert.throws(
    () => normalizeSlitherReport(missingElement, root),
    /element is missing key: type_specific_fields/,
  );

  const extraMapping = structuredClone(report);
  extraMapping.results.detectors[0].elements[0].source_mapping.offset = 0;
  assert.throws(
    () => normalizeSlitherReport(extraMapping, root),
    /source mapping has unexpected key: offset/,
  );
});

test("rejects unknown impact and confidence values", () => {
  const impact = structuredClone(report);
  impact.results.detectors[0].impact = "Critical";
  assert.throws(() => normalizeSlitherReport(impact, root), /unknown Slither impact/);

  const confidence = structuredClone(report);
  confidence.results.detectors[0].confidence = "Certain";
  assert.throws(() => normalizeSlitherReport(confidence, root), /unknown Slither confidence/);
});

test("rejects dependency, traversal, and outside-repository source mappings", () => {
  const dependency = structuredClone(report);
  dependency.results.detectors[0].elements[0].source_mapping.is_dependency = true;
  assert.throws(() => normalizeSlitherReport(dependency, root), /dependency finding is not permitted/);

  const traversal = structuredClone(report);
  traversal.results.detectors[0].elements[0].source_mapping.filename_relative = "../Merit/Secret.sol";
  assert.throws(() => normalizeSlitherReport(traversal, root), /outside contracts\/src/);

  const absolute = structuredClone(report);
  absolute.results.detectors[0].elements[0].source_mapping.filename_absolute = "/tmp/Secret.sol";
  assert.throws(() => normalizeSlitherReport(absolute, root), /outside the repository/);
});

test("partitions dependency-only results without hiding mixed production findings", () => {
  const dependencyElement = structuredClone(report.results.detectors[0].elements[0]);
  dependencyElement.name = "dependencyFunction";
  dependencyElement.source_mapping.filename_relative = "node_modules/vendor/Dependency.sol";
  dependencyElement.source_mapping.filename_absolute = "/sentinel/node_modules/vendor/Dependency.sol";
  dependencyElement.source_mapping.filename_short = "node_modules/vendor/Dependency.sol";
  dependencyElement.source_mapping.is_dependency = false;

  const mixed = structuredClone(report);
  mixed.results.detectors[0].elements.push(dependencyElement);
  const mixedAudit = createDependencyAudit();
  assert.deepEqual(
    normalizeSlitherReport(mixed, root, {
      dependencyMode: "partition",
      dependencyAudit: mixedAudit,
    }),
    [expectedFinding],
  );
  assert.deepEqual(mixedAudit, {
    excludedFindings: { High: 0, Medium: 0, Low: 0, Informational: 0 },
    excludedElements: 1,
    mixedFindings: 1,
    detectorIds: [],
  });

  const dependencyOnly = structuredClone(report);
  dependencyOnly.results.detectors[0].elements = [dependencyElement];
  const dependencyOnlyAudit = createDependencyAudit();
  assert.deepEqual(
    normalizeSlitherReport(dependencyOnly, root, {
      dependencyMode: "partition",
      dependencyAudit: dependencyOnlyAudit,
    }),
    [],
  );
  assert.deepEqual(dependencyOnlyAudit, {
    excludedFindings: { High: 0, Medium: 0, Low: 0, Informational: 1 },
    excludedElements: 1,
    mixedFindings: 0,
    detectorIds: ["fixture-detector"],
  });
});

test("binds a finding to literal description and source bytes", () => {
  assert.deepEqual(findingFingerprint(expectedFinding, source), expectedFingerprint);
  assert.throws(
    () => findingFingerprint(expectedFinding, Buffer.from("short")),
    /source mapping exceeds source bytes/,
  );
});

test("accepts only the exact allowlist schema and reviewed rationale", () => {
  assert.deepEqual(validateAllowlist({
    version: 1,
    entries: [reviewedEntry],
  }), {
    version: 1,
    entries: [reviewedEntry],
  });

  assert.throws(
    () => validateAllowlist({ version: 1, entries: [reviewedEntry], detectorGlob: "*" }),
    /allowlist has unexpected key: detectorGlob/,
  );
  assert.throws(
    () => validateAllowlist({
      version: 1,
      entries: [{ ...reviewedEntry, rationale: "intended and bounded" }],
    }),
    /allowlist rationale/,
  );
});

test("never accepts High or Medium findings even when an entry matches", () => {
  for (const impact of ["High", "Medium"]) {
    const finding = { ...expectedFinding, impact };
    const fingerprint = { ...expectedFingerprint, impact };
    assert.throws(
      () => validateAllowlist({
        version: 1,
        entries: [{
          ...fingerprint,
          reviewedAt: "2026-07-29",
          rationale: `${impact} fixture-detector in A.f cannot be accepted by policy under any bound.`,
        }],
      }),
      new RegExp(`${impact} findings cannot be allowlisted`),
    );
    assert.throws(
      () => enforceSlitherFindings(
        [finding],
        validateAllowlist({ version: 1, entries: [] }),
        new Map([[fingerprint.path, source]]),
        "2026-07-29",
      ),
      new RegExp(`unacceptable ${impact} Slither finding`),
    );
  }
});

test("accepts one exact reviewed informational finding without exposing description", () => {
  const result = enforceSlitherFindings(
    [expectedFinding],
    validateAllowlist({ version: 1, entries: [reviewedEntry] }),
    new Map([[expectedFingerprint.path, source]]),
    "2026-07-29",
  );
  assert.deepEqual(result, {
    counts: { High: 0, Medium: 0, Low: 0, Informational: 1 },
    acceptedDetectorIds: ["fixture-detector"],
  });
  assert.doesNotMatch(JSON.stringify(result), /Informational example/);
});

test("rejects unexpected, stale, duplicate, expired, future, and unused reviews", () => {
  assert.throws(
    () => enforceSlitherFindings(
      [expectedFinding],
      validateAllowlist({ version: 1, entries: [] }),
      new Map([[expectedFingerprint.path, source]]),
      "2026-07-29",
    ),
    /unreviewed Informational Slither finding: fixture-detector/,
  );

  for (const changed of [
    { sourceSnippetSha256: "1".repeat(64) },
    { descriptionSha256: "2".repeat(64) },
    { start: 1 },
    { length: 9 },
  ]) {
    assert.throws(
      () => enforceSlitherFindings(
        [expectedFinding],
        validateAllowlist({
          version: 1,
          entries: [{ ...reviewedEntry, ...changed }],
        }),
        new Map([[expectedFingerprint.path, source]]),
        "2026-07-29",
      ),
      /unreviewed Informational Slither finding/,
    );
  }

  assert.throws(
    () => validateAllowlist({ version: 1, entries: [reviewedEntry, reviewedEntry] }),
    /duplicate allowlist entry/,
  );
  assert.throws(
    () => enforceSlitherFindings(
      [expectedFinding, expectedFinding],
      validateAllowlist({ version: 1, entries: [reviewedEntry] }),
      new Map([[expectedFingerprint.path, source]]),
      "2026-07-29",
    ),
    /one Slither allowlist entry matched multiple findings/,
  );
  assert.throws(
    () => enforceSlitherFindings(
      [],
      validateAllowlist({ version: 1, entries: [reviewedEntry] }),
      new Map([[expectedFingerprint.path, source]]),
      "2026-07-29",
    ),
    /unused Slither allowlist entry/,
  );
  assert.throws(
    () => enforceSlitherFindings(
      [expectedFinding],
      validateAllowlist({
        version: 1,
        entries: [{ ...reviewedEntry, reviewedAt: "2025-01-01" }],
      }),
      new Map([[expectedFingerprint.path, source]]),
      "2026-07-29",
    ),
    /expired Slither allowlist review/,
  );
  assert.throws(
    () => enforceSlitherFindings(
      [expectedFinding],
      validateAllowlist({
        version: 1,
        entries: [{ ...reviewedEntry, reviewedAt: "2026-07-30" }],
      }),
      new Map([[expectedFingerprint.path, source]]),
      "2026-07-29",
    ),
    /future Slither allowlist review/,
  );
});
