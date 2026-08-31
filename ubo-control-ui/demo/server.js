"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const moduleRoot = path.resolve(__dirname, "..");
const reactRoot = path.dirname(require.resolve("react/package.json"));
const reactDomRoot = path.dirname(require.resolve("react-dom/package.json"));
const port = Number(process.env.UBO_RENDERER_DEMO_PORT || 4175);

const routes = new Map([
  ["/", { file: path.join(__dirname, "index.html"), type: "text/html; charset=utf-8" }],
  ["/demo.js", { file: path.join(__dirname, "demo.js"), type: "text/javascript; charset=utf-8" }],
  ["/demo.css", { file: path.join(__dirname, "demo.css"), type: "text/css; charset=utf-8" }],
  ["/OwnershipGraph.js", { file: path.join(moduleRoot, "OwnershipGraph.js"), type: "text/javascript; charset=utf-8" }],
  ["/ownership-graph.css", { file: path.join(moduleRoot, "ownership-graph.css"), type: "text/css; charset=utf-8" }],
  ["/fixtures.json", { file: path.join(moduleRoot, "fixtures", "projections.json"), type: "application/json; charset=utf-8" }],
  ["/react.js", { file: path.join(reactRoot, "umd", "react.development.js"), type: "text/javascript; charset=utf-8" }],
  ["/react-dom.js", { file: path.join(reactDomRoot, "umd", "react-dom.development.js"), type: "text/javascript; charset=utf-8" }],
]);

const server = http.createServer((request, response) => {
  const route = routes.get(new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname);
  if (!route) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  fs.readFile(route.file, (error, content) => {
    if (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Demo asset unavailable");
      return;
    }
    response.writeHead(200, { "Content-Type": route.type, "Cache-Control": "no-store" });
    response.end(content);
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`UBO renderer demo: http://127.0.0.1:${port}/\n`);
});
