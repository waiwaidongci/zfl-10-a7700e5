import { mkdir, readFile, writeFile, copyFile, unlink, access } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./utils/migrations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "restoration.json");
const backupPath = join(__dirname, "..", "data", "restoration.json.backup");
const maxBackups = 5;

async function createBackup() {
  try {
    if (existsSync(dbPath)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const timestampedBackup = join(
        __dirname,
        "..",
        "data",
        `restoration.json.backup-${timestamp}`
      );
      await copyFile(dbPath, timestampedBackup);

      const backups = [];
      const dataDir = dirname(dbPath);
      const fs = await import("node:fs");
      const files = fs.readdirSync(dataDir);
      for (const file of files) {
        if (file.startsWith("restoration.json.backup-")) {
          const fullPath = join(dataDir, file);
          const stat = fs.statSync(fullPath);
          backups.push({ path: fullPath, mtime: stat.mtime });
        }
      }
      backups.sort((a, b) => b.mtime - a.mtime);
      for (let i = maxBackups; i < backups.length; i++) {
        try {
          await unlink(backups[i].path);
        } catch (e) {
          console.warn("Failed to delete old backup:", backups[i].path, e);
        }
      }

      return timestampedBackup;
    }
  } catch (error) {
    console.warn("Backup creation failed:", error);
  }
  return null;
}

function validateDbStructure(db) {
  const errors = [];
  if (!db || typeof db !== "object") {
    errors.push("数据库不是有效的对象");
    return errors;
  }
  if (!Array.isArray(db.users)) errors.push("users 字段缺失或不是数组");
  if (!Array.isArray(db.projects)) errors.push("projects 字段缺失或不是数组");
  if (!Array.isArray(db.templates)) errors.push("templates 字段缺失或不是数组");
  if (!Array.isArray(db.templateVersions))
    errors.push("templateVersions 字段缺失或不是数组");
  if (!Array.isArray(db.auditLogs))
    errors.push("auditLogs 字段缺失或不是数组");
  if (!Array.isArray(db.offlineDrafts))
    errors.push("offlineDrafts 字段缺失或不是数组");
  if (!Array.isArray(db.syncQueue))
    errors.push("syncQueue 字段缺失或不是数组");
  if (!Array.isArray(db.materialMovements))
    errors.push("materialMovements 字段缺失或不是数组");
  if (!Array.isArray(db.reportSnapshots))
    errors.push("reportSnapshots 字段缺失或不是数组");
  return errors;
}

