import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const port = 18081;

const config = {
  name: "md-share",
  baseUrl: `http://127.0.0.1:${port}/`,
  guidePath: "docs/user-guide/web-ui.md",
  scenariosDir: "docs/ui-scenarios",
  screenshotsDir: "docs/assets/ui",
  viewport: { width: 1440, height: 900 },
  async start({ root, spawnServer, waitForHttp }) {
    const dataDir = path.join(root, "data", "ui-guide");
    await rm(dataDir, { recursive: true, force: true });
    await mkdir(dataDir, { recursive: true });
    const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const server = spawnServer(command, ["start", "--hostname", "127.0.0.1", "--port", String(port)], {
      env: {
        MD_SHARE_DATA_DIR: dataDir,
        MD_SHARE_ALLOW_ANONYMOUS_UPLOADS: "true",
        MD_SHARE_UPLOAD_TOKEN: "ui-guide-operator-token",
        MD_SHARE_ANONYMOUS_UPLOAD_LIMIT: "100",
        MD_SHARE_ANONYMOUS_UPLOAD_GLOBAL_LIMIT: "100",
        MD_SHARE_PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
        NEXT_TELEMETRY_DISABLED: "1"
      }
    });
    await waitForHttp(this.baseUrl, server);
    return server;
  },
  async seed() {},
  async stop({ root, server, stopServer }) {
    await stopServer(server);
    await rm(path.join(root, "data", "ui-guide"), { recursive: true, force: true });
  }
};

export default config;
