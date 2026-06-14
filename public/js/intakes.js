const form = document.querySelector("#intakeForm");
const intakesEl = document.querySelector("#intakes");
const statsEl = document.querySelector("#stats");

let intakes = [];

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(path, options) {
  const res = await fetch(path, options && options.body ? { ...options, headers: { "Content-Type": "application/json" } } : options);
  return res.json();
}

function statusClass(status) {
  if (status === "待修复") return "pending";
  if (status === "修复中") return "active";
  if (status === "已完成") return "done";
  return "";
}

function render() {
  const pending = intakes.filter((i) => i.status === "待修复").length;
  const active = intakes.filter((i) => i.status === "修复中").length;
  const total = intakes.length;

  statsEl.innerHTML =
    '<div class="stat"><span>待修复</span><strong>' + pending + '</strong></div>' +
    '<div class="stat"><span>修复中</span><strong>' + active + '</strong></div>' +
    '<div class="stat"><span>累计入库</span><strong>' + total + '</strong></div>';

  intakesEl.innerHTML = intakes.map((i) => (
    '<article>' +
    '<div class="row"><h3>' + escapeHtml(i.title) + '</h3><span class="pill ' + statusClass(i.status) + '">' + escapeHtml(i.status) + '</span></div>' +
    '<div class="meta">' + escapeHtml(i.era || '年代不详') + ' · 来源：' + escapeHtml(i.source || '未知') + '</div>' +
    '<div><b>接收人：</b>' + escapeHtml(i.receiver || '-') + '</div>' +
    '<div><b>接收时间：</b>' + escapeHtml(i.receivedAt || '-') + '</div>' +
    '<div><b>破损描述：</b>' + escapeHtml(i.damage || '-') + '</div>' +
    '<div><b>存放位置：</b>' + escapeHtml(i.tempLocation || '-') + '</div>' +
    '<div class="actions">' +
    '<button class="secondary" data-action="status" data-id="' + escapeHtml(i.id) + '">更新状态</button>' +
    '<button class="danger" data-action="delete" data-id="' + escapeHtml(i.id) + '">删除</button>' +
    '</div>' +
    '</article>'
  )).join("");

  document.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.onclick = async () => {
      if (confirm("确定删除这条入库记录吗？")) {
        await api('/api/intakes/' + btn.dataset.id, { method: 'DELETE' });
        await load();
      }
    };
  });

  document.querySelectorAll('[data-action="status"]').forEach((btn) => {
    btn.onclick = async () => {
      const intake = intakes.find((i) => i.id === btn.dataset.id);
      const statuses = ["待修复", "修复中", "已完成"];
      const nextIdx = (statuses.indexOf(intake.status) + 1) % statuses.length;
      await api('/api/intakes/' + intake.id, {
        method: 'PATCH',
        body: JSON.stringify({ status: statuses[nextIdx] })
      });
      await load();
    };
  });
}

async function load() {
  intakes = await api("/api/intakes");
  render();
}

form.onsubmit = async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  await api("/api/intakes", { method: "POST", body: JSON.stringify(data) });
  form.reset();
  await load();
};

load();
