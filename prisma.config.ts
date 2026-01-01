import path from "node:path";
import { defineConfig } from "prisma/config";

process.loadEnvFile(path.join(__dirname, ".env"));

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
      seed: "ts-node -r tsconfig-paths/register src/scripts/prisma/seed.ts",
    },
});
