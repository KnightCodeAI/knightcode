import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { schemaDocument } from "../src/index.ts";

const target = join(import.meta.dirname, "../../cli/docs/app-server.schema.json");
writeFileSync(target, `${JSON.stringify(schemaDocument(), null, "\t")}\n`);
console.log(`wrote ${target}`);
