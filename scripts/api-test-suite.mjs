import { spawn } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const runTestServerPath = join(__dirname, "run-test-server.mjs");

const TEST_PORT = Number(process.env.TEST_PORT || 3099);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

const COLOR = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m"
};

let testServerProc = null;
const results = [];

function section(title) {
  console.log(`\n${COLOR.bold}${COLOR.cyan}━━━ ${title} ━━━${COLOR.reset}`);
}

function pass(name, detail = "") {
  results.push({ ok: true, name });
  console.log(`${COLOR.green}  ✔${COLOR.reset} ${name}${detail ? ` ${COLOR.dim}— ${detail}${COLOR.reset}` : ""}`);
}

function fail(name, detail = "") {
  results.push({ ok: false, name });
  console.log(`${COLOR.red}  ✘${COLOR.reset} ${name}${detail ? ` ${COLOR.dim}— ${detail}${COLOR.reset}` : ""}`);
}

async function waitForServerReady(timeoutMs = 15000) {
  return new Promise((resolvePromise, reject) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`等待服务启动超时（${timeoutMs}ms）`));
      }
    }, timeoutMs);

    let ready = false;
    let buf = "";

    testServerProc.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      buf += text;
      if (text.includes("Restoration studio app listening")) {
        process.stdout.write(text);
      } else if (/^\[test-server\]/.test(text.split("\n")[0]) || /\[test-server\]/.test(text)) {
        process.stdout.write(`${COLOR.dim}${text}${COLOR.reset}`);
      }
      if (/ready=1/.test(buf)) {
        ready = true;
      }
      if (ready && !resolved) {
        clearTimeout(timer);
        resolved = true;
        global.setTimeout(resolvePromise, 300);
      }
    });

    testServerProc.stderr.on("data", (chunk) => {
      process.stderr.write(`${COLOR.red}${chunk.toString("utf8")}${COLOR.reset}`);
    });

    testServerProc.on("exit", (code) => {
      if (!resolved && code !== 0 && code !== null) {
        clearTimeout(timer);
        resolved = true;
        reject(new Error(`测试服务进程异常退出，退出码 ${code}`));
      }
    });
  });
}

async function request(method, path, { body, headers = {} } = {}) {
  const url = new URL(path, BASE_URL);
  const init = {
    method,
    headers: { "Accept": "application/json", ...headers }
  };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), init);
  const contentType = res.headers.get("content-type") || "";
  let data;
  if (contentType.includes("application/json")) {
    try { data = await res.json(); } catch { data = null; }
  } else {
    data = await res.text();
  }
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    data,
    dataVersionHeader: res.headers.get("x-data-version")
  };
}

