/** A setting is missing or malformed. Retrying cannot help: the deployment is wrong. */
export class ConfigError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
