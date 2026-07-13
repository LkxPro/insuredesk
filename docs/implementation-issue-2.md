# Issue #2 Implementation Summary

**工单系统 #2 — 认证（Session 登录）与 RBAC 基座**

## Implementation Complete ✅

All acceptance criteria from issue #2 have been successfully implemented and tested.

---

## What Was Built

### 1. Prisma Models ✅
- **User**: Username/password authentication, includes nullable `feishuUserId` for future SSO
- **Role**: Permission-point string array, 4 preset roles seeded
- **Session**: httpOnly session storage in PostgreSQL

**Preset Roles Seeded:**
- 管理员 (Admin) - All 23 permissions
- 客服主管 (CS Manager) - 11 permissions (view all, assign, export)
- 一线客服 (Frontline CS) - 3 permissions (view own tickets, process)
- 只读观察 (Read-only Observer) - 4 permissions (view all data, read-only)

**Sample Users:**
- Username: `admin`, `manager`, `cs1`, `observer`
- Password: `password123` (all users)

### 2. Permission-Point Enum ✅
**Location:** `packages/shared/src/permissions.ts`

**23 permissions across 5 categories:**
- Dashboard: view, view_all, export
- Ticket: view, view_all, create, edit, process, assign, batch_assign, export, delete
- User: view, create, edit, delete, assign_role
- Role: view, create, edit, delete, edit_permission
- System: schedule.view, schedule.edit

### 3. Password Login Flow ✅
**Endpoints:**
- `POST /api/auth/login` - Login with username/password, sets httpOnly session cookie
- `POST /api/auth/logout` - Clears session
- `GET /trpc/auth.me` - Returns identity + resolved permission-point set

**Session Configuration:**
- httpOnly cookies for security
- 24-hour expiration (configurable via `SESSION_MAX_AGE_SECONDS`)
- Stored in PostgreSQL (not Redis)
- Auto-cleanup on expiry

### 4. `requirePermission()` Fastify/tRPC Guard ✅
**Location:** `apps/api/src/trpc.ts`

**Usage:**
```typescript
const procedure = requirePermission("ticket.assign");
```

**Behavior:**
- Checks if authenticated user has the required permission
- Returns `403 FORBIDDEN` if permission missing
- Includes helpful error message: `"Missing required permission: ticket.assign"`

### 5. Query-Layer Data-Scope Helper ✅
**Location:** `apps/api/src/services/data-scope.service.ts`

**Functions:**
- `applyTicketDataScope(user)` - Returns Prisma where clause
  - With `ticket.view_all`: `{}` (no restriction)
  - Without: `{ assigneeId: user.id }` (own tickets only)
- `applyDashboardDataScope(user)` - Similar for dashboard queries
- `canViewTicket(user, ticket)` - Check if user can view specific ticket

**Usage Pattern:**
```typescript
const tickets = await prisma.ticket.findMany({
  where: {
    ...applyTicketDataScope(user),
    // ... other filters
  },
});
```

### 6. Pluggable `authenticate()` Abstraction ✅
**Location:** `apps/api/src/services/auth.service.ts`

**Interface:**
```typescript
interface AuthProvider {
  authenticate(credentials: unknown): Promise<string | null>;
}
```

**Current Implementation:**
- `PasswordAuthProvider` - Username/password against User table
- Future: `FeishuSSOProvider` will use same session-establishment path

### 7. Demo: Permission Guard Testing ✅
**Location:** `apps/api/src/routers/demo.router.ts`

**Probe Endpoints:**
- `demo.assignProbe` - Requires `ticket.assign` (rejects frontline CS)
- `demo.viewAllDataProbe` - Requires `dashboard.view_all` (rejects frontline CS)
- `demo.authenticatedProbe` - Any authenticated user

**Verified Behavior:**
- Admin succeeds on all probes
- Frontline CS rejected with `403 FORBIDDEN` on guarded probes
- Error message includes missing permission

