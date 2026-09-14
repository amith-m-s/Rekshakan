import { seed } from "../seed/index.js";
seed().then((x) => console.log("Seed complete:", x));
