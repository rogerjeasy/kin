// The PayPal inbox for local development, in Docker: `pnpm queue:up` and
// `pnpm queue:down`. ElasticMQ answers SQS's API, so the web app and the
// worker use the same code here as in AWS. Messages live only in memory.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const IMAGE = "softwaremill/elasticmq-native:1.7.1";
const CONTAINER = "kin-queue";
const PORT = 9324;
const CONFIG = fileURLToPath(new URL("./local-queue/elasticmq.conf", import.meta.url));

const docker = (args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const running = () => docker(["ps", "--quiet", "--filter", `name=^${CONTAINER}$`]) !== "";

async function up(): Promise<void> {
  if (!running()) {
    docker(["run", "--detach", "--rm", "--name", CONTAINER, "--publish", `127.0.0.1:${PORT}:9324`, "--volume", `${CONFIG}:/opt/elasticmq.conf:ro`, IMAGE]);
  }
  const deadline = Date.now() + 30_000;
  for (;;) {
    const answer = await fetch(`http://localhost:${PORT}/?Action=ListQueues`).catch(() => null);
    if (answer?.ok) break;
    if (Date.now() > deadline) throw new Error("The local queue did not start within 30 seconds");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  console.log(`The PayPal inbox is up. Set in .env and apps/web/.env.local:
KIN_QUEUE_ENDPOINT=http://localhost:${PORT}
KIN_PAYPAL_INBOX_URL=http://localhost:${PORT}/000000000000/kin-paypal-events.fifo`);
}

function down(): void {
  if (running()) docker(["stop", CONTAINER]);
  console.log("The local PayPal inbox is stopped.");
}

const command = process.argv[2];
if (command === "up") await up();
else if (command === "down") down();
else throw new Error("Use: local-queue.ts up | down");
