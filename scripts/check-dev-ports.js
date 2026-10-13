const net = require("node:net");
const path = require("node:path");

require("../server/node_modules/dotenv").config({
  path: path.join(__dirname, "../server/.env"),
  quiet: true,
});

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(
          `Port ${port} is already in use. If ANHS Vote is running, open http://127.0.0.1:5173. ` +
          "To restart, press Ctrl+C in its terminal before running npm run dev again."
        ));
      } else {
        reject(new Error(`Cannot use port ${port}: ${error.code || error.message}`));
      }
    });
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      server.close(resolve);
    });
  });
}

async function main() {
  const apiPort = Number(process.env.PORT || 4000);
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
    throw new Error("PORT in server/.env must be between 1 and 65535.");
  }
  if (apiPort === 5173) {
    throw new Error("The API and frontend need different ports. Set PORT=4000 in server/.env.");
  }
  await Promise.all([checkPort(apiPort), checkPort(5173)]);
}

main().catch((error) => {
  console.error(`ANHS Vote: ${error.message}`);
  process.exitCode = 1;
});
