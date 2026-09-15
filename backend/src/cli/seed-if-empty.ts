import { closeDb, db } from "../db/index.js";
import { seedAccountsOnly, seedDemoOperation } from "../seed/index.js";
import { DEMO_GEOGRAPHY } from "../config/geography.js";

function alignLegacyDemoGeography() {
  const database = db();
  const { latitude, longitude } = DEMO_GEOGRAPHY.legacyOffset;
  const tables = [
    "incidents",
    "locations",
    "help_requests",
    "shelters",
    "community_reports",
    "safe_checkins",
    "audit_logs",
  ];
  let moved = 0;
  database.transaction(() => {
    for (const table of tables) {
      moved += database
        .prepare(
          `UPDATE ${table} SET latitude=latitude+?, longitude=longitude+? WHERE latitude BETWEEN 12 AND 14 AND longitude BETWEEN 76 AND 79`,
        )
        .run(latitude, longitude).changes;
    }
    database
      .prepare(
        "UPDATE incidents SET name='Santa Cruz Mountains Wildfire', description='Simulated California wildfire for the unified RescuerMap demo' WHERE name='Bannerghatta Ridge Fire'",
      )
      .run();
    database
      .prepare(
        "UPDATE shelters SET name='Santa Cruz Valley Relief Centre' WHERE name='South Campus Relief Centre'",
      )
      .run();
    const simulator = database
      .prepare("SELECT config FROM simulator_state WHERE id='primary'")
      .get() as { config: string } | undefined;
    if (simulator) {
      const config = JSON.parse(simulator.config);
      if (
        config.latitude >= 12 &&
        config.latitude <= 14 &&
        config.longitude >= 76 &&
        config.longitude <= 79
      ) {
        config.latitude += latitude;
        config.longitude += longitude;
        database
          .prepare("UPDATE simulator_state SET config=? WHERE id='primary'")
          .run(JSON.stringify(config));
      }
    }
  })();
  if (moved)
    console.log(`Aligned ${moved} legacy demo coordinates to California`);
}

async function main() {
  const users = db().prepare("SELECT count(*) AS count FROM users").get() as {
    count: number;
  };
  if (users.count === 0) {
    await seedAccountsOnly();
    console.log("Seeded RescuerMap demo accounts");
  } else {
    console.log(`Database already initialized with ${users.count} users`);
  }
  alignLegacyDemoGeography();
  const operation = seedDemoOperation() as any;
  if (operation)
    console.log(
      `Seeded minimal demo operation ${operation.incident_id} with request ${operation.id}`,
    );
  else console.log("Active operation already exists; demo seed skipped");
  closeDb();
}

main().catch((error) => {
  console.error("Database initialization failed", error);
  process.exitCode = 1;
});
