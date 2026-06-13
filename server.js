import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "restoration.json");
const port = Number(process.env.PORT || 3010);

const seed = {
  users: [
    { id: "u-admin", name: "管理员", role: "admin" },
    { id: "u-mei", name: "顾眉", role: "worker" },
    { id: "u-yan", name: "严澈", role: "worker" }
  ],
  projects: [
    { id: "R-001", title: "明代族谱散页", era: "明代", damage: "虫蛀、边角缺失", steps: "清洁、补纸、压平", materials: "楮皮纸、小麦淀粉浆", owner: "顾眉", dueDate: "2026-06-22", status: "进行中", photos: "https://images.unsplash.com/photo-1524995997946-a1c2e315a42f", updatedAt: "2026-06-11" },
    { id: "R-002", title: "清刻本医书", era: "清代", damage: "水渍、书脊松散", steps: "拆线、干洗、重装", materials: "棉线、宣纸", owner: "严澈", dueDate: "2026-06-12", status: "待复核", photos: "", updatedAt: "2026-06-10" }
  ]
};

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古籍修复工作室</title>
  <style>
    :root { color-scheme: light; --ink:#242424; --line:#d8d2c7; --paper:#faf7f0; --accent:#2f6f73; --warn:#a84b2f; }
    * { box-sizing: border-box; } body { margin:0; font-family: Arial, "PingFang SC", sans-serif; color:var(--ink); background:var(--paper); }
    header { padding:24px 28px 12px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:end; }
    h1 { margin:0; font-size:28px; } main { display:grid; grid-template-columns: 360px 1fr; gap:22px; padding:22px 28px; }
    form, .panel { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; font-size:13px; margin:10px 0 5px; color:#5d574e; } input, select, textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; }
    textarea { min-height:78px; resize:vertical; } button { border:0; border-radius:6px; background:var(--accent); color:white; padding:10px 13px; font-weight:700; cursor:pointer; }
    .stats { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px; } .stat { background:#fff; border:1px solid var(--line); border-radius:8px; padding:12px; }
    .stat strong { display:block; font-size:24px; } .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(270px,1fr)); gap:12px; }
    article { background:#fff; border:1px solid var(--line); border-radius:8px; padding:14px; display:grid; gap:8px; }
    article.overdue { border-color:var(--warn); } .meta { color:#6b6258; font-size:13px; } .row { display:flex; justify-content:space-between; gap:10px; align-items:center; }
    .pill { border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; } .danger { color:var(--warn); font-weight:700; }
    @media (max-width: 820px) { main { grid-template-columns:1fr; padding:16px; } header { padding:18px 16px 10px; display:block; } .stats { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <header>
    <div><h1>古籍修复工作室</h1><div class="meta">项目接收、过程记录、负责人工作量</div></div>
    <select id="viewer"></select>
  </header>
  <main>
    <form id="form">
      <h2>新增修复项目</h2>
      <label>藏品名称</label><input name="title" required>
      <label>年代</label><input name="era" required>
      <label>破损类型</label><input name="damage" required>
      <label>修复步骤</label><textarea name="steps" required></textarea>
      <label>使用材料</label><textarea name="materials" required></textarea>
      <label>负责人</label><input name="owner" required>
      <label>预计完成日期</label><input name="dueDate" type="date" required>
      <label>照片链接</label><input name="photos">
      <button>保存项目</button>
    </form>
    <section>
      <div class="stats" id="stats"></div>
      <div class="grid" id="projects"></div>
    </section>
  </main>
  <script>
    const viewer = document.querySelector("#viewer");
    const form = document.querySelector("#form");
    const projectsEl = document.querySelector("#projects");
    const statsEl = document.querySelector("#stats");
    let users = [];
    let projects = [];

    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers: { "Content-Type": "application/json" } } : options);
      return res.json();
    }

    function isOverdue(project) {
      return project.status !== "已完成" && new Date(project.dueDate) < new Date(new Date().toISOString().slice(0, 10));
    }

    function render() {
      const user = users.find((item) => item.id === viewer.value) || users[0];
      const visible = user.role === "admin" ? projects : projects.filter((item) => item.owner === user.name);
      const active = projects.filter((item) => item.status !== "已完成").length;
      const overdue = projects.filter(isOverdue).length;
      const workload = projects.reduce((map, item) => (map[item.owner] = (map[item.owner] || 0) + 1, map), {});
      statsEl.innerHTML = '<div class="stat"><span>进行中</span><strong>'+active+'</strong></div><div class="stat"><span>逾期</span><strong>'+overdue+'</strong></div><div class="stat"><span>负责人工作量</span><strong>'+Object.entries(workload).map(([k,v])=>k+v).join(" / ")+'</strong></div>';
      projectsEl.innerHTML = visible.map((p) => '<article class="'+(isOverdue(p) ? 'overdue' : '')+'"><div class="row"><h3>'+p.title+'</h3><span class="pill">'+p.status+'</span></div><div class="meta">'+p.era+' · '+p.owner+' · '+p.dueDate+'</div><div><b>破损</b> '+p.damage+'</div><div><b>步骤</b> '+p.steps+'</div><div><b>材料</b> '+p.materials+'</div>'+(isOverdue(p)?'<div class="danger">已超过预计完成日期</div>':'')+'<select data-id="'+p.id+'"><option>进行中</option><option>待复核</option><option>已完成</option></select></article>').join("");
      document.querySelectorAll("article select").forEach((select) => {
        const project = projects.find((item) => item.id === select.dataset.id);
        select.value = project.status;
        select.onchange = async () => { await api('/api/projects/'+project.id, { method:'PATCH', body: JSON.stringify({ status: select.value }) }); await load(); };
      });
    }

    async function load() {
      users = await api("/api/users");
      projects = await api("/api/projects");
      viewer.innerHTML = users.map((u) => '<option value="'+u.id+'">'+u.name+' · '+u.role+'</option>').join("");
      if (!viewer.value) viewer.value = users[0].id;
      render();
    }

    viewer.onchange = render;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      await api("/api/projects", { method: "POST", body: JSON.stringify(data) });
      form.reset();
      await load();
    };
    load();
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page);
    }
    if (req.method === "GET" && url.pathname === "/api/users") return sendJson(res, 200, db.users);
    if (req.method === "GET" && url.pathname === "/api/projects") return sendJson(res, 200, db.projects);
    if (req.method === "POST" && url.pathname === "/api/projects") {
      const input = await body(req);
      const project = { id: `R-${Date.now()}`, status: "进行中", updatedAt: new Date().toISOString().slice(0, 10), ...input };
      db.projects.unshift(project);
      await saveDb(db);
      return sendJson(res, 201, project);
    }
    const match = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (match && req.method === "PATCH") {
      const project = db.projects.find((item) => item.id === match[1]);
      if (!project) return sendJson(res, 404, { error: "project_not_found" });
      Object.assign(project, await body(req), { updatedAt: new Date().toISOString().slice(0, 10) });
      await saveDb(db);
      return sendJson(res, 200, project);
    }
    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Restoration studio app listening on http://localhost:${port}`);
});
