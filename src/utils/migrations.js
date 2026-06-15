import { createSnapshot, createTemplateVersionRecord, isSnapshotValid } from "./templateSnapshots.js";
import { ensureAuditCollection } from "./audit.js";

const CURRENT_SCHEMA_VERSION = 4;

function getDbMeta(db) {
  if (!db._meta) {
    db._meta = { schemaVersion: 0, migrations: [] };
  }
  return db._meta;
}

function migration_v1_to_v2(db) {
  let changed = false;

  if (!db.templateVersions) {
    db.templateVersions = [];
    changed = true;
  }

  if (ensureTemplateVersionHistory(db)) changed = true;

  if (db.projects) {
    for (const project of db.projects) {
      if (project.templateSnapshot && !isSnapshotValid(project.templateSnapshot)) {
        const oldSnap = project.templateSnapshot;
        const tpl = (db.templates || []).find((t) => t.id === oldSnap.templateId);
        if (tpl) {
          const snapshot = createSnapshot(tpl);
          snapshot.appliedAt = oldSnap.appliedAt || project.updatedAt || project.createdAt || new Date().toISOString().slice(0, 10);
          project.templateSnapshot = snapshot;
        } else {
          project.templateSnapshot = {
            ...oldSnap,
            steps: project.steps || "",
            materials: project.materials || "",
            estimatedDays: 7,
            reviewRequired: true,
            reviewNotes: ""
          };
        }
        changed = true;
      }
      if (project.templateSnapshot === undefined) {
        project.templateSnapshot = null;
        changed = true;
      }
    }
  }

  return changed;
}

function createVersionRecordFromSource(template, version, source) {
  const isSnapshot = source && source.templateSnapshot;
  const data = isSnapshot ? source.templateSnapshot : (source || template);
  return {
    id: `TV-${template.id}-v${version}`,
    templateId: template.id,
    version,
    name: data.templateName || data.name || template.name,
    category: data.templateCategory || data.category || template.category,
    steps: data.steps || template.steps,
    materials: data.materials || template.materials,
    estimatedDays: data.estimatedDays || template.estimatedDays,
    reviewRequired: data.reviewRequired !== undefined ? data.reviewRequired : template.reviewRequired,
    reviewNotes: data.reviewNotes || "",
    operator: "系统迁移",
    operatorId: "migration",
    createdAt: data.appliedAt || data.createdAt || template.createdAt || new Date().toISOString().slice(0, 10)
  };
}

function findVersionSource(db, template, version) {
  if (version === template.version) return template;
  const project = (db.projects || []).find((item) =>
    item.templateSnapshot
    && item.templateSnapshot.templateId === template.id
    && item.templateSnapshot.templateVersion === version
  );
  return project || template;
}

function ensureTemplateVersionHistory(db) {
  if (!Array.isArray(db.templateVersions)) db.templateVersions = [];
  let changed = false;

  for (const template of db.templates || []) {
    const latestVersion = Math.max(1, Number(template.version) || 1);
    for (let version = 1; version <= latestVersion; version += 1) {
      const exists = db.templateVersions.some((item) =>
        item.templateId === template.id && Number(item.version) === version
      );
      if (!exists) {
        const source = findVersionSource(db, template, version);
        db.templateVersions.push(createVersionRecordFromSource(template, version, source));
        changed = true;
      }
    }
  }

  return changed;
}

function migration_v2_to_v3(db) {
  let changed = false;

  if (ensureAuditCollection(db)) {
    changed = true;
  }

  return changed;
}

function migration_v3_to_v4(db) {
  let changed = false;

  if (!Array.isArray(db.offlineDrafts)) {
    db.offlineDrafts = [];
    changed = true;
  }

  if (!Array.isArray(db.syncQueue)) {
    db.syncQueue = [];
    changed = true;
  }

  if (db.projects && Array.isArray(db.projects)) {
    for (const project of db.projects) {
      if (project.version === undefined) {
        project.version = 1;
        changed = true;
      }
      if (project.timelineRecords && Array.isArray(project.timelineRecords)) {
        for (const record of project.timelineRecords) {
          if (record.version === undefined) {
            record.version = 1;
            changed = true;
          }
        }
      }
    }
  }

  return changed;
}

const migrations = [
  { from: 1, to: 2, run: migration_v1_to_v2 },
  { from: 2, to: 3, run: migration_v2_to_v3 },
  { from: 3, to: 4, run: migration_v3_to_v4 }
];

export function runMigrations(db) {
  const meta = getDbMeta(db);
  let changed = false;

  if (!Array.isArray(meta.migrations)) {
    meta.migrations = [];
    changed = true;
  }

  const appliedVersions = new Set(meta.migrations.map((m) => m.version));

  if (meta.schemaVersion === 0 || meta.schemaVersion === undefined) {
    meta.schemaVersion = 1;
    changed = true;
  }

  while (meta.schemaVersion < CURRENT_SCHEMA_VERSION) {
    const nextVersion = meta.schemaVersion + 1;
    const migration = migrations.find((m) => m.from === meta.schemaVersion && m.to === nextVersion);

    if (migration && !appliedVersions.has(nextVersion)) {
      try {
        const migrated = migration.run(db);
        if (migrated) changed = true;
        meta.schemaVersion = nextVersion;
        meta.migrations.push({
          version: nextVersion,
          appliedAt: new Date().toISOString(),
          status: "success"
        });
        appliedVersions.add(nextVersion);
        changed = true;
      } catch (error) {
        meta.migrations.push({
          version: nextVersion,
          appliedAt: new Date().toISOString(),
          status: "failed",
          error: error.message
        });
        throw new Error(`Migration to version ${nextVersion} failed: ${error.message}`);
      }
    } else if (migration && appliedVersions.has(nextVersion)) {
      meta.schemaVersion = nextVersion;
      changed = true;
    } else if (!migration) {
      meta.schemaVersion = nextVersion;
      meta.migrations.push({
        version: nextVersion,
        appliedAt: new Date().toISOString(),
        status: "skipped",
        note: "No migration script found, version incremented only"
      });
      changed = true;
    }
  }

  for (const m of migrations) {
    if (!appliedVersions.has(m.to) && m.to <= meta.schemaVersion) {
      try {
        const migrated = m.run(db);
        if (migrated) changed = true;
        meta.migrations.push({
          version: m.to,
          appliedAt: new Date().toISOString(),
          status: "backfilled"
        });
        appliedVersions.add(m.to);
        changed = true;
      } catch (error) {
        console.error(`Backfill migration to version ${m.to} failed:`, error);
      }
    }
  }

  return changed;
}

export function getCurrentSchemaVersion() {
  return CURRENT_SCHEMA_VERSION;
}
