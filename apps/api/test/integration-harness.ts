import { randomUUID } from "node:crypto";
import type { Permission } from "@insuredesk/shared";
import { inject } from "vitest";
import {
  seedChannels,
  seedFactoryRolesAndDemoUsers,
  seedShiftTypes,
  seedSlaPolicies,
  seedTicketCategories,
} from "../prisma/seed-data";
import { type Clock, fixedClock, systemClock } from "../src/clock";
// 静态 import 应用模块之所以安全：src/db 的客户端在首次属性访问才读
// DATABASE_URL（lazy Proxy），而 start 在任何查询与播种之前已把它指向容器。
// 若 db 客户端失去惰性，这里必须退回「先设 env、再动态 import」的时序。
import { prisma } from "../src/db";
import type { PrismaClient, Role, User } from "../src/generated/prisma/client";
import { appRouter } from "../src/routers/index";
import { type AuthenticatedUser, effectivePermissions } from "../src/services/auth.service";
import { migrateDeploy, runAdminSql, TEMPLATE_DB, uriForDatabase } from "./shared-postgres";

/**
 * real-migrations：保证每次真跑 `prisma migrate deploy`（在共享容器的全新
 * 空库上），供迁移管线类测试（它们证明的就是迁移本身）。fast：只承诺
 * 「已迁移的库」这一结果，不承诺如何得到——实现为克隆 global setup 里
 * 已迁移的 template 库。
 */
export type IntegrationHarnessMode = "real-migrations" | "fast";

export type SeedSetName =
  | "rolesAndUsers"
  | "slaPolicies"
  | "channels"
  | "categories"
  | "shiftTypes";

export interface IntegrationHarnessOptions {
  mode?: IntegrationHarnessMode;
  /** 声明式选择需要的 seed 集；未声明的集在 harness 上不可访问。 */
  seed?: readonly SeedSetName[];
  /** createCaller 上下文的 traceId，便于日志区分测试来源。 */
  traceId?: string;
}

type SeededRolesAndUsers = Awaited<ReturnType<typeof seedFactoryRolesAndDemoUsers>>;
type Caller = ReturnType<typeof appRouter.createCaller>;
type ServiceDeps = { prisma: PrismaClient; clock: Clock };

export interface IntegrationHarness {
  prisma: PrismaClient;
  appRouter: typeof appRouter;
  databaseUrl: string;
  /** 直接调 service 的 deps，系统时钟。 */
  deps: ServiceDeps;
  /** 固定 clock 注入：钉在 `at` 时刻的 service deps。 */
  depsAt(at: Date): ServiceDeps;
  /** 出厂角色与 demo 用户；需声明 seed 集 "rolesAndUsers"。 */
  seeded: SeededRolesAndUsers;
  /** 渠道名 → id；需声明 seed 集 "channels"。 */
  channelId(name: string): string;
  /** 类别名 → id；需声明 seed 集 "categories"。 */
  categoryId(name: string): string;
  /** 与真实登录同口径的身份（系统角色展开全量权限），可显式覆盖权限集。 */
  authUserFor(user: User, role: Role, permissions?: Permission[]): AuthenticatedUser;
  callerFor(user: User, role: Role): Caller;
  /** 身份取自 user + role，权限用显式集合替换。 */
  callerWith(user: User, role: Role, permissions: Permission[]): Caller;
  stop(): Promise<void>;
}

function seedSetNotDeclared(seedSet: SeedSetName): Error {
  return new Error(
    `seed 集「${seedSet}」未声明——在 startIntegrationHarness({ seed: [...] }) 中选择`,
  );
}

function idLookup(
  rows: Array<{ id: string; name: string }> | undefined,
  seedSet: SeedSetName,
  kind: string,
): (name: string) => string {
  const byName = rows && new Map(rows.map((row) => [row.name, row.id]));
  return (name) => {
    if (!byName) throw seedSetNotDeclared(seedSet);
    const id = byName.get(name);
    if (!id) throw new Error(`${kind}「${name}」未播种`);
    return id;
  };
}

let startedInThisProcess = false;

/**
 * 在共享 Postgres 容器上给出一个已迁移、按声明播种的隔离库，并把应用自己的
 * Prisma 客户端接上去。调用方只拿返回的句柄，不接触容器、migrate deploy 或
 * 模块加载时序。
 */
export async function startIntegrationHarness(
  options: IntegrationHarnessOptions = {},
): Promise<IntegrationHarness> {
  const { mode = "fast", seed = [], traceId = "integration-harness" } = options;

  // 应用的 Prisma 客户端与 DATABASE_URL 都是进程级单例，客户端一经初始化便
  // 钉死首个库的连接串：同进程第二次 start 只会把种子灌进第一个库。
  // stop 后客户端仍缓存旧连接串，因此该限制不随 stop 解除。
  if (startedInThisProcess) {
    throw new Error("startIntegrationHarness 同一进程只能调用一次（每个测试文件一个 harness）");
  }
  startedInThisProcess = true;

  const baseUri = inject("integrationDbBaseUri");
  const dbName = `harness_${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = uriForDatabase(baseUri, dbName);

  await runAdminSql(
    baseUri,
    mode === "real-migrations"
      ? `CREATE DATABASE "${dbName}"`
      : `CREATE DATABASE "${dbName}" TEMPLATE "${TEMPLATE_DB}"`,
  );

  // WITH (FORCE)：库上可能还挂着测试自己拉起的连接（如 boot-env 起的子进程
  // 崩了没断连），强断后照样能删。
  const dropDatabase = () =>
    runAdminSql(baseUri, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);

  process.env.DATABASE_URL = databaseUrl;
  try {
    if (mode === "real-migrations") {
      migrateDeploy(databaseUrl);
    }

    const selected = new Set<SeedSetName>(seed);
    const seededRolesAndUsers = selected.has("rolesAndUsers")
      ? await seedFactoryRolesAndDemoUsers(prisma)
      : undefined;
    if (selected.has("slaPolicies")) {
      await seedSlaPolicies(prisma);
    }
    if (selected.has("shiftTypes")) {
      await seedShiftTypes(prisma);
    }
    const channels = selected.has("channels") ? await seedChannels(prisma) : undefined;
    const categories = selected.has("categories") ? await seedTicketCategories(prisma) : undefined;

    const authUserFor = (
      user: User,
      role: Role,
      permissions?: Permission[],
    ): AuthenticatedUser => ({
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      team: user.team,
      roleId: role.id,
      roleName: role.name,
      permissions: permissions ?? effectivePermissions(role),
      requiredTicketFields: role.requiredTicketFields,
      externalOrgId: user.externalOrgId,
    });

    const caller = (user: AuthenticatedUser): Caller =>
      appRouter.createCaller({ traceId, user, sessionToken: null });

    return {
      prisma,
      appRouter,
      databaseUrl,
      deps: { prisma, clock: systemClock },
      depsAt: (at) => ({ prisma, clock: fixedClock(at) }),
      get seeded() {
        if (!seededRolesAndUsers) throw seedSetNotDeclared("rolesAndUsers");
        return seededRolesAndUsers;
      },
      channelId: idLookup(channels, "channels", "渠道"),
      categoryId: idLookup(categories, "categories", "类别"),
      authUserFor,
      callerFor: (user, role) => caller(authUserFor(user, role)),
      callerWith: (user, role, permissions) => caller(authUserFor(user, role, permissions)),
      stop: async () => {
        await prisma.$disconnect();
        await dropDatabase();
      },
    };
  } catch (error) {
    await dropDatabase();
    throw error;
  }
}
