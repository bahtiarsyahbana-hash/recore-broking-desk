/**
 * Static dev server for the Recordes prototype.
 *
 * The app is plain ES modules with no build step — it only needs to be served
 * over HTTP rather than opened from the filesystem. Zero dependencies, so
 * `npm run dev` works with an empty node_modules and no network.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("../src", import.meta.url)));
const PORT = Number(process.env.PORT) || 4173;
/**
 * Loopback only — never the LAN. Both families are bound, because `localhost`
 * resolves to ::1 on some machines and 127.0.0.1 on others, and either address
 * should work whichever one the operator types.
 */
const HOSTS = process.env.HOST ? [process.env.HOST] : ["127.0.0.1", "::1"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico":  "image/x-icon",
};

/** Resolve a request path inside ROOT, refusing anything that escapes it. */
function resolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const full = join(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  return full;
}

async function handler(req, res) {
  let file = resolve(req.url === "/" ? "/index.html" : req.url);

  if (!file) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    // Directory requests fall through to their index.html.
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");

    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
      // Always revalidate: this is a dev server, edits must show on reload.
      "Cache-Control": "no-cache",
    }).end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
       .end(`404 — ${req.url} not found under src/`);
  }
}

console.log(`Recordes Reinsurance Broking Desk → http://localhost:${PORT}`);
console.log(`serving ${ROOT}`);

for (const host of HOSTS) {
  const server = createServer(handler);
  // A machine without one of the two loopback families is fine; the other binds.
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`port ${PORT} is already in use — stop the other server, or set PORT`);
      process.exit(1);
    }
    if (err.code !== "EAFNOSUPPORT" && err.code !== "EADDRNOTAVAIL") throw err;
  });
  server.listen(PORT, host);
}
