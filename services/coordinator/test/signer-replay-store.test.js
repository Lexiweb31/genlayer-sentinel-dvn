import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  SqliteSignerReplayStore,
} from "../../../dist/services/coordinator/src/signer-replay-store.js";

const h = (n) => `0x${n.repeat(64)}`;

test("durably binds a GUID to execution and authorization digests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sentinel-signer-replay-"));
  const path = join(dir, "state.db");
  let store = new SqliteSignerReplayStore(path);
  try {
    assert.equal(
      await store.reserve(
        "coordinator-west",
        h("1"),
        h("a"),
        h("b"),
        h("c"),
        130,
        100,
      ),
      "RESERVED",
    );
    assert.equal(
      await store.reserve(
        "coordinator-west",
        h("1"),
        h("a"),
        h("b"),
        h("c"),
        130,
        100,
      ),
      "DUPLICATE",
    );
    assert.equal(
      await store.reserve(
        "coordinator-west",
        h("2"),
        h("a"),
        h("b"),
        h("c"),
        140,
        101,
      ),
      "RESERVED",
    );
    assert.equal(
      await store.reserve(
        "coordinator-west",
        h("3"),
        h("a"),
        h("d"),
        h("c"),
        140,
        101,
      ),
      "CONFLICT",
    );
    assert.equal(
      await store.reserve(
        "coordinator-west",
        h("4"),
        h("a"),
        h("b"),
        h("d"),
        140,
        101,
      ),
      "CONFLICT",
    );
    store.close();
    store = new SqliteSignerReplayStore(path);
    assert.equal(
      await store.reserve(
        "coordinator-west",
        h("5"),
        h("a"),
        h("b"),
        h("d"),
        150,
        102,
      ),
      "CONFLICT",
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isolates coordinator namespaces and rejects invalid reservations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sentinel-signer-replay-"));
  const store = new SqliteSignerReplayStore(join(dir, "state.db"));
  try {
    assert.equal(
      await store.reserve(
        "coordinator-west",
        h("1"),
        h("a"),
        h("b"),
        h("c"),
        130,
        100,
      ),
      "RESERVED",
    );
    assert.equal(
      await store.reserve(
        "coordinator-east",
        h("1"),
        h("a"),
        h("d"),
        h("e"),
        130,
        100,
      ),
      "RESERVED",
    );
    const invalid = [
      ["bad id", h("2"), h("a"), h("b"), h("c"), 130, 100],
      ["coordinator-west", "0x12", h("a"), h("b"), h("c"), 130, 100],
      ["coordinator-west", h("2"), h("a"), h("b"), "0x12", 130, 100],
      ["coordinator-west", h("2"), h("a"), h("b"), h("c"), 100, 100],
      ["coordinator-west", h("2"), h("a"), h("b"), h("c"), 1.5, 1],
    ];
    for (const args of invalid) {
      await assert.rejects(store.reserve(...args));
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("migrates only empty legacy replay databases", async () => {
  const emptyDir = mkdtempSync(join(tmpdir(), "sentinel-signer-replay-"));
  const emptyPath = join(emptyDir, "legacy.db");
  createLegacyDatabase(emptyPath, false);
  const migrated = new SqliteSignerReplayStore(emptyPath);
  try {
    assert.equal(
      await migrated.reserve(
        "coordinator-west",
        h("1"),
        h("a"),
        h("b"),
        h("c"),
        130,
        100,
      ),
      "RESERVED",
    );
  } finally {
    migrated.close();
    rmSync(emptyDir, { recursive: true, force: true });
  }

  const populatedDir = mkdtempSync(join(tmpdir(), "sentinel-signer-replay-"));
  const populatedPath = join(populatedDir, "legacy.db");
  createLegacyDatabase(populatedPath, true);
  try {
    assert.throws(
      () => new SqliteSignerReplayStore(populatedPath),
      /legacy signer replay state requires operator migration/,
    );
  } finally {
    rmSync(populatedDir, { recursive: true, force: true });
  }
});

function createLegacyDatabase(path, populated) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE signer_guid_bindings(
      coordinator_id TEXT NOT NULL,
      guid TEXT NOT NULL,
      digest TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(coordinator_id,guid)
    );
    CREATE TABLE signer_request_reservations(
      coordinator_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      guid TEXT NOT NULL,
      digest TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(coordinator_id,request_id)
    );
  `);
  if (populated) {
    db.prepare(
      "INSERT INTO signer_guid_bindings(coordinator_id,guid,digest,created_at) VALUES(?,?,?,?)",
    ).run("coordinator-west", h("a"), h("b"), 100);
  }
  db.close();
}
