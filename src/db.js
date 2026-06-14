import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "restoration.json");

const seed = {
  users: [
    { id: "u-admin", name: "管理员", role: "admin" },
    { id: "u-mei", name: "顾眉", role: "worker" },
    { id: "u-yan", name: "严澈", role: "worker" }
  ],
  projects: [
    { id: "R-001", title: "明代族谱散页", era: "明代", damage: "虫蛀、边角缺失", steps: "清洁、补纸、压平", materials: "楮皮纸、小麦淀粉浆", owner: "顾眉", dueDate: "2026-06-22", status: "进行中", photos: "https://images.unsplash.com/photo-1524995997946-a1c2e315a42f", updatedAt: "2026-06-11", reviewRecords: [], timelineRecords: [] },
    { id: "R-002", title: "清刻本医书", era: "清代", damage: "水渍、书脊松散", steps: "拆线、干洗、重装", materials: "棉线、宣纸", owner: "严澈", dueDate: "2026-06-12", status: "待复核", photos: "", updatedAt: "2026-06-10", reviewRecords: [], timelineRecords: [] }
  ],
  intakes: [
    { id: "I-001", title: "宋版文选残卷", era: "宋代", source: "私人捐赠", receiver: "顾眉", receivedAt: "2026-06-10", damage: "封面缺失、书页霉斑", tempLocation: "A柜-3层", status: "待修复", createdAt: "2026-06-10" },
    { id: "I-002", title: "民国线装诗集", era: "民国", source: "图书馆移交", receiver: "严澈", receivedAt: "2026-06-12", damage: "书脊开裂、部分页脱胶", tempLocation: "B柜-1层", status: "待修复", createdAt: "2026-06-12" }
  ],
  materials: [
    { id: "M-001", name: "楮皮纸", unit: "张", quantity: 500, lowStockThreshold: 100, updatedAt: "2026-06-10" },
    { id: "M-002", name: "宣纸", unit: "张", quantity: 300, lowStockThreshold: 80, updatedAt: "2026-06-11" },
    { id: "M-003", name: "小麦淀粉浆", unit: "克", quantity: 2000, lowStockThreshold: 500, updatedAt: "2026-06-09" },
    { id: "M-004", name: "棉线", unit: "米", quantity: 150, lowStockThreshold: 30, updatedAt: "2026-06-12" }
  ]
};

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
    return JSON.parse(JSON.stringify(seed));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  let changed = false;
  for (const key of Object.keys(seed)) {
    if (!(key in db)) {
      db[key] = JSON.parse(JSON.stringify(seed[key]));
      changed = true;
    }
  }
  if (db.projects) {
    for (const project of db.projects) {
      if (!project.reviewRecords) {
        project.reviewRecords = [];
        changed = true;
      }
      if (!project.timelineRecords) {
        project.timelineRecords = [];
        changed = true;
      }
    }
  }
  if (changed) await writeFile(dbPath, JSON.stringify(db, null, 2));
  return db;
}

export async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
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
