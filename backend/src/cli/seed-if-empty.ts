import { closeDb, db } from "../db/index.js";
import { seed } from "../seed/index.js";

async function main() {
  const users = db().prepare("SELECT count(*) AS count FROM users").get() as {
    count: number;
  };
  if (users.count === 0) {
    await seed();
    console.log("Seeded initial RescuerMap demonstration data");
  } else {
    console.log(`Database already initialized with ${users.count} users`);
  }
  closeDb();
}

main().catch((error) => {
  console.error("Database initialization failed", error);
  process.exitCode = 1;
});
