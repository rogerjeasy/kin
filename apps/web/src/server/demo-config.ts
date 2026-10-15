import { readDemoConfig, type DemoConfig } from "@kin/config";

let demo: DemoConfig | undefined;

/**
 * Whether the Demo button works here (KIN_DEMO_CIRCLES=on), and the key that
 * signs a visitor's session. Read the first time a request needs it, never at
 * build time. Kept apart from the database so the proxy can read it.
 */
export function demoConfig(): DemoConfig {
  demo ??= readDemoConfig(process.env);
  return demo;
}
