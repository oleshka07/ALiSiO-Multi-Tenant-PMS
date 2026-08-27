-- One address, one account.
--
-- `login` has exactly one thing to look a person up by: the address they
-- typed. It reads a single row (`sql.row()`, no ORDER BY), so with two rows
-- carrying the same address the second person can never sign in — with the
-- right password, and with the same «Невірний email або пароль» a wrong one
-- gets. Nothing in either schema prevented the pair: `app_users.email` was
-- NOT NULL and nothing else.
--
-- Two ways the pair happened. `users.handlers.ts` compared the address exactly,
-- so «Anna@hotel.de» and «anna@hotel.de» passed each other by; and the same
-- exact comparison in `login` meant an owner provisioned as «owner@hotel.de»
-- was refused when they typed the address the way their mail client shows it.
-- Both are fixed in code in this commit; this is the half that makes the pair
-- impossible rather than merely unlikely.
--
-- Indexed on lower(email), because that is the comparison login makes. An
-- address identifies a person across the whole server, not within one hotel:
-- the login form asks for no tenant, so the uniqueness cannot be per-tenant
-- either.

-- A database that already holds the pair stops here and says which. Choosing
-- which of two accounts is the real one is the owner's decision, and a
-- migration that made it quietly would delete somebody's access.
DO $$
DECLARE d TEXT;
BEGIN
  SELECT string_agg(t.email || ' ×' || t.n, ', ')
    INTO d
    FROM (SELECT lower("email") AS email, COUNT(*) AS n
            FROM "app_users" GROUP BY lower("email") HAVING COUNT(*) > 1) t;
  IF d IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 0037 stopped: app_users holds duplicate addresses (%). The second account with each address cannot sign in today. Remove or rename the extra rows, then run this migration again.', d;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_app_users_email"
  ON "app_users" (lower("email"));
