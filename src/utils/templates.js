import { bumpVersion as newBumpVersion, createSnapshot as newCreateSnapshot } from "./templateSnapshots.js";
import { validateTemplate as newValidateTemplate } from "./validation.js";

export function validateTemplate(input) {
  return newValidateTemplate(input);
}

export function bumpVersion(template) {
  return newBumpVersion(template);
}

export function createSnapshot(template) {
  return newCreateSnapshot(template);
}
