import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const CONTRACTS = [
  { name: "Wadoozie", path: "contracts/Wadoozie.sol" },
  { name: "WadoozieTreasury", path: "contracts/WadoozieTreasury.sol" },
  { name: "Headquarters", path: "contracts/Headquarters.sol" },
  { name: "WadoozieDisperser", path: "contracts/WadoozieDisperser.sol" },
];

const OUT_DIR = "contracts-flat";
const SOLC_VERSION = "0.8.28";

mkdirSync(OUT_DIR, { recursive: true });

for (const { name, path } of CONTRACTS) {
  console.log(`Flattening ${path}...`);
  const raw = execSync(`npx hardhat flatten ${path}`, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  const cleaned = [];
  let seenSpdx = false;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!seenSpdx && !t.startsWith("// SPDX-License-Identifier:")) continue;
    if (t.startsWith("// SPDX-License-Identifier:")) {
      if (seenSpdx) continue;
      seenSpdx = true;
      cleaned.push(line);
      continue;
    }
    if (t.startsWith("pragma solidity")) continue;
    if (t.startsWith("// Original license: SPDX_License_Identifier:")) continue;
    if (t.startsWith("// Sources flattened with hardhat")) continue;
    cleaned.push(line);
  }

  const idx = cleaned.findIndex((l) =>
    l.trim().startsWith("// SPDX-License-Identifier:"),
  );
  cleaned.splice(idx + 1, 0, "", `pragma solidity ${SOLC_VERSION};`);

  const out = cleaned.join("\n").replace(/\n{3,}/g, "\n\n");
  const outPath = `${OUT_DIR}/${name}.sol`;
  writeFileSync(outPath, out);
  console.log(`  → ${outPath} (${out.length} bytes)`);
}

console.log("\nDone.");
