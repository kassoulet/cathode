// Copy the shared CRTEmulation-Data assets into the package for `npm pack`.
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "../../assets/crt");
const destination = path.resolve(here, "../assets/crt");

await rm(destination, { recursive: true, force: true });
await mkdir(path.dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });
console.log(`crt-canvas: copied ${source} -> ${destination}`);
