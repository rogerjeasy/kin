/**
 * The day-one sandbox checks of docs/architecture.md section 22.1. Run from
 * the repository root:
 *
 *   pnpm --filter @kin/paypal run sandbox:check capabilities [payee email]
 *   pnpm --filter @kin/paypal run sandbox:check balance
 *   pnpm --filter @kin/paypal run sandbox:check subscription <subscription id>
 *   pnpm --filter @kin/paypal run sandbox:check vault-start
 *   pnpm --filter @kin/paypal run sandbox:check vault-finish <setup token id>
 */
import { checkBalance, checkCapabilities } from "./sandbox/capabilities.ts";
import { signIn } from "./sandbox/client.ts";
import { checkSubscriptionPayments } from "./sandbox/subscription.ts";
import { finishVault, startVault } from "./sandbox/vault.ts";

const [command, argument] = process.argv.slice(2);

function needs(value: string | undefined, what: string): string {
  if (!value) {
    throw new Error(`Pass the ${what}.`);
  }
  return value;
}

switch (command) {
  case "capabilities":
    await checkCapabilities(argument);
    break;
  case "balance":
    await checkBalance(await signIn("pool"));
    break;
  case "subscription":
    await checkSubscriptionPayments(needs(argument, "subscription ID"));
    break;
  case "vault-start":
    await startVault();
    break;
  case "vault-finish":
    await finishVault(needs(argument, "setup token ID"));
    break;
  default:
    console.log("Commands: capabilities [payee], balance, subscription <id>, vault-start, vault-finish <setup token>");
}
