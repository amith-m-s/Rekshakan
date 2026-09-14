import { db } from "../db/index.js";
import { seed } from "../seed/index.js";

// Startup seeding for hosted deploys (see render.yaml). `seed()` deletes every table first, so only run
// it when the database has no users: a fresh or ephemeral disk gets demo data, a persistent one is left alone.
const { n } = db().prepare("SELECT COUNT(*) AS n FROM users").get() as {
  n: number;
};

if (n > 0) {
  console.log(`Seed skipped: database already has ${n} users.`);
} else {
  seed().then((x) => console.log("Seed complete:", x));
}
