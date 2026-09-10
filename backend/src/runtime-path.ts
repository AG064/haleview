import { homedir } from "node:os";
import { resolve } from "node:path";

export function dataFilePath(): string {
  return resolve(
    process.env.DATA_FILE?.trim() ||
      resolve(homedir(), ".haleview", "haleview.db"),
  );
}
