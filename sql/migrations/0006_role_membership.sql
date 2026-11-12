-- PostgreSQL 16+: a non-superuser that creates a role only gets ADMIN on it
-- (createrole_self_grant = ''), not SET. The API and the worker connect as the
-- database owner (e.g. Neon's neondb_owner) and narrow privileges per
-- transaction with SET LOCAL ROLE nova_api / nova_worker, so the connecting
-- user needs SET (but not INHERIT: it must not silently gain RLS-bound grants).
-- Idempotent; no-op on PostgreSQL < 16 or when the user is a superuser.
DO $$
DECLARE r text;
BEGIN
  IF current_setting('server_version_num')::int < 160000
     OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RETURN;
  END IF;
  FOREACH r IN ARRAY ARRAY['nova_api', 'nova_worker'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND NOT EXISTS (
         SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
          WHERE g.rolname = r AND u.rolname = current_user AND m.set_option) THEN
      EXECUTE format('GRANT %I TO %I WITH SET TRUE, INHERIT FALSE', r, current_user);
    END IF;
  END LOOP;
END $$;
