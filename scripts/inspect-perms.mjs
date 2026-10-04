import { query, closePool } from "../src/db.js";

const SCH = "public";

async function show(title, sql, params = []) {
  try {
    const r = await query(sql, params);
    console.log(`\n── ${title}`);
    if (!r.rows.length) return console.log("   (none)");
    console.table(r.rows);
  } catch (e) {
    console.log(`\n── ${title}\n   FAILED: ${e.message}`);
  }
}

await show(
  "roles",
  `select rolname, rolcanlogin, rolsuper, rolbypassrls
   from pg_roles where rolname not like $1 order by 1`,
  ["pg\\_%"]
);

await show(
  "grants on public.*",
  `select grantee, table_name, string_agg(privilege_type, ', ' order by privilege_type) as privs
   from information_schema.role_table_grants
   where table_schema = $1
   group by grantee, table_name
   order by grantee, table_name`,
  [SCH]
);

await show(
  "RLS enabled on public tables",
  `select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as force
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = $1 and c.relkind = 'r'
   order by c.relname`,
  [SCH]
);

await show(
  "RLS policies",
  `select tablename, policyname, cmd, roles,
          coalesce(qual, '') as using_,
          coalesce(with_check, '') as with_check
   from pg_policies where schemaname = $1
   order by tablename, policyname`,
  [SCH]
);

await show(
  "role memberships (who can act as whom)",
  `select m.roleid::regrole::text as role, m.member::regrole::text as member, m.admin_option
   from pg_auth_members m
   where m.member::regrole::text <> 'pg_\\_catalog'::text
   order by 1, 2`
);

// Is `authenticator` allowed to SET ROLE into anon/authenticated?
await show(
  "current identity",
  `select current_user as current_user, session_user as session_user,
          current_role as current_role, current_setting('role') as role_setting`
);

await closePool();
