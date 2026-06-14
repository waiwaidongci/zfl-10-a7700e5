export function getViewer(db, viewerId) {
  return db.users.find((u) => u.id === viewerId) || null;
}

export function filterProjectsByPermission(db, viewerId) {
  const viewer = getViewer(db, viewerId);
  if (!viewer) return [];
  if (viewer.role === "admin") return db.projects;
  return db.projects.filter((p) => p.owner === viewer.name);
}

export function isOverdue(project) {
  if (!project.dueDate) return false;
  if (project.status === "已完成") return false;
  const due = new Date(project.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

export function isPendingReview(project) {
  return project.status === "待复核";
}