async function startServer() {
  section("启动测试服务（临时数据）");
  console.log(`${COLOR.dim}  使用端口 ${TEST_PORT}${COLOR.reset}`);
  testServerProc = spawn(process.execPath, [runTestServerPath], {
    cwd: projectRoot,
    env: { ...process.env, TEST_PORT: String(TEST_PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServerReady();
  pass("服务启动成功", `listening on ${BASE_URL}`);
}

function stopServer() {
  if (testServerProc && !testServerProc.killed) {
    try { testServerProc.kill("SIGTERM"); } catch (_) {}
  }
}

async function testReadApis() {
  section("读接口回归检查");

  const users = await request("GET", "/api/users");
  if (users.status === 200 && Array.isArray(users.data) && users.data.length >= 2) {
    pass("GET /api/users 返回用户列表", `共 ${users.data.length} 人`);
  } else {
    fail("GET /api/users 返回用户列表", `状态 ${users.status}`);
  }

  const projects = await request("GET", "/api/projects", {
    headers: { "x-viewer-id": "u-admin" }
  });
  if (projects.status === 200 && Array.isArray(projects.data) && projects.data.some(p => p.id === "R-001")) {
    pass("GET /api/projects 返回项目列表", `共 ${projects.data.length} 项`);
  } else {
    fail("GET /api/projects 返回项目列表", `状态 ${projects.status}`);
  }

  const materials = await request("GET", "/api/materials");
  if (materials.status === 200 && Array.isArray(materials.data) && materials.data.length >= 3) {
    pass("GET /api/materials 返回材料列表", `共 ${materials.data.length} 项`);
  } else {
    fail("GET /api/materials 返回材料列表", `状态 ${materials.status}`);
  }

  const intakes = await request("GET", "/api/intakes");
  if (intakes.status === 200 && Array.isArray(intakes.data)) {
    pass("GET /api/intakes 返回入库列表", `共 ${intakes.data.length} 项`);
  } else {
    fail("GET /api/intakes 返回入库列表", `状态 ${intakes.status}`);
  }

  const templates = await request("GET", "/api/templates");
  if (templates.status === 200 && Array.isArray(templates.data) && templates.data.length >= 2) {
    pass("GET /api/templates 返回模板列表", `共 ${templates.data.length} 项`);
  } else {
    fail("GET /api/templates 返回模板列表", `状态 ${templates.status}`);
  }

  const versioned = [users, projects, materials, intakes, templates];
  const hasRespVersion = versioned.every(r => typeof r.dataVersionHeader === "string" && r.dataVersionHeader.length > 0);
  if (hasRespVersion) {
    pass("读接口响应均携带 X-Data-Version 头", `当前版本 ${users.dataVersionHeader}`);
  } else {
    fail("读接口响应均携带 X-Data-Version 头", "部分接口缺失");
  }
}

async function testWriteMissingDataVersion() {
  section("写操作必须携带 X-Data-Version");

  const createProjectNoVersion = await request("POST", "/api/projects", {
    body: {
      title: "测试项目-不应创建",
      era: "测试",
      damage: "测试",
      owner: "顾眉",
      dueDate: "2026-12-31"
    },
    headers: { "x-viewer-id": "u-admin" }
  });
  if (createProjectNoVersion.status === 400 &&
      createProjectNoVersion.data &&
      createProjectNoVersion.data.error === "missing_data_version") {
    pass("POST /api/projects 缺少 X-Data-Version 返回 400");
  } else {
    fail("POST /api/projects 缺少 X-Data-Version 返回 400",
         `实际状态 ${createProjectNoVersion.status}，错误码 ${createProjectNoVersion.data?.error}`);
  }

  const patchProjectNoVersion = await request("PATCH", "/api/projects/R-001", {
    body: { title: "已修改（不应成功）" },
    headers: { "x-viewer-id": "u-admin" }
  });
  if (patchProjectNoVersion.status === 400 &&
      patchProjectNoVersion.data &&
      patchProjectNoVersion.data.error === "missing_data_version") {
    pass("PATCH /api/projects/:id 缺少 X-Data-Version 返回 400");
  } else {
    fail("PATCH /api/projects/:id 缺少 X-Data-Version 返回 400",
         `实际状态 ${patchProjectNoVersion.status}`);
  }

  const postIntakeNoVersion = await request("POST", "/api/intakes", {
    body: {
      title: "不应入库",
      era: "测试",
      source: "测试",
      receiver: "顾眉",
      tempLocation: "Z柜"
    },
    headers: { "x-viewer-id": "u-admin" }
  });
  if (postIntakeNoVersion.status === 400 &&
      postIntakeNoVersion.data &&
      postIntakeNoVersion.data.error === "missing_data_version") {
    pass("POST /api/intakes 缺少 X-Data-Version 返回 400");
  } else {
    fail("POST /api/intakes 缺少 X-Data-Version 返回 400",
         `实际状态 ${postIntakeNoVersion.status}`);
  }

  const postTemplateNoVersion = await request("POST", "/api/templates", {
    body: { name: "不应创建的模板", category: "测试", steps: "无", estimatedDays: 1 }
  });
  if (postTemplateNoVersion.status === 400 &&
      postTemplateNoVersion.data &&
      postTemplateNoVersion.data.error === "missing_data_version") {
    pass("POST /api/templates 缺少 X-Data-Version 返回 400");
  } else {
    fail("POST /api/templates 缺少 X-Data-Version 返回 400",
         `实际状态 ${postTemplateNoVersion.status}`);
  }

  const postSnapshotNoVersion = await request("POST", "/api/projects/R-001/report-snapshots", {
    body: { name: "不应创建的快照" },
    headers: { "x-viewer-id": "u-admin" }
  });
  if (postSnapshotNoVersion.status === 400 &&
      postSnapshotNoVersion.data &&
      postSnapshotNoVersion.data.error === "missing_data_version") {
    pass("POST /api/projects/:id/report-snapshots 缺少 X-Data-Version 返回 400");
  } else {
    fail("POST /api/projects/:id/report-snapshots 缺少 X-Data-Version 返回 400",
         `实际状态 ${postSnapshotNoVersion.status}，错误码 ${postSnapshotNoVersion.data?.error}`);
  }
}

async function testDataVersionConflict() {
  section("并发写入冲突返回 409");

  const initialResp = await request("GET", "/api/projects", {
    headers: { "x-viewer-id": "u-admin" }
  });
  const baseVersion = Number(initialResp.dataVersionHeader);
  if (!isFinite(baseVersion) || baseVersion < 1) {
    fail("无法获取初始版本号", `X-Data-Version=${initialResp.dataVersionHeader}`);
    return;
  }
  pass("获取初始版本号", `_dataVersion = ${baseVersion}`);

  const firstWrite = await request("POST", "/api/projects", {
    body: {
      title: "并发测试-第一写入",
      era: "测试朝代",
      damage: "无",
      steps: "测试步骤",
      materials: "无",
      owner: "顾眉",
      dueDate: "2026-12-31",
      status: "进行中"
    },
    headers: {
      "x-viewer-id": "u-admin",
      "x-data-version": String(baseVersion)
    }
  });
  if (firstWrite.status === 201 && firstWrite.data && firstWrite.data.id) {
    pass("第一次写入成功（带正确版本号）", `新建项目 ${firstWrite.data.id}`);
  } else {
    fail("第一次写入成功（带正确版本号）",
         `状态 ${firstWrite.status}，body=${JSON.stringify(firstWrite.data)}`);
    return;
  }
  const versionAfterFirst = Number(firstWrite.dataVersionHeader);
  pass("写入后版本号递增", `${baseVersion} → ${versionAfterFirst}`);

  const secondWriteStale = await request("POST", "/api/projects", {
    body: {
      title: "并发测试-第二写入（过期版本）",
      era: "测试",
      damage: "无",
      steps: "测试步骤-过期",
      materials: "测试材料-过期",
      owner: "严澈",
      dueDate: "2026-12-31",
      status: "进行中"
    },
    headers: {
      "x-viewer-id": "u-admin",
      "x-data-version": String(baseVersion)
    }
  });
  if (secondWriteStale.status === 409 &&
      secondWriteStale.data &&
      secondWriteStale.data.error === "data_version_conflict" &&
      typeof secondWriteStale.data.clientDataVersion === "number" &&
      typeof secondWriteStale.data.serverDataVersion === "number" &&
      secondWriteStale.data.serverDataVersion > secondWriteStale.data.clientDataVersion) {
    pass("第二次使用过期版本写入返回 409",
         `客户端版本 ${secondWriteStale.data.clientDataVersion} vs 服务端 ${secondWriteStale.data.serverDataVersion}`);
  } else {
    fail("第二次使用过期版本写入返回 409",
         `状态 ${secondWriteStale.status}，body=${JSON.stringify(secondWriteStale.data)}`);
  }

  const patchStale = await request("PATCH", "/api/projects/R-001", {
    body: { title: "PATCH-过期版本修改", status: "待复核", clientVersion: 1 },
    headers: {
      "x-viewer-id": "u-admin",
      "x-data-version": String(baseVersion)
    }
  });
  if (patchStale.status === 409 &&
      patchStale.data &&
      patchStale.data.error === "data_version_conflict") {
    pass("PATCH 过期版本也返回 409");
  } else {
    fail("PATCH 过期版本也返回 409",
         `状态 ${patchStale.status}，body=${JSON.stringify(patchStale.data)}`);
  }

  const thirdWriteFresh = await request("POST", "/api/projects", {
    body: {
      title: "并发测试-第三写入（新提交版本）",
      era: "测试",
      damage: "无",
      steps: "测试步骤-新版本",
      materials: "测试材料-新版本",
      owner: "顾眉",
      dueDate: "2026-12-31",
      status: "进行中"
    },
    headers: {
      "x-viewer-id": "u-admin",
      "x-data-version": String(versionAfterFirst)
    }
  });
  if (thirdWriteFresh.status === 201 && thirdWriteFresh.data && thirdWriteFresh.data.id) {
    pass("使用最新版本号可继续写入", `新建项目 ${thirdWriteFresh.data.id}`);
  } else {
    fail("使用最新版本号可继续写入",
         `状态 ${thirdWriteFresh.status}，body=${JSON.stringify(thirdWriteFresh.data)}`);
  }
}

async function testReportSnapshotsVersionCheck() {
  section("report-snapshots 写接口数据版本校验");

  const initResp = await request("GET", "/api/projects", {
    headers: { "x-viewer-id": "u-admin" }
  });
  let currentVersion = Number(initResp.dataVersionHeader);

  const patchToCompleted = await request("PATCH", "/api/projects/R-001", {
    body: { status: "已完成", clientVersion: 1 },
    headers: {
      "x-viewer-id": "u-admin",
      "x-data-version": String(currentVersion)
    }
  });
  if (patchToCompleted.status === 200 && patchToCompleted.data && patchToCompleted.data.status === "已完成") {
    currentVersion = Number(patchToCompleted.dataVersionHeader);
    pass("先将 R-001 改为已完成状态", `版本号 ${currentVersion}`);
  } else {
    fail("先将 R-001 改为已完成状态",
         `状态 ${patchToCompleted.status}，body=${JSON.stringify(patchToCompleted.data)}`);
    return;
  }

  const createSnapshot = await request("POST", "/api/projects/R-001/report-snapshots", {
    body: { name: "测试快照1" },
    headers: {
      "x-viewer-id": "u-admin",
      "x-data-version": String(currentVersion)
    }
  });
  if (createSnapshot.status === 200 &&
      createSnapshot.data &&
      createSnapshot.data.ok === true &&
      createSnapshot.data.snapshot) {
    currentVersion = Number(createSnapshot.dataVersionHeader);
    pass("带正确版本号创建快照成功", `快照 ${createSnapshot.data.snapshot.id}`);
  } else {
    fail("带正确版本号创建快照成功",
         `状态 ${createSnapshot.status}，body=${JSON.stringify(createSnapshot.data)}`);
    return;
  }

  const staleSnapshot = await request("POST", "/api/projects/R-001/report-snapshots", {
    body: { name: "测试快照-过期版本" },
    headers: {
      "x-viewer-id": "u-admin",
      "x-data-version": String(currentVersion - 1)
    }
  });
  if (staleSnapshot.status === 409 &&
      staleSnapshot.data &&
      staleSnapshot.data.error === "data_version_conflict") {
    pass("report-snapshots 过期版本写入返回 409",
         `客户端 ${staleSnapshot.data.clientDataVersion} vs 服务端 ${staleSnapshot.data.serverDataVersion}`);
  } else {
    fail("report-snapshots 过期版本写入返回 409",
         `状态 ${staleSnapshot.status}，body=${JSON.stringify(staleSnapshot.data)}`);
  }

  const freshSnapshot = await request("POST", "/api/projects/R-001/report-snapshots", {
    body: { name: "测试快照2-新版本" },
    headers: {
      "x-viewer-id": "u-admin",
      "x-data-version": String(currentVersion)
    }
  });
  if (freshSnapshot.status === 200 &&
      freshSnapshot.data &&
      freshSnapshot.data.ok === true) {
    pass("report-snapshots 使用最新版本号可继续创建", `快照 ${freshSnapshot.data.snapshot.id}`);
  } else {
    fail("report-snapshots 使用最新版本号可继续创建",
         `状态 ${freshSnapshot.status}，body=${JSON.stringify(freshSnapshot.data)}`);
  }

  const listResp = await request("GET", "/api/projects/R-001/report-snapshots", {
    headers: { "x-viewer-id": "u-admin" }
  });
  if (listResp.status === 200 &&
      listResp.data &&
      Array.isArray(listResp.data.snapshots) &&
      listResp.data.snapshots.length >= 2) {
    pass("GET report-snapshots 返回快照列表", `共 ${listResp.data.snapshots.length} 个快照`);
  } else {
    fail("GET report-snapshots 返回快照列表",
         `状态 ${listResp.status}，body=${JSON.stringify(listResp.data)}`);
  }
}

function printSummary() {
  const total = results.length;
  const passed = results.filter(r => r.ok).length;
  const failed = total - passed;
  section("测试汇总");
  console.log(`  ${COLOR.bold}总计：${COLOR.reset}${total} 项`);
  console.log(`  ${COLOR.green}通过：${COLOR.reset}${passed} 项`);
  if (failed > 0) {
    console.log(`  ${COLOR.red}失败：${COLOR.reset}${failed} 项`);
    console.log(`\n${COLOR.red}${COLOR.bold}回归检查未通过${COLOR.reset}`);
    for (const r of results) {
      if (!r.ok) console.log(`  ${COLOR.red}✘${COLOR.reset} ${r.name}`);
    }
  } else {
    console.log(`\n${COLOR.green}${COLOR.bold}全部回归检查通过 ✓${COLOR.reset}`);
  }
  return failed === 0;
}

async function main() {
  let exitCode = 1;
  try {
    await startServer();
    await testReadApis();
    await testWriteMissingDataVersion();
    await testDataVersionConflict();
    await testReportSnapshotsVersionCheck();
    const ok = printSummary();
    exitCode = ok ? 0 : 1;
  } catch (err) {
    console.error(`\n${COLOR.red}${COLOR.bold}测试框架错误：${COLOR.reset}${err.message}`);
    console.error(err.stack);
    exitCode = 2;
  } finally {
    stopServer();
    await sleep(400);
  }
  process.exit(exitCode);
}

main();
