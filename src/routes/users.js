import { sendJson } from "../db.js";

export function handleUsers(req, res, db) {
  if (req.method === "GET") {
    return sendJson(res, 200, db.users);
  }
  return false;
}
