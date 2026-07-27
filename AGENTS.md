# ALiSiO Multi-Tenant SaaS - Developer & AI Agent Guidelines (AGENTS.md)

Welcome to **ALiSiO Multi-Tenant SaaS** (Property Management System / PMS). This document provides essential instructions, architectural guidelines, database rules, tool configurations, and coding standards for human developers and AI agents.

---

## 1. Project Overview & Architecture

ALiSiO is a cloud-native, multi-tenant Property Management System (PMS) designed for hotels, guest houses, apartment networks, and property managers.

### Core Architectural Principles
- **Multi-Tenancy**: Data isolation is enforced at the database level using PostgreSQL Row Level Security (RLS) with `tenant_id` scopes.
- **Modularity**: Clean separation of concerns between Tenant Management, Auth/RBAC, Property Catalog, Reservations/Bookings, Financials/Invoicing, and Audit Logging.
- **Security First**: Every API request must authenticate the tenant and set the database session variable `app.current_tenant_id`.
- **High Performance**: Optimized database indices, soft-deletion where required, and asynchronous background tasks for notifications and billing.

---

## 2. Technology Stack & Tooling

- **Database**: PostgreSQL 16+ with Row Level Security (RLS) enabled.
- **Backend / ORM**: Next.js 14+ App Router, TypeScript, Drizzle ORM (`drizzle-orm`, `drizzle-kit`).
- **Code Quality**: Biome.js (`@biomejs/biome`) for ultra-fast linting and code formatting.
- **Testing**: Playwright (`@playwright/test`) for E2E user flow automated tests.
- **Containerization**: Docker & Docker Compose for local PostgreSQL & pgAdmin.

---

## 3. Database & Drizzle ORM Rules

1. **Schema Definition**:
   - Primary TypeScript schema is maintained in `src/db/schema.ts`.
   - Every tenant-scoped table MUST include `tenant_id: uuid('tenant_id').notNull().references(() => tenants.id)`.

2. **Drizzle CLI Workflow**:
   - Before applying database schema changes, generate SQL migrations:
     ```bash
     npm run db:generate
     ```
   - Validate generated SQL files in `./drizzle/` to prevent data loss.
   - Run migrations / push schema:
     ```bash
     npm run db:push
     ```

3. **Row Level Security Policy**:
   - Every tenant-scoped table in PostgreSQL must have RLS enabled and use:
     ```sql
     CREATE POLICY tenant_isolation_policy ON table_name FOR ALL
       USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
     ```

---

## 4. Code Quality & Biome Rules

- Always run `npm run lint` or `npm run lint:fix` before committing code.
- Formatting rules: 2 spaces, single quotes, semicolons enabled.

---

## 5. Playwright E2E Testing Rules

- E2E tests reside in `tests/e2e/`.
- Run tests via `npm run test:e2e` after key feature implementations.

---

## 6. Directory Layout

```
ALiSiO Multi-Tenant PMS/
├── AGENTS.md                 # AI Agent & Developer Guidelines
├── .agents/
│   ├── AGENTS.md             # Guidelines reference
│   └── skills/drizzle-db/    # AI Skill for Drizzle ORM migrations
├── biome.json                # Biome linting & formatting config
├── drizzle.config.ts         # Drizzle Kit CLI configuration
├── playwright.config.ts      # Playwright E2E test runner config
├── docker-compose.yml        # Docker configuration for local PostgreSQL
├── .env.example              # Environment variables template
├── package.json              # Dependencies & npm scripts
├── database/
│   ├── schema.sql            # PostgreSQL DDL with RLS
│   └── seed.sql              # Initial test seed data
├── src/
│   ├── app/                  # Next.js App Router pages
│   └── db/                   # Drizzle ORM client & schema
│       ├── index.ts
│       └── schema.ts
└── tests/
    └── e2e/                  # Playwright automated tests
```
