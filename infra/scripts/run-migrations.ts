// Migrates Kin's database by running the one-off task KinData defines
// (src/database-access.ts) and waiting for it to finish:
//   AWS_PROFILE=wick-dev pnpm --filter @kin/infra run migrate
// The deploy pipeline runs it after KinData and before KinWeb, so the web
// app never meets a schema older than its code. It fails if the task does.
import { execFileSync } from "node:child_process";

import { DATABASE_SETTINGS, MIGRATION_TASK } from "../src/database-settings.ts";

const REGION = process.env.AWS_REGION ?? "us-east-1";

function aws(args: string[]): string {
  return execFileSync("aws", [...args, "--region", REGION, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function parameter(name: string): string {
  const result = JSON.parse(aws(["ssm", "get-parameter", "--name", name])) as { Parameter: { Value: string } };
  return result.Parameter.Value;
}

const subnets = parameter(DATABASE_SETTINGS.servicesSubnets).split(",");
const securityGroup = parameter(DATABASE_SETTINGS.servicesSecurityGroup);
const network = JSON.stringify({ awsvpcConfiguration: { subnets, securityGroups: [securityGroup], assignPublicIp: "DISABLED" } });

const started = JSON.parse(
  aws(["ecs", "run-task", "--cluster", MIGRATION_TASK.cluster, "--task-definition", MIGRATION_TASK.family, "--launch-type", "FARGATE", "--network-configuration", network]),
) as { tasks: { taskArn: string }[]; failures: { reason: string }[] };
const [task] = started.tasks;
if (!task) throw new Error(`The migration task did not start: ${started.failures.map((failure) => failure.reason).join(", ")}`);
console.log(`Migrating with ${task.taskArn}`);

aws(["ecs", "wait", "tasks-stopped", "--cluster", MIGRATION_TASK.cluster, "--tasks", task.taskArn]);
const described = JSON.parse(aws(["ecs", "describe-tasks", "--cluster", MIGRATION_TASK.cluster, "--tasks", task.taskArn])) as {
  tasks: { stoppedReason?: string; containers: { name: string; exitCode?: number; reason?: string }[] }[];
};
const container = described.tasks[0]?.containers.find((each) => each.name === MIGRATION_TASK.container);
const taskId = task.taskArn.split("/").at(-1) ?? "";
const logs = JSON.parse(
  aws(["logs", "get-log-events", "--log-group-name", "/kin/database-migrate", "--log-stream-name", `migrate/${MIGRATION_TASK.container}/${taskId}`]),
) as { events: { message: string }[] };
for (const event of logs.events) console.log(`  ${event.message}`);

if (container?.exitCode !== 0) {
  throw new Error(`The migration failed: exit ${container?.exitCode ?? "none"}, ${container?.reason ?? described.tasks[0]?.stoppedReason ?? "no reason given"}`);
}
console.log("The database is up to date.");