### 8. Testcontainers Tests ✅
**Location:** `apps/api/test/auth.test.ts`

**Coverage:**
- Password authentication (valid, invalid username, invalid password, inactive users)
- Session management (create, validate, expire, delete)
- Permission resolution (admin vs frontline CS)
- `hasPermission()` helper
- Data-scope helpers (ticket and dashboard)

**Test Results:** 25/25 tests passing ✅

---

## Infrastructure Setup

### Docker Compose for Development
**File:** `docker-compose.yml`

**Usage:**
```bash
docker compose up -d          # Start PostgreSQL
pnpm dev                      # Auto-migrate (+ seed if empty), start API and web
```

### Environment Variables
**Added to `.env.example`:**
- `SESSION_SECRET` - Secret for signing cookies (min 32 chars)
- `SESSION_MAX_AGE_SECONDS` - Session expiration (default: 86400)

---

## API Endpoints

### REST (for cookie handling)
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout

### tRPC
- `auth.me` - Get current user identity + permissions
- `demo.assignProbe` - Test ticket.assign permission
- `demo.viewAllDataProbe` - Test dashboard.view_all permission
- `demo.authenticatedProbe` - Test authentication

---

## Demo Verification

### Admin (系统管理员)
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password123"}' \
  -c cookies.txt

curl http://localhost:3000/trpc/auth.me -b cookies.txt
```

**Response:**
- roleName: "管理员"
- permissions: [23 permissions] - has ticket.view_all, ticket.assign, etc.

### Frontline CS (一线客服)
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"cs1","password":"password123"}' \
  -c cookies.txt

curl http://localhost:3000/trpc/auth.me -b cookies.txt
```

**Response:**
- roleName: "一线客服"
- permissions: ["dashboard.view", "ticket.view", "ticket.process"]
- Missing: ticket.view_all, ticket.assign

### Permission Guard Test
```bash
curl 'http://localhost:3000/trpc/demo.assignProbe' -b cookies.txt
```

**Admin:** ✅ Success
**Frontline CS:** ❌ 403 FORBIDDEN - "Missing required permission: ticket.assign"

---

## Testing

```bash
# Run all tests (including Testcontainers)
pnpm --filter @insuredesk/api test

# Type checking
pnpm --filter @insuredesk/api typecheck

# Start development server
pnpm dev
```

**Test Results:**
- ✅ 25/25 tests passing
- ✅ Type checking passes
- ✅ All acceptance criteria verified

---

## Next Steps

This authentication and RBAC foundation is now ready for:
1. Frontend integration (login page, protected routes)
2. Ticket system implementation (will use data-scope helpers)
3. Future Feishu SSO integration (pluggable auth design ready)

---

## Files Changed

**Created:**
- `packages/shared/src/permissions.ts` - Permission-point enum
- `apps/api/src/services/auth.service.ts` - Auth and session services
- `apps/api/src/services/data-scope.service.ts` - Data-scope helpers
- `apps/api/src/routers/auth.router.ts` - Auth tRPC router
- `apps/api/src/routers/demo.router.ts` - Demo/testing router
- `apps/api/prisma/seed.ts` - Database seeding script
- `apps/api/test/auth.test.ts` - Testcontainers integration tests
- `docker-compose.yml` - PostgreSQL dev environment
- `docs/adr/0007-docker-compose-dev-and-deploy.md` - ADR from git

**Modified:**
- `apps/api/prisma/schema.prisma` - Added User, Role, Session models
- `apps/api/src/trpc.ts` - Added protectedProcedure, requirePermission
- `apps/api/src/server.ts` - Added cookie middleware, session extraction, REST endpoints
- `apps/api/src/env.ts` - Added SESSION_SECRET, SESSION_MAX_AGE_SECONDS
- `apps/api/.env.example` - Updated with session config
- Migration: `20260709055930_add_auth_and_rbac_models`
