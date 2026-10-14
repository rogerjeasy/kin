import { App } from "aws-cdk-lib";

import { buildKin } from "./app.ts";
import { readConfig } from "./config.ts";

const app = new App();
buildKin(
  app,
  readConfig({
    context: (key) => app.node.tryGetContext(key),
    env: process.env,
  }),
);
app.synth();
