#!/usr/bin/env node
"use strict";

/**
 * Add, list and remove people's access.
 *
 * Deliberately a command rather than a screen: there are three people to manage
 * today, and a screen for three people is a screen nobody maintains. It becomes
 * one when somebody other than the owner needs to do this.
 *
 *   node -r dotenv/config scripts/access.js list                       dotenv_config_path=.env.local
 *   node -r dotenv/config scripts/access.js grant <userId> <tenant> <role>  dotenv_config_path=.env.local
 *   node -r dotenv/config scripts/access.js revoke <userId>            dotenv_config_path=.env.local
 *
 * The userId is the Clerk user id (Users -> the person -> copy User ID).
 * Roles: owner, admin, analyst.
 */

const userAccess = require("../lib/userAccess");

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === "list") {
    const people = await userAccess.listAccess(args[0] || null);
    const owners = userAccess.bootstrapOwners();
    if (owners.length) console.log(`Bootstrap owners (from PLATFORM_OWNER_CLERK_IDS): ${owners.join(", ")}`);
    if (!people.length) return console.log("Nobody has been granted access yet.");
    for (const p of people) {
      console.log(`${p.userId}  ${p.role.padEnd(8)}  ${p.tenantId || "(platform)"}  added ${p.addedAt || "?"}`);
    }
    return undefined;
  }

  if (command === "grant") {
    const [userId, tenantId, role] = args;
    if (!userId || !tenantId || !role) {
      throw new Error("usage: grant <clerkUserId> <tenantId> <owner|admin|analyst>");
    }
    const record = await userAccess.grantAccess({ userId, tenantId, role, addedBy: "cli" });
    console.log(`Granted: ${record.userId} is ${record.role} of ${record.tenantId || "(platform)"}`);
    return undefined;
  }

  if (command === "revoke") {
    if (!args[0]) throw new Error("usage: revoke <clerkUserId>");
    await userAccess.revokeAccess(args[0]);
    console.log(`Revoked: ${args[0]} has no access now.`);
    console.log("Note: if they are named in PLATFORM_OWNER_CLERK_IDS they remain an owner - remove them there too.");
    return undefined;
  }

  throw new Error("usage: access.js <list|grant|revoke> ...");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
