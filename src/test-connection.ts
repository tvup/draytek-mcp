#!/usr/bin/env tsx

import { DraytekClient } from "./draytek-client.js";

const host = process.env.DRAYTEK_HOST ?? process.argv[2] ?? "192.168.1.1";
const username = process.env.DRAYTEK_USERNAME ?? process.argv[3] ?? "admin";
const password = process.env.DRAYTEK_PASSWORD ?? process.argv[4] ?? "";

console.log(`Connecting to ${host}:22 as ${username}...`);

const client = new DraytekClient({ host, username, password });

async function main() {
  try {
    console.log("1. Connecting via SSH...");
    await client.connect();
    console.log("   OK - connected and admin mode activated\n");

    console.log("2. Running 'sys version'...");
    const version = await client.execute("sys version");
    console.log("   " + version.replace(/\n/g, "\n   ") + "\n");

    console.log("3. Running 'wan status'...");
    const wan = await client.execute("wan status");
    console.log("   " + wan.split("\n").slice(0, 5).join("\n   ") + "\n");

    console.log("4. Listing commands...");
    const cmds = await client.listCommands();
    console.log(`   ${cmds.length} commands available: ${cmds.join(", ")}\n`);

    console.log("All tests passed!");
  } catch (err) {
    console.error("FAILED:", err);
    process.exit(1);
  } finally {
    await client.disconnect();
  }
}

main();
