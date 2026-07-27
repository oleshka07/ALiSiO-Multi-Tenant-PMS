---
name: drizzle-db
description: Automates PostgreSQL schema migrations, validation, and multi-tenant safety checks using Drizzle Kit CLI.
---

# Drizzle DB Migration & Multi-Tenant Safety Skill

This skill provides guidelines and strict safety rules for AI Agents modifying the ALiSiO Multi-Tenant PMS database schema.

## Rules & Safety Protocols

1. **Schema File**: All database schema changes MUST be made in `src/db/schema.ts`.
2. **Multi-Tenancy Requirement**:
   - Every tenant-scoped table MUST include `tenant_id` referencing `tenants(id)`.
   - Never remove or bypass `tenant_id`.
3. **Migration Workflow**:
   - Before executing or applying changes, generate migrations:
     ```bash
     npm run db:generate
     ```
   - Review generated SQL files in `./drizzle/` directory.
   - Verify that no column deletions cause unintended customer data loss.
4. **Push / Apply Migrations**:
   - In local development: `npm run db:push` or `npm run db:migrate`.
