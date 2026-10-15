// Starts Next's standalone server on every interface. Platforms such as App
// Runner set HOSTNAME to the instance's own name, which would leave the health
// checker, and everyone else, outside. Set here, it wins over the platform.
import process from "node:process";

process.env.HOSTNAME = "0.0.0.0";
await import("./server.js");
