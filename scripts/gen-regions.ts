import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLandPolygons } from "../src/globe/land-data";
import { buildLandTester, generateRegions } from "../src/globe/regions-gen";

const isLand = buildLandTester(loadLandPolygons());
const regions = generateRegions(isLand);

const outPath = resolve(import.meta.dirname, "../src/globe/regions.json");
writeFileSync(outPath, `${JSON.stringify(regions, null, 2)}\n`);
console.log(`wrote ${outPath}`);
console.log(
  `countries: ${regions.countries.length}, candidates per country: ${regions.countries[0]?.candidates.length}`,
);
