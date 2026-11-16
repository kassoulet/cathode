// Tiny static server for the demo, rooted at the repository.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = Number(process.env.PORT ?? 8080);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".glsl": "text/plain; charset=utf-8",
  ".yml": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) throw new Error("outside root");

    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = path.join(file, "index.html");
      info = await stat(file).catch(() => null);
    }
    if (!info) {
      response.writeHead(404).end("not found");
      return;
    }

    const data = await readFile(file);
    response.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(data);
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});

server.listen(port, () => {
  console.log(`crt-canvas demo: http://localhost:${port}/js/demo/`);
});
