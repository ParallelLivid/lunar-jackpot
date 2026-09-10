import { spawn } from "node:child_process";
import { createServer, preview } from "vite";

const args = process.argv.slice(2);
const production = args.includes("--production");
const serverOptions = {
  host: "127.0.0.1",
  port: 4173,
  strictPort: true,
};
const server = production ? await preview({
  logLevel: "error",
  preview: serverOptions,
}) : await createServer({
  logLevel: "error",
  server: serverOptions,
});

if (!production) {
  await server.listen();
}

try {
  const exitCode = await new Promise((resolve, reject) => {
    const runner = spawn(
      process.execPath,
      // Anything after `--` is forwarded, so a single spec or --grep can be run
      // without standing the server up by hand.
      ["./node_modules/@playwright/test/cli.js", "test", ...args.filter((arg) => arg !== "--production")],
      { stdio: "inherit" },
    );

    runner.once("error", reject);
    runner.once("exit", (code) => resolve(code ?? 1));
  });

  process.exitCode = exitCode;
} finally {
  if (production) {
    await new Promise((resolve, reject) => {
      server.httpServer.close((error) => error ? reject(error) : resolve());
    });
  } else {
    await server.close();
  }
}
