import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const realDataPath = join(projectRoot, "data", "restoration.json");
const seedDataPath = join(projectRoot, "data", "restoration.json");

function buildSeedDb() {
  const seed = {
    _dataVersion: 1,
    users: [
      { id: "u-admin", name: "管理员", role: "admin" },
      { id: "u-mei", name: "顾眉", role: "worker" },
      { id: "u-yan", name: "严澈", role: "worker" }
    ],
    projects: [
      {
        id: "R-001",
        title: "明代族谱散页",
        era: "明代",
        damage: "虫蛀、边角缺失",
        steps: "清洁、补纸、压平",
        materials: "楮皮纸、小麦淀粉浆",
        owner: "顾眉",
        dueDate: "2026-06-22",
        status: "进行中",
        photos: "https://images.unsplash.com/photo-1524995997946-a1c2e315a42f",
        updatedAt: "2026-06-11",
        version: 1,
        reviewRecords: [],
        timelineRecords: [],
        photoArchive: { before: [], during: [], after: [] },
        templateSnapshot: null
      },
      {
        id: "R-002",
        title: "清刻本医书",
        era: "清代",
        damage: "水渍、书脊松散",
        steps: "拆线、干洗、重装",
        materials: "棉线、宣纸",
        owner: "严澈",
        dueDate: "2026-06-12",
        status: "待复核",
        photos: "",
        updatedAt: "2026-06-10",
        version: 1,
        reviewRecords: [],
        timelineRecords: [],
        photoArchive: { before: [], during: [], after: [] },
        templateSnapshot: null
      }
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
    ],
    templateVersions: [],
    auditLogs: [],
    _meta: {
      schemaVersion: 5,
      migrations: [
        { version: 2, appliedAt: new Date().toISOString() },
        { version: 3, appliedAt: new Date().toISOString() },
        { version: 4, appliedAt: new Date().toISOString() },
        { version: 5, appliedAt: new Date().toISOString() }
      ]
    }
  };
  for (const tpl of seed.templates) {
    seed.templateVersions.push({
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
  return seed;
}

function createTempEnvironment() {
  const tmpBase = join(projectRoot, ".test-tmp");
  mkdirSync(tmpBase, { recursive: true });
  const tmpDir = mkdtempSync(join(tmpBase, "test-run-"));
  const tmpDbPath = join(tmpDir, "restoration.json");
  const seed = buildSeedDb();
  writeFileSync(tmpDbPath, JSON.stringify(seed, null, 2), "utf8");
  return { tmpDir, tmpDbPath };
}

const port = Number(process.env.TEST_PORT || 3099);
const { tmpDir, tmpDbPath } = createTempEnvironment();

process.env.DB_PATH = tmpDbPath;
process.env.PORT = String(port);
process.env.NODE_ENV = "test";

const serverPath = join(projectRoot, "server.js");
const child = spawn(process.execPath, [serverPath], {
  cwd: projectRoot,
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"]
});

function cleanup(code = 0) {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
  process.exit(code);
}

process.on("SIGINT", () => { try { child.kill("SIGINT"); } catch(_){} cleanup(0); });
process.on("SIGTERM", () => { try { child.kill("SIGTERM"); } catch(_){} cleanup(0); });
process.on("exit", () => cleanup());

child.stdout.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  process.stdout.write(text);
  if (text.includes("Restoration studio app listening")) {
    process.stdout.write(`[test-server] tmp_dir=${tmpDir}\n`);
    process.stdout.write(`[test-server] tmp_db=${tmpDbPath}\n`);
    process.stdout.write(`[test-server] port=${port}\n`);
    process.stdout.write(`[test-server] ready=1\n`);
  }
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk.toString("utf8"));
});

child.on("exit", (code) => {
  cleanup(code || 0);
});
