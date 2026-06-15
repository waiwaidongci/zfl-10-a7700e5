import { createSnapshot, createTemplateVersionRecord, isSnapshotValid } from "./templateSnapshots.js";

const CURRENT_SCHEMA_VERSION = 2;

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
    for (const tpl of db.templates || []) {
      db.templateVersions.push(createTemplateVersionRecord(tpl, { operator: "系统迁移", operatorId: "migration" }));
    }
    changed = true;
  }

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

const migrations = [
  { from: 1, to: 2, run: migration_v1_to_v2 }
];

export function runMigrations(db) {
  const meta = getDbMeta(db);
  let changed = false;

  while (meta.schemaVersion < CURRENT_SCHEMA_VERSION) {
    const nextVersion = meta.schemaVersion + 1;
    const migration = migrations.find((m) => m.from === meta.schemaVersion && m.to === nextVersion);
    if (migration) {
      const migrated = migration.run(db);
      if (migrated) changed = true;
      meta.schemaVersion = nextVersion;
      meta.migrations.push({
        version: nextVersion,
        appliedAt: new Date().toISOString()
      });
      changed = true;
    } else {
      meta.schemaVersion = nextVersion;
      changed = true;
    }
  }

  if (meta.schemaVersion === 0) {
    meta.schemaVersion = CURRENT_SCHEMA_VERSION;
    for (const m of migrations) {
      const migrated = m.run(db);
      if (migrated) changed = true;
      meta.migrations.push({
        version: m.to,
        appliedAt: new Date().toISOString()
      });
    }
    changed = true;
  }

  return changed;
}

export function getCurrentSchemaVersion() {
  return CURRENT_SCHEMA_VERSION;
}
