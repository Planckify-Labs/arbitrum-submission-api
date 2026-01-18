import path from "node:path";
import fs from "node:fs";
import { defineConfig } from "prisma/config";

// Only load .env file if it exists (not in Docker production)
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    seed: "ts-node -r tsconfig-paths/register src/scripts/prisma/seed.ts",
  },
});
