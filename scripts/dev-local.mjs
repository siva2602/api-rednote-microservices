/**
 * Local dev without Docker — starts embedded Postgres, migrates, then runs the API.
 * Reuses an existing cluster or running instance when possible.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root_dir = join(__dirname, "..");
const pg_dir = join(root_dir, "test", "fixtures", "pg-dev-data");
const pg_port = 5433;
const database_url = `postgresql://auth:auth@localhost:${pg_port}/auth_db`;

/** Returns true if embedded Postgres is already accepting connections. */
function is_postgres_running() {
  try {
    execSync(
      `PGPASSWORD=auth psql -h 127.0.0.1 -p ${pg_port} -U auth -d postgres -c "SELECT 1"`,
      { stdio: "pipe" },
    );
    return true;
  } catch {
    return false;
  }
}

/** Removes stale postmaster.pid if the owning process is no longer running. */
function clear_stale_lock() {
  const lock_file = join(pg_dir, "postmaster.pid");
  if (!existsSync(lock_file)) {
    return;
  }
  const pid_line = readFileSync(lock_file, "utf8").split("\n")[0]?.trim();
  const pid = Number(pid_line);
  if (!pid) {
    return;
  }
  try {
    process.kill(pid, 0);
  } catch {
    console.log("Removing stale Postgres lock file (previous process exited)");
    unlinkSync(lock_file);
  }
}

mkdirSync(pg_dir, { recursive: true });

let pg = null;
let owns_postgres = false;

if (is_postgres_running()) {
  console.log("Embedded Postgres already running on port", pg_port);
} else {
  pg = new EmbeddedPostgres({
    databaseDir: pg_dir,
    user: "auth",
    password: "auth",
    port: pg_port,
    persistent: true,
  });

  const cluster_initialized = existsSync(join(pg_dir, "PG_VERSION"));

  console.log("Starting embedded Postgres on port", pg_port, "...");

  if (!cluster_initialized) {
    await pg.initialise();
  } else {
    console.log("Reusing existing Postgres cluster in", pg_dir);
    clear_stale_lock();
  }

  await pg.start();
  owns_postgres = true;
  await pg.createDatabase("auth_db").catch(() => {});
}

process.env.DATABASE_URL = database_url;
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

execSync("npx prisma migrate deploy", {
  cwd: root_dir,
  env: { ...process.env, DATABASE_URL: database_url },
  stdio: "inherit",
});

console.log("Postgres ready. Starting auth service on port", process.env.PORT ?? 3001, "...");

const child = spawn("npx", ["tsx", "watch", "src/index.ts"], {
  cwd: root_dir,
  env: { ...process.env, DATABASE_URL: database_url },
  stdio: "inherit",
});

const shutdown = async () => {
  child.kill();
  if (owns_postgres && pg) {
    await pg.stop();
  }
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
child.on("exit", (code) => shutdown().then(() => process.exit(code ?? 0)));
