import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const verify = process.argv.includes("--verify");
const config = (await import(pathToFileURL(path.join(root, "ui-guide.config.mjs")).href)).default;
const verifyRoot = path.join(root, "data", "ui-guide-verify");

function spawnServer(command, args, { env = {} } = {}) {
  const output = [];
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk) => {
      output.push(String(chunk));
      if (output.length > 80) output.shift();
    });
  }
  child.recentOutput = output;
  return child;
}

async function waitForHttp(url, server) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`UI guide server exited early.\n${server.recentOutput.join("")}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`UI guide server did not become ready.\n${server.recentOutput.join("")}`);
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/pid", String(server.pid), "/T", "/F"]).catch(() => {});
    return;
  }
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000))
  ]);
  if (server.exitCode === null) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
  }
}

async function launchBrowser() {
  const requestedChannel = process.env.PLAYWRIGHT_CHANNEL;
  const launchOptions = {
    headless: true,
    args: ["--disable-gpu", "--disable-skia-runtime-opts"]
  };
  if (requestedChannel) return chromium.launch({ ...launchOptions, channel: requestedChannel });
  try {
    return await chromium.launch(launchOptions);
  } catch (bundledError) {
    for (const channel of ["chrome", "msedge"]) {
      try {
        return await chromium.launch({ ...launchOptions, channel });
      } catch {
        // Try the next installed browser channel.
      }
    }
    throw bundledError;
  }
}

async function loadScenarios() {
  const directory = path.join(root, config.scenariosDir);
  const files = (await readdir(directory)).filter((file) => file.endsWith(".mjs")).sort();
  return Promise.all(
    files.map(async (file) => (await import(pathToFileURL(path.join(directory, file)).href)).default)
  );
}

function renderGuide(scenarios) {
  const lines = [
    "# md-share 웹 사용자 가이드",
    "",
    "> 이 문서는 `docs/ui-scenarios`의 실행 가능한 브라우저 시나리오에서 생성한다.",
    ""
  ];
  for (const scenario of scenarios) {
    const imagePath = path
      .relative(path.dirname(path.join(root, config.guidePath)), path.join(root, scenario.screenshot))
      .replaceAll("\\", "/");
    lines.push(`## ${scenario.title}`, "", scenario.description, "", `![${scenario.title}](${imagePath})`, "");
    scenario.guide.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

async function verifyFile(expectedPath, actualPath, label) {
  const [expected, actual] = await Promise.all([readFile(expectedPath), readFile(actualPath)]);
  if (!expected.equals(actual)) throw new Error(`${label} is stale: ${path.relative(root, expectedPath)}`);
}

async function verifyScreenshot(expectedPath, actualPath, label) {
  const [expectedBuffer, actualBuffer] = await Promise.all([
    readFile(expectedPath),
    readFile(actualPath)
  ]);
  const expected = PNG.sync.read(expectedBuffer);
  const actual = PNG.sync.read(actualBuffer);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(
      `${label} dimensions changed: ${expected.width}x${expected.height} -> ${actual.width}x${actual.height}`
    );
  }

  const mismatchedPixels = pixelmatch(
    expected.data,
    actual.data,
    null,
    expected.width,
    expected.height,
    { threshold: 0.2 }
  );
  const mismatchRatio = mismatchedPixels / (expected.width * expected.height);
  // Chromium rasterization and system fonts differ between the Windows capture
  // workstation and the Linux CI container. Keep the comparison perceptual while
  // still rejecting layout-sized changes and any viewport dimension drift.
  const maximumMismatchRatio = 0.05;
  if (mismatchRatio > maximumMismatchRatio) {
    throw new Error(
      `${label} is stale: ${path.relative(root, expectedPath)} ` +
        `(${(mismatchRatio * 100).toFixed(2)}% pixels changed; allowed ${(maximumMismatchRatio * 100).toFixed(2)}%)`
    );
  }
}

let server;
let browser;
let completed = false;
try {
  if (verify) {
    await rm(verifyRoot, { recursive: true, force: true });
    await mkdir(verifyRoot, { recursive: true });
  }
  server = await config.start({ root, spawnServer, waitForHttp });
  await config.seed({ root, baseUrl: config.baseUrl });
  browser = await launchBrowser();
  const scenarios = await loadScenarios();

  for (const scenario of scenarios) {
    const context = await browser.newContext({
      viewport: scenario.viewport ?? config.viewport,
      colorScheme: "dark",
      reducedMotion: "reduce"
    });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        const location = message.location();
        const source = location.url
          ? ` (${location.url}${location.lineNumber ? `:${location.lineNumber}` : ""})`
          : "";
        errors.push(`console: ${message.text()}${source}`);
      }
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    const screenshotPath = verify
      ? path.join(verifyRoot, path.basename(scenario.screenshot))
      : path.join(root, scenario.screenshot);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await scenario.run({
      page,
      browser,
      baseUrl: config.baseUrl,
      capture: () =>
        page.screenshot({
          path: screenshotPath,
          animations: "disabled",
          caret: "hide"
        })
    });
    await context.close();
    if (errors.length > 0) throw new Error(`${scenario.id} browser errors:\n${errors.join("\n")}`);
    if (verify) {
      await verifyScreenshot(path.join(root, scenario.screenshot), screenshotPath, `${scenario.id} screenshot`);
    }
  }

  const guide = renderGuide(scenarios);
  const guidePath = path.join(root, config.guidePath);
  if (verify) {
    const generatedGuide = path.join(verifyRoot, "web-ui.md");
    await writeFile(generatedGuide, guide, "utf8");
    await verifyFile(guidePath, generatedGuide, "generated guide");
  } else {
    await mkdir(path.dirname(guidePath), { recursive: true });
    await writeFile(guidePath, guide, "utf8");
  }
  console.log(`${verify ? "verified" : "captured"} ${scenarios.length} UI guide scenario(s)`);
  completed = true;
} finally {
  await browser?.close();
  await config.stop({ root, server, stopServer });
  if (verify && completed) await rm(verifyRoot, { recursive: true, force: true });
}
