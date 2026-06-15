import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'restoration.json');

const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

const TEST_PROJECT_ID = 'R-1781494344255';
const TEST_PROJECT_TITLE = '测试审计项目';

const originalProjectCount = data.projects.length;
const originalAuditCount = data.auditLogs ? data.auditLogs.length : 0;

data.projects = data.projects.filter(p => 
  p.id !== TEST_PROJECT_ID && p.title !== TEST_PROJECT_TITLE
);

if (data.auditLogs) {
  data.auditLogs = data.auditLogs.filter(log => 
    log.projectId !== TEST_PROJECT_ID
  );
}

const removedProjects = originalProjectCount - data.projects.length;
const removedAuditLogs = originalAuditCount - (data.auditLogs ? data.auditLogs.length : 0);

fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');

console.log(`清理完成：`);
console.log(`  - 删除了 ${removedProjects} 个测试项目`);
console.log(`  - 删除了 ${removedAuditLogs} 条审计日志`);
console.log(`  - 剩余项目数：${data.projects.length}`);
console.log(`  - 剩余审计日志数：${data.auditLogs ? data.auditLogs.length : 0}`);
