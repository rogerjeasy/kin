/**
 * The day-one sandbox checks of docs/architecture.md section 22.1. Run from
 * the repository root:
 *
 *   pnpm --filter @kin/paypal run sandbox:check capabilities [payee email]
 *   pnpm --filter @kin/paypal run sandbox:check balance
 *   pnpm --filter @kin/paypal run sandbox:check subscription <subscription id>
 *   pnpm --filter @kin/paypal run sandbox:check vault-start
 *   pnpm --filter @kin/paypal run sandbox:check vault-finish <setup token id>
 *   pnpm --filter @kin/paypal run sandbox:check invoice <recipient email> [cents] [--record <file>]
 *   pnpm --filter @kin/paypal run sandbox:check invoice-read <invoice id> [--record <file>]
 */
import { checkBalance, checkCapabilities } from "./sandbox/capabilities.ts";
import { signIn } from "./sandbox/client.ts";
import { makeInvoice, readInvoice, saveRecording } from "./sandbox/invoicing.ts";
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
  case "invoice":
    await makeInvoice(needs(argument, "recipient's sandbox email"), /^[0-9]+$/.test(process.argv[4] ?? "") ? Number(process.argv[4]) : 100);
    saveRecording(process.argv);
    break;
  case "invoice-read":
    await readInvoice(needs(argument, "invoice ID"));
    saveRecording(process.argv);
    break;
  default:
    console.log("Commands: capabilities [payee], balance, subscription <id>, vault-start, vault-finish <setup token>, invoice <recipient> [cents], invoice-read <invoice id>");
}
