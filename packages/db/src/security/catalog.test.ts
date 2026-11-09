import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { testDatabases } from "../testing/databases.ts";
import { PUBLIC_TABLES_SQL } from "../testing/sql.ts";

const { admin } = testDatabases();

const ROLES = ["kin_app", "kin_service", "kin_provisioner"];
/** The roles as one SQL array value. */
const roleArray = sql`string_to_array(${ROLES.join(",")}, ',')`;
/** Tables no person reads: only Kin's service touches them. A check-in link's hash is a credential, so no screen reads its table. */
const SERVICE_ONLY = ["outbox", "paypal_events", "shift_check_links", "family_codes"];

async function tables(): Promise<string[]> {
  const result = await admin.execute<{ tablename: string }>(PUBLIC_TABLES_SQL);
  return result.rows.map((row) => row.tablename);
}

async function policies(): Promise<{ table: string; role: string; command: string }[]> {
  const result = await admin.execute<{ tablename: string; role: string; cmd: string }>(
    sql`select tablename, unnest(roles)::text as role, cmd from pg_policies where schemaname = 'public'`,
  );
  return result.rows.map((row) => ({ table: row.tablename, role: row.role, command: row.cmd }));
}

describe("the database's access rules (AGENTS.md section 6)", () => {
  it("cover every table: row-level security is on, and every table but users has a circle", async () => {
    const all = await tables();
    expect(all.length).toBeGreaterThanOrEqual(24);
    const rls = await admin.execute<{ relname: string; relrowsecurity: boolean }>(
      sql`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`,
    );
    for (const row of rls.rows) expect({ table: row.relname, rls: row.relrowsecurity }).toEqual({ table: row.relname, rls: true });

    const withCircle = await admin.execute<{ table_name: string }>(
      sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'circle_id'`,
    );
    const circleTables = new Set(withCircle.rows.map((row) => row.table_name));
    expect(all.filter((table) => !circleTables.has(table)).toSorted()).toEqual(["circles", "users"]);
  });

  it("give every table a policy for the service, and every table a person may read a policy for kin_app", async () => {
    const all = await tables();
    const granted = await policies();
    for (const table of all) {
      const roles = new Set(granted.filter((policy) => policy.table === table).map((policy) => policy.role));
      expect({ table, service: roles.has("kin_service") }).toEqual({ table, service: true });
      if (!SERVICE_ONLY.includes(table)) expect({ table, app: roles.has("kin_app") }).toEqual({ table, app: true });
      else expect({ table, app: roles.has("kin_app") }).toEqual({ table, app: false });
    }
  });

  it("let a person write only their user row, their answers, invitations and the audit of what they did", async () => {
    const result = await admin.execute<{ table_name: string; privilege_type: string }>(
      sql`select table_name, privilege_type from information_schema.role_table_grants
          where grantee = 'kin_app' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`,
    );
    expect(result.rows.map((row) => `${row.table_name} ${row.privilege_type}`).toSorted()).toEqual([
      "approvals INSERT",
      "audit_log INSERT",
      "invitations INSERT",
      "users INSERT",
      "users UPDATE",
    ]);
  });

  it("let a person change only a proposal's state and a circle's pause, column by column", async () => {
    const result = await admin.execute<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.column_privileges
          where grantee = 'kin_app' and privilege_type = 'UPDATE' and table_name <> 'users'`,
    );
    expect(result.rows.map((row) => `${row.table_name}.${row.column_name}`).toSorted()).toEqual(["circles.paused_by", "circles.paused_until", "proposals.state"]);
  });

  it("let Kin's service move a shift's state and write no other shift, permission or use", async () => {
    const columns = await admin.execute<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.column_privileges
          where grantee = 'kin_service' and privilege_type in ('UPDATE', 'INSERT') and table_name in ('shifts', 'shift_permissions', 'shift_permission_uses')`,
    );
    expect(columns.rows.map((row) => `${row.table_name}.${row.column_name}`)).toEqual(["shifts.state"]);
  });

  it("let no role but the operations write a care agreement or its signatures, and the provisioner only add them", async () => {
    const result = await admin.execute<{ grantee: string; table_name: string; privilege_type: string }>(
      sql`select grantee, table_name, privilege_type from information_schema.role_table_grants
          where table_name in ('care_agreements', 'care_agreement_signatures') and grantee = any(${roleArray}) and privilege_type <> 'SELECT'`,
    );
    expect(result.rows.map((row) => `${row.grantee} ${row.table_name} ${row.privilege_type}`).toSorted()).toEqual([
      "kin_provisioner care_agreement_signatures INSERT",
      "kin_provisioner care_agreements INSERT",
    ]);
  });

  it("let no role delete or truncate anything", async () => {
    const result = await admin.execute<{ grantee: string; table_name: string; privilege_type: string }>(
      sql`select grantee, table_name, privilege_type from information_schema.role_table_grants
          where grantee = any(${roleArray}) and privilege_type in ('DELETE', 'TRUNCATE')`,
    );
    expect(result.rows).toEqual([]);
  });

  it("let the provisioner add rows and read none", async () => {
    const result = await admin.execute<{ privilege_type: string }>(
      sql`select distinct privilege_type from information_schema.role_table_grants where grantee = 'kin_provisioner'`,
    );
    expect(result.rows.map((row) => row.privilege_type)).toEqual(["INSERT"]);
  });

  it("make no connecting role a superuser, an owner, or able to bypass row-level security", async () => {
    const roles = await admin.execute<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean }>(
      sql`select rolname, rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname = any(${roleArray})`,
    );
    expect(roles.rows).toHaveLength(3);
    for (const role of roles.rows) expect(role).toEqual({ rolname: role.rolname, rolsuper: false, rolbypassrls: false, rolcreaterole: false });
    const owned = await admin.execute<{ count: string }>(
      sql`select count(*) from pg_tables where schemaname = 'public' and tableowner = any(${roleArray})`,
    );
    expect(Number(owned.rows[0]?.count)).toBe(0);
  });
});
