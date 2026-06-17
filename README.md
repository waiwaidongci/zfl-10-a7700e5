# 古籍修复工作室

## 启动

```bash
npm start
```

访问 `http://localhost:3010`。项目包含简单登录视角、项目新增、状态更新、逾期提示和负责人工作量统计。

真实数据文件位置：`data/restoration.json`。

## 工程化测试（不污染真实数据）

本项目内置一套基于独立临时数据文件的 API 级回归测试方案，所有写入操作都在自动清理的临时目录中完成，不会影响 `data/restoration.json`。

### 可用命令

| 命令 | 说明 |
| --- | --- |
| `npm test` | **默认入口**：启动临时数据服务 + 运行 API 回归检查（端口 3099） |
| `npm run test:api` | 同 `npm test`，显式别名 |
| `npm run test:schedule` | 仅运行 `scripts/test-scheduling.mjs` 中的调度纯函数单元测试（node --test） |
| `npm run test:all` | 依次执行 API 回归检查 + 调度单元测试 |
| `npm run start:test` | 仅启动使用临时数据的服务器（不会自动运行测试），便于手动调试 |

### 覆盖的检查点

`npm test` 覆盖三类回归检查：

1. **读接口回归**
   - `GET /api/users`、`/api/projects`、`/api/materials`、`/api/intakes`、`/api/templates` 正常返回列表
   - 所有读响应都携带 `X-Data-Version` 响应头

2. **写操作必须携带 `X-Data-Version` 请求头**
   - `POST /api/projects` 未携带头 → 返回 `400 missing_data_version`
   - `PATCH /api/projects/:id` 未携带头 → 返回 `400 missing_data_version`
   - `POST /api/intakes` 未携带头 → 返回 `400 missing_data_version`
   - `POST /api/templates` 未携带头 → 返回 `400 missing_data_version`

3. **并发写入冲突返回 409**
   - 第一次携带版本号写入成功（201），服务端版本号递增
   - 第二次继续使用过期版本号写入 → 返回 `409 data_version_conflict`，并包含 `clientDataVersion` / `serverDataVersion`
   - `PATCH` 使用过期版本号同样触发 409
   - 客户端刷新到最新版本号后可继续写入

### 工作原理

```
npm test
  └─ scripts/api-test-suite.mjs
       ├─ spawn scripts/run-test-server.mjs  (子进程)
       │    ├─ 在 .test-tmp/test-run-XXXXXX/ 下构造独立 restoration.json（种子数据）
       │    ├─ 设置 DB_PATH / PORT=3099 环境变量
       │    └─ 启动 server.js，输出 ready=1 后通知父进程
       ├─ 等待 ready=1
       ├─ 对 http://127.0.0.1:3099 依次发起 HTTP 请求进行断言
       ├─ 打印彩色汇总（通过/失败数量）
       └─ 终止子进程 → 子进程 on exit 自动 rm -rf 临时目录
```

可通过环境变量 `TEST_PORT=4010 npm test` 指定其它端口。

### 关键实现文件

- 数据路径可配置：[`src/db.js`](file:///Users/ali/Desktop/zfl%20%20new%20solo%20coder/zfl-10/src/db.js)（读取 `process.env.DB_PATH`）
- 临时服务启动器：[`scripts/run-test-server.mjs`](file:///Users/ali/Desktop/zfl%20%20new%20solo%20coder/zfl-10/scripts/run-test-server.mjs)
- API 回归测试：[`scripts/api-test-suite.mjs`](file:///Users/ali/Desktop/zfl%20%20new%20solo%20coder/zfl-10/scripts/api-test-suite.mjs)
- 调度单元测试：[`scripts/test-scheduling.mjs`](file:///Users/ali/Desktop/zfl%20%20new%20solo%20coder/zfl-10/scripts/test-scheduling.mjs)

