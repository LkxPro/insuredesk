import { randomUUID } from "node:crypto";
import { isExternalRole, type Permission, TicketKindKey } from "@insuredesk/shared";
import { inject } from "vitest";
import {
  seedChannels,
  seedFactoryRolesAndDemoUsers,
  seedShiftTypes,
  seedSlaPolicies,
  seedTicketCategories,
} from "../prisma/seed-data.ts";
import { type Clock, fixedClock, systemClock } from "../src/clock.ts";
// 静态 import 应用模块之所以安全：src/db 的客户端在首次属性访问才读
// DATABASE_URL（lazy Proxy），而 start 在任何查询与播种之前已把它指向容器。
import { prisma } from "../src/db.ts";
import type { Prisma, PrismaClient, Role, Ticket, User } from "../src/generated/prisma/client.ts";
import { appRouter } from "../src/routers/index.ts";
import { type AuthenticatedUser, effectivePermissions } from "../src/services/auth.service.ts";
import { requireTicketKindId } from "../src/services/ticket-kind.service.ts";
import { migrateDeploy, runAdminSql, TEMPLATE_DB, uriForDatabase } from "./shared-postgres.ts";

export type ComplaintCoreInput = Omit<
  Prisma.TicketCreateManyInput,
  "kindId" | "slaAnchorAt" | "source"
> & {
  kindId?: string;
  slaAnchorAt?: Date | string;
  source?: string;
};

export type ComplaintDetailInput = Partial<
  Omit<Prisma.TicketComplaintDetailCreateManyInput, "ticketId">
>;

export async function createComplaintTicket(
  prisma: PrismaClient,
  core: ComplaintCoreInput = {},
  detail: ComplaintDetailInput = {},
): Promise<Ticket> {
  const kindId = core.kindId ?? (await requireTicketKindId(prisma, TicketKindKey.Complaint));
  return prisma.ticket.create({
    data: {
      source: "manual",
      ...core,
      kindId,
      slaAnchorAt: core.slaAnchorAt ?? core.createdAt ?? new Date(),
      complaintDetail: { create: detail },
    },
  });
}

export async function createComplaintTickets(
  prisma: PrismaClient,
  rows: { core: ComplaintCoreInput; detail?: ComplaintDetailInput }[],
): Promise<string[]> {
  const kindId = await requireTicketKindId(prisma, TicketKindKey.Complaint);
  const created = await prisma.ticket.createManyAndReturn({
    data: rows.map(({ core }) => ({
      source: "manual",
      ...core,
      kindId: core.kindId ?? kindId,
      slaAnchorAt: core.slaAnchorAt ?? core.createdAt ?? new Date(),
    })),
    select: { id: true },
  });
  await prisma.ticketComplaintDetail.createMany({
    data: created.map(({ id }, index) => ({ ticketId: id, ...rows[index]?.detail })),
  });
  return created.map((row) => row.id);
}

export type IntegrationHarnessMode = "real-migrations" | "fast";

export type SeedSetName =
  | "rolesAndUsers"
  | "slaPolicies"
  | "channels"
  | "categories"
  | "shiftTypes";

export interface IntegrationHarnessOptions {
  mode?: IntegrationHarnessMode;
  seed?: readonly SeedSetName[];
  traceId?: string;
}

type SeededRolesAndUsers = Awaited<ReturnType<typeof seedFactoryRolesAndDemoUsers>>;
type Caller = ReturnType<typeof appRouter.createCaller>;
type ServiceDeps = { prisma: PrismaClient; clock: Clock };

export interface IntegrationHarness {
  prisma: PrismaClient;
  appRouter: typeof appRouter;
  databaseUrl: string;
  deps: ServiceDeps;
  depsAt(at: Date): ServiceDeps;
  seeded: SeededRolesAndUsers;
  slaPolicyId(name: string): string;
  channelId(name: string): string;
  categoryId(name: string): string;
  userFeedbackChannelId(name: string): string;
  feedbackReceiveChannelId(name: string): string;
  authUserFor(user: User, role: Role, permissions?: Permission[]): AuthenticatedUser;
  callerFor(user: User, role: Role): Caller;
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

  const dropDatabase = () =>
    runAdminSql(baseUri, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);

  process.env.DATABASE_URL = databaseUrl;
  try {
    if (mode === "real-migrations") {
      await migrateDeploy(databaseUrl, baseUri);
    }

    const selected = new Set<SeedSetName>(seed);
    const seededRolesAndUsers = selected.has("rolesAndUsers")
      ? await seedFactoryRolesAndDemoUsers(prisma)
      : undefined;
    const slaPolicies = selected.has("slaPolicies") ? await seedSlaPolicies(prisma) : undefined;
    if (selected.has("shiftTypes")) {
      await seedShiftTypes(prisma);
    }
    const channels = selected.has("channels") ? await seedChannels(prisma) : undefined;
    const categories = selected.has("categories") ? await seedTicketCategories(prisma) : undefined;
    // 两个投诉渠道目录无应用层种子：目录行随迁移落库，直接读
    const userFeedbackChannels = await prisma.userFeedbackChannel.findMany();
    const feedbackReceiveChannels = await prisma.feedbackReceiveChannel.findMany();

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
      isExternal: isExternalRole(role),
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
      slaPolicyId: idLookup(slaPolicies, "slaPolicies", "时效策略"),
      userFeedbackChannelId: idLookup(userFeedbackChannels, "channels", "用户反馈渠道"),
      feedbackReceiveChannelId: idLookup(feedbackReceiveChannels, "channels", "反馈信息接收渠道"),
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
