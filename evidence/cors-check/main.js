// Minimal reproduction for GHSA-v3j7-r9gq-3gjw as it applies to Agent Orchestrator.
//
// The app serves its renderer from a privileged custom scheme `app://` registered
// with { standard, secure, supportFetchAPI } (no corsEnabled). This script registers
// the same kind of scheme, serves a page from a *different* origin
// (http://127.0.0.1:<random port>) in the same session, and lets that page try to
// fetch() an app:// URL and read the body.
//
// Usage (CORS=1 additionally sets corsEnabled: true):
//   CORS=0 npx electron@33.4.11 .
//   CORS=0 npx electron@44.7.0 .
//   CORS=1 npx electron@44.7.0 .
// On a headless Linux box, wrap the command in `xvfb-run -a` and pass --no-sandbox.
const { app, protocol, BrowserWindow } = require("electron");
const http = require("http");

const cors = process.env.CORS === "1";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: cors },
  },
]);

app.whenReady().then(async () => {
  let hits = 0;
  protocol.handle("app", () => {
    hits++;
    return new Response("SECRET", { headers: { "content-type": "text/plain" } });
  });

  const server = http
    .createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end("<html>cross-origin page</html>");
    })
    .listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));

  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  await win.loadURL(`http://127.0.0.1:${server.address().port}/`);

  const result = await win.webContents.executeJavaScript(
    `fetch("app://renderer/secret").then(r => r.text()).then(t => "READ:" + t, e => "BLOCKED:" + e.message)`,
  );
  console.log(
    `CORS_CHECK electron=${process.versions.electron} corsEnabled=${cors} result=${result} handlerHits=${hits}`,
  );
  app.quit();
});