const seed = {
  users: [
    { id: "u-admin", name: "管理员", role: "admin" },
    { id: "u-mei", name: "顾眉", role: "worker" },
    { id: "u-yan", name: "严澈", role: "worker" }
  ],
  projects: [
    { id: "R-001", title: "明代族谱散页", era: "明代", damage: "虫蛀、边角缺失", steps: "清洁、补纸、压平", materials: "楮皮纸、小麦淀粉浆", owner: "顾眉", dueDate: "2026-06-22", status: "进行中", photos: "https://images.unsplash.com/photo-1524995997946-a1c2e315a42f", updatedAt: "2026-06-11", version: 1, reviewRecords: [], timelineRecords: [], photoArchive: { before: ["https://images.unsplash.com/photo-1524995997946-a1c2e315a42f", "https://images.unsplash.com/photo-1506744038136-46273834b3fb"], during: ["https://images.unsplash.com/photo-1466442929976-97f336a657be"], after: [] } },
    { id: "R-002", title: "清刻本医书", era: "清代", damage: "水渍、书脊松散", steps: "拆线、干洗、重装", materials: "棉线、宣纸", owner: "严澈", dueDate: "2026-06-12", status: "待复核", photos: "", updatedAt: "2026-06-10", version: 1, reviewRecords: [], timelineRecords: [], photoArchive: { before: [], during: [], after: [] } }
  ],
  offlineDrafts: [],
  syncQueue: [],
  reportSnapshots: [],
  intakes: [
    { id: "I-001", title: "宋版文选残卷", era: "宋代", source: "私人捐赠", receiver: "顾眉", receivedAt: "2026-06-10", damage: "封面缺失、书页霉斑", tempLocation: "A柜-3层", status: "待修复", createdAt: "2026-06-10", projectId: null },
    { id: "I-002", title: "民国线装诗集", era: "民国", source: "图书馆移交", receiver: "严澈", receivedAt: "2026-06-12", damage: "书脊开裂、部分页脱胶", tempLocation: "B柜-1层", status: "待修复", createdAt: "2026-06-12", projectId: null }
  ],
  materials: [
    { id: "M-001", name: "楮皮纸", unit: "张", quantity: 500, lowStockThreshold: 100, updatedAt: "2026-06-10" },
    { id: "M-002", name: "宣纸", unit: "张", quantity: 300, lowStockThreshold: 80, updatedAt: "2026-06-11" },
    { id: "M-003", name: "小麦淀粉浆", unit: "克", quantity: 2000, lowStockThreshold: 500, updatedAt: "2026-06-09" },
    { id: "M-004", name: "棉线", unit: "米", quantity: 150, lowStockThreshold: 30, updatedAt: "2026-06-12" }
  ],
  materialMovements: [],
  templates: [
    {
      id: "TPL-001",
      name: "古籍散页修复流程",
      category: "古籍散页",
      version: 1,
      steps: "1. 检查散页数量及破损情况，拍照存档\n2. 使用软毛刷清理表面灰尘与污渍\n3. 对虫蛀、缺口处使用楮皮纸补缀\n4. 使用小麦淀粉浆粘合补纸\n5. 压平定型，干燥处理\n6. 检查补纸边缘贴合度，修整",
      materials: "楮皮纸、小麦淀粉浆",
      estimatedDays: 7,
      reviewRequired: true,
      reviewNotes: "需检验补纸边缘贴合度及页面平整度",
      createdAt: "2026-06-14",
      updatedAt: "2026-06-14"
    },
    {
      id: "TPL-002",
      name: "线装书修复流程",
      category: "线装书",
      version: 1,
      steps: "1. 拆线，逐页检查破损情况\n2. 清理页面灰尘及霉斑\n3. 对脱胶页面进行补缀\n4. 对断裂书脊进行重新装订\n5. 封面托裱修复\n6. 穿线加固，压平定型",
      materials: "楮皮纸、小麦淀粉浆、棉线、宣纸",
      estimatedDays: 10,
      reviewRequired: true,
      reviewNotes: "需检验装订牢固度、封面托裱质量及整体平整度",
      createdAt: "2026-06-14",
      updatedAt: "2026-06-14"
    },
    {
      id: "TPL-003",
      name: "碑帖拓片修复流程",
      category: "碑帖拓片",
      version: 1,
      steps: "1. 检查拓片整体状况，记录折痕与破损\n2. 使用蒸汽或微湿毛巾软化折痕\n3. 对断裂处进行托裱加固\n4. 使用宣纸进行整体托裱\n5. 压平干燥处理\n6. 修整边缘，检查墨迹完整性",
      materials: "宣纸、小麦淀粉浆",
      estimatedDays: 14,
      reviewRequired: true,
      reviewNotes: "需检验托裱平整度及墨迹是否受损",
      createdAt: "2026-06-14",
      updatedAt: "2026-06-14"
    }
  ]
};

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    const initialDb = JSON.parse(JSON.stringify(seed));
    initialDb.templateVersions = [];
    for (const tpl of initialDb.templates) {
      initialDb.templateVersions.push({
        id: `TV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        templateId: tpl.id,
        version: tpl.version,
        name: tpl.name,
        category: tpl.category,
        steps: tpl.steps,
        materials: tpl.materials,
        estimatedDays: tpl.estimatedDays,
        reviewRequired: tpl.reviewRequired,
        reviewNotes: tpl.reviewNotes || "",
        operator: "系统初始化",
        operatorId: "system",
        createdAt: tpl.createdAt
      });
    }
    initialDb.reportSnapshots = [];
    initialDb._meta = { schemaVersion: 5, migrations: [{ version: 2, appliedAt: new Date().toISOString() }, { version: 3, appliedAt: new Date().toISOString() }, { version: 4, appliedAt: new Date().toISOString() }, { version: 5, appliedAt: new Date().toISOString() }] };
    for (const project of initialDb.projects) {
      project.templateSnapshot = null;
    }
    initialDb.auditLogs = [];
    await writeFile(dbPath, JSON.stringify(initialDb, null, 2));
    return initialDb;
  }

  let db;
  let rawData;
  try {
    rawData = await readFile(dbPath, "utf8");
    db = JSON.parse(rawData);
  } catch (error) {
    console.error("Failed to parse database file:", error.message);
    const backup = await createBackup();
    if (backup) {
      console.error("Backup created at:", backup);
    }
    throw new Error(`数据库文件损坏，已创建备份: ${error.message}`);
  }

  const structureErrors = validateDbStructure(db);
  if (structureErrors.length > 0) {
    console.warn("Database structure issues found:", structureErrors);
  }

  let changed = false;

  const requiredCollections = ["users", "projects", "intakes", "materials", "materialMovements", "offlineDrafts", "syncQueue", "reportSnapshots"];
  for (const key of requiredCollections) {
    if (!(key in db) || !Array.isArray(db[key])) {
      if (db[key] === undefined || db[key] === null) {
        console.warn(`Initializing empty collection: ${key}`);
        db[key] = JSON.parse(JSON.stringify(seed[key] || []));
        changed = true;
      } else if (!Array.isArray(db[key])) {
        console.warn(`Collection ${key} is not an array, resetting to empty array`);
        db[key] = [];
        changed = true;
      }
    }
  }

  if (!Array.isArray(db.templates)) {
    if (db.templates === undefined || db.templates === null) {
      console.warn("Initializing templates collection");
      db.templates = JSON.parse(JSON.stringify(seed.templates));
      changed = true;
    } else {
      console.warn("templates collection is not an array, resetting");
      db.templates = JSON.parse(JSON.stringify(seed.templates));
      changed = true;
    }
  }

  if (!db.templateVersions) {
    db.templateVersions = [];
    changed = true;
  }

  if (db.projects && Array.isArray(db.projects)) {
    for (const project of db.projects) {
      if (!project.reviewRecords) {
        project.reviewRecords = [];
        changed = true;
      }
      if (!project.timelineRecords) {
        project.timelineRecords = [];
        changed = true;
      }
      if (!project.photoArchive) {
        project.photoArchive = { before: [], during: [], after: [] };
        changed = true;
      }
      if (project.templateSnapshot === undefined) {
        project.templateSnapshot = null;
        changed = true;
      }
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
          if (record.materialUsages === undefined) {
            record.materialUsages = [];
            changed = true;
          }
        }
      }
    }
  }

  const migrated = runMigrations(db);
  if (migrated) changed = true;

  if (changed) {
    await createBackup();
    await writeFile(dbPath, JSON.stringify(db, null, 2));
  }
  return db;
}

export async function saveDb(db) {
  const structureErrors = validateDbStructure(db);
  if (structureErrors.length > 0) {
    console.warn("Saving database with structure issues:", structureErrors);
  }

  let jsonData;
  try {
    jsonData = JSON.stringify(db, null, 2);
    JSON.parse(jsonData);
  } catch (error) {
    throw new Error(`数据库序列化失败: ${error.message}`);
  }

  if (existsSync(dbPath)) {
    try {
      const existingData = await readFile(dbPath, "utf8");
      const existingDb = JSON.parse(existingData);

      const protectCollections = ["projects", "templates", "users", "intakes", "materials", "materialMovements", "auditLogs", "offlineDrafts", "syncQueue", "reportSnapshots"];
      for (const col of protectCollections) {
        const oldLen = Array.isArray(existingDb[col]) ? existingDb[col].length : 0;
        const newLen = Array.isArray(db[col]) ? db[col].length : 0;
        if (oldLen > 0 && newLen === 0) {
          console.warn(
            `Data loss detected: ${col} collection would be reduced from ${oldLen} to ${newLen} items. Creating backup first.`
          );
          await createBackup();
          break;
        }
      }
    } catch (error) {
      console.warn("Pre-save data integrity check failed:", error);
    }
  }

  await createBackup();
  await writeFile(dbPath, jsonData);
}

export function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

export async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
