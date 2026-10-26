import { existsSync } from "node:fs";
import { resolve } from "node:path";

// load the ignored local env file when present without printing its contents.
export function loadLocalEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}
