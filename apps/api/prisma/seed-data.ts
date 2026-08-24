import type { Permission, TicketCreateData } from "@insuredesk/shared";
import {
  DEFAULT_REFUND_SLA_POLICY,
  DEFAULT_SLA_POLICIES,
  DEFAULT_TICKET_KINDS,
  isExternalRole,
  TicketKindKey,
  TicketStatus,
} from "@insuredesk/shared";
import type { Clock } from "../src/clock.ts";
import type {
  Channel,
  PrismaClient,
  Role,
  ShiftType,
  SlaPolicy,
  Ticket,
  TicketCategory,
  TicketKind,
  User,
} from "../src/generated/prisma/client.ts";
import { type AuthenticatedUser, hashPassword } from "../src/services/auth.service.ts";
import { computeSlaStamp, createTicket } from "../src/services/ticket.service.ts";
import { assignTicket } from "../src/services/ticket-assign.service.ts";
import { requireTicketKindId } from "../src/services/ticket-kind.service.ts";

export const DEMO_PASSWORD = "password123";

export const DEFAULT_SHIFT_TYPES = [
  {
    name: "早班",
    color: "#10b981",
    segments: [{ start: "09:00", end: "13:00" }],
    displayOrder: 1,
  },
  {
    name: "晚班",
    color: "#f59e0b",
    segments: [{ start: "15:00", end: "21:00" }],
    displayOrder: 2,
  },
  {
    name: "全班",
    color: "#3b82f6",
    segments: [{ start: "09:00", end: "18:00" }],
    displayOrder: 3,
  },
  { name: "休", color: "#9ca3af", segments: [], displayOrder: 99 },
] as const;

export const DEFAULT_TICKET_CATEGORIES = [
  "监管投诉-引导性",
  "监管投诉-非引导性",
  "投诉-服务态度",
  "投诉-未履行告知义务",
  "投诉-信息泄露",
  "投诉-保费收取问题",
  "理赔咨询",
  "理赔投诉",
  "退保申请",
  "退保投诉",
  "保单变更",
  "保单查询",
  "续保咨询",
  "核保咨询",
  "产品咨询",
  "回访问题",
  "其他",
] as const;

export const DEFAULT_CHANNELS = [
  { name: "保司", displayOrder: 1 },
  { name: "经纪", displayOrder: 2 },
  { name: "支付", displayOrder: 3 },
  { name: "监管", displayOrder: 4 },
] as const;

export const FACTORY_ROLES = {
  ADMIN: {
    name: "管理员",
    system: true,
    // 系统角色的权限列在库中永远不被读取(登录与展示恒为代码全量),
    // 留空以免存下一份会随版本漂移的假快照
    permissions: [] as Permission[],
  },
  CS_MANAGER: {
    name: "客服主管",
    system: false,
    permissions: [
      "dashboard.view",
      "dashboard.view_all",
      "dashboard.export",
      "ticket.view",
      "ticket.view_all",
      "ticket.create",
      "ticket.edit",
      "ticket.process",
      "ticket.assign",
      "ticket.batch_assign",
      "ticket.export",
      "schedule.view",
      "schedule.edit",
    ] as Permission[],
  },
  FRONTLINE_CS: {
    name: "一线客服",
    system: false,
    permissions: ["dashboard.view", "ticket.view", "ticket.process"] as Permission[],
  },
  READ_ONLY: {
    name: "只读观察",
    system: false,
    permissions: [
      "dashboard.view",
      "dashboard.view_all",
      "ticket.view",
      "ticket.view_all",
    ] as Permission[],
  },
} as const;

type FactoryRoles = { admin: Role; csManager: Role; frontline: Role; readOnly: Role };

export async function createFactoryRoles(prisma: PrismaClient): Promise<FactoryRoles | null> {
  return prisma.$transaction(async (tx) => {
    if ((await tx.role.count()) > 0) {
      return null;
    }
    const create = (spec: (typeof FACTORY_ROLES)[keyof typeof FACTORY_ROLES]) =>
      tx.role.create({
        data: { name: spec.name, permissions: [...spec.permissions], system: spec.system },
      });
    return {
      admin: await create(FACTORY_ROLES.ADMIN),
      csManager: await create(FACTORY_ROLES.CS_MANAGER),
      frontline: await create(FACTORY_ROLES.FRONTLINE_CS),
      readOnly: await create(FACTORY_ROLES.READ_ONLY),
    };
  });
}

async function upsertUser(
  prisma: PrismaClient,
  data: { username: string; name: string; email: string; roleId: string; passwordHash: string },
): Promise<User> {
  return prisma.user.upsert({
    where: { username: data.username },
    update: {},
    create: { ...data, active: true },
  });
}

/**
 * Never touches an existing user — the operator may have rotated the password
 * long after first install.
 */
export async function bootstrapSystemData(
  prisma: PrismaClient,
  options: { adminUsername: string; adminPassword: string },
): Promise<{ adminCreated: boolean; rolesCreated: boolean }> {
  const factoryRoles = await createFactoryRoles(prisma);
  await seedTicketKinds(prisma);
  await seedSlaPolicies(prisma);
  await seedRefundDefaultSlaPolicy(prisma);
  await seedShiftTypes(prisma);
  await seedTicketCategories(prisma);
  await seedChannels(prisma);
  await seedExternalUserRole(prisma);

  const existing = await prisma.user.findUnique({ where: { username: options.adminUsername } });
  if (existing) {
    return { adminCreated: false, rolesCreated: factoryRoles !== null };
  }

  const systemRole =
    factoryRoles?.admin ?? (await prisma.role.findFirstOrThrow({ where: { system: true } }));
  await prisma.user.create({
    data: {
      username: options.adminUsername,
      name: options.adminUsername,
      roleId: systemRole.id,
      passwordHash: await hashPassword(options.adminPassword),
      active: true,
    },
  });
  return { adminCreated: true, rolesCreated: factoryRoles !== null };
}

async function findFactoryRoles(prisma: PrismaClient): Promise<FactoryRoles> {
  const byName = async (name: string) => {
    const role = await prisma.role.findUnique({ where: { name } });
    if (!role) {
      throw new Error(
        `出厂角色「${name}」不存在（已被改名或删除）。demo 数据依赖出厂角色，请用 docker compose down -v 重建空库后再 seed。`,
      );
    }
    return role;
  };
  return {
    admin: await byName(FACTORY_ROLES.ADMIN.name),
    csManager: await byName(FACTORY_ROLES.CS_MANAGER.name),
    frontline: await byName(FACTORY_ROLES.FRONTLINE_CS.name),
    readOnly: await byName(FACTORY_ROLES.READ_ONLY.name),
  };
}

export async function seedFactoryRolesAndDemoUsers(prisma: PrismaClient): Promise<{
  roles: FactoryRoles;
  users: { admin: User; manager: User; cs1: User; observer: User };
}> {
  const roles = (await createFactoryRoles(prisma)) ?? (await findFactoryRoles(prisma));

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const users = {
    admin: await upsertUser(prisma, {
      username: "admin",
      name: "系统管理员",
      email: "admin@insuredesk.local",
      roleId: roles.admin.id,
      passwordHash,
    }),
    manager: await upsertUser(prisma, {
      username: "manager",
      name: "李主管",
      email: "manager@insuredesk.local",
      roleId: roles.csManager.id,
      passwordHash,
    }),
    cs1: await upsertUser(prisma, {
      username: "cs1",
      name: "张客服",
      email: "cs1@insuredesk.local",
      roleId: roles.frontline.id,
      passwordHash,
    }),
    observer: await upsertUser(prisma, {
      username: "observer",
      name: "王观察员",
      email: "observer@insuredesk.local",
      roleId: roles.readOnly.id,
      passwordHash,
    }),
  };

  return { roles, users };
}

/**
 * 这是全库唯一的外部角色,建外部账号靠它落 roleId(账号不选角色)。再添一个外部
 * 角色会让建号直接失败,而不是随机挑一个。
 */
export async function seedExternalUserRole(prisma: PrismaClient): Promise<Role> {
  return prisma.role.upsert({
    where: { name: "外部用户" },
    update: {},
    create: {
      name: "外部用户",
      permissions: ["ticket.create_external", "ticket.process_external"],
      system: false,
      requiredTicketFields: [],
    },
  });
}

/**
 * 无 count==0 守卫（姊妹种子有）：存量环境也要随时补插缺失的行为绑定行；
 * update 留空 = 管理员改名/停用不被回写。
 */
export async function seedTicketKinds(prisma: PrismaClient): Promise<TicketKind[]> {
  for (const defaults of DEFAULT_TICKET_KINDS) {
    await prisma.ticketKind.upsert({
      where: { key: defaults.key },
      update: {},
      create: { ...defaults },
    });
  }
  return prisma.ticketKind.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }] });
}

export const DEFAULT_SLA_POLICY_DESCRIPTIONS: Record<string, string> = {
  一般投诉: "常规投诉：48 小时处理时限，首响 120 分钟；24 小时检查点累计 1 次、48 小时累计 2 次。",
  高级投诉: "重要投诉：48 小时处理时限，首响 120 分钟；24 小时检查点累计 1 次、48 小时累计 3 次。",
  加急投诉: "加急投诉：72 小时处理时限，首响 60 分钟；24/48/72 小时检查点，分别累计 2/4/6 次。",
  特急投诉:
    "特急投诉：不设处理时限，首响 30 分钟；24/48 小时检查点，此后每 12 小时滚动跟进直至完结。",
  退费异常默认策略: "退费异常：48 小时处理时限，首响 120 分钟；36 小时检查点累计 1 次。",
};

export async function seedSlaPolicies(prisma: PrismaClient): Promise<SlaPolicy[]> {
  return prisma.$transaction(async (tx) => {
    if ((await tx.slaPolicy.count()) === 0) {
      const complaintKindId = await requireTicketKindId(tx, TicketKindKey.Complaint);
      await tx.slaPolicy.createMany({
        data: DEFAULT_SLA_POLICIES.map((defaults, index) => ({
          name: defaults.name,
          description: DEFAULT_SLA_POLICY_DESCRIPTIONS[defaults.name] ?? null,
          sortOrder: index + 1,
          active: true,
          firstResponseMinutes: defaults.firstResponseMinutes,
          overdueHours: defaults.overdueHours,
          reminderRules: defaults.reminderRules,
          kindId: complaintKindId,
        })),
      });
    }
    return tx.slaPolicy.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  });
}

/**
 * 独立于 seedSlaPolicies 的 count==0 守卫：存量环境已有四条投诉策略时也能补插；
 * update 留空 = 管理员改名不回写。sortOrder 钉 0 —— dashboard 特急卡绑定
 * active 中 sortOrder 最大者，不得反超出厂四条的 1..4。
 */
export async function seedRefundDefaultSlaPolicy(prisma: PrismaClient): Promise<SlaPolicy> {
  const kindId = await requireTicketKindId(prisma, TicketKindKey.RefundException);
  return prisma.slaPolicy.upsert({
    where: { name: DEFAULT_REFUND_SLA_POLICY.name },
    update: {},
    create: {
      name: DEFAULT_REFUND_SLA_POLICY.name,
      description: DEFAULT_SLA_POLICY_DESCRIPTIONS[DEFAULT_REFUND_SLA_POLICY.name] ?? null,
      sortOrder: 0,
      active: true,
      firstResponseMinutes: DEFAULT_REFUND_SLA_POLICY.firstResponseMinutes,
      overdueHours: DEFAULT_REFUND_SLA_POLICY.overdueHours,
      reminderRules: DEFAULT_REFUND_SLA_POLICY.reminderRules,
      kindId,
    },
  });
}

export async function seedShiftTypes(prisma: PrismaClient): Promise<ShiftType[]> {
  return prisma.$transaction(async (tx) => {
    if ((await tx.shiftType.count()) === 0) {
      await tx.shiftType.createMany({
        data: DEFAULT_SHIFT_TYPES.map((defaults) => ({
          name: defaults.name,
          color: defaults.color,
          segments: [...defaults.segments],
          displayOrder: defaults.displayOrder,
        })),
        skipDuplicates: true,
      });
    }
    return tx.shiftType.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }] });
  });
}

export async function seedTicketCategories(prisma: PrismaClient): Promise<TicketCategory[]> {
  return prisma.$transaction(async (tx) => {
    if ((await tx.ticketCategory.count()) === 0) {
      await tx.ticketCategory.createMany({
        data: DEFAULT_TICKET_CATEGORIES.map((name, index) => ({
          name,
          displayOrder: index + 1,
        })),
        skipDuplicates: true,
      });
    }
    return tx.ticketCategory.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }] });
  });
}

export async function seedChannels(prisma: PrismaClient): Promise<Channel[]> {
  return prisma.$transaction(async (tx) => {
    if ((await tx.channel.count()) === 0) {
      await tx.channel.createMany({
        data: DEFAULT_CHANNELS.map((defaults) => ({ ...defaults })),
        skipDuplicates: true,
      });
    }
    return tx.channel.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }] });
  });
}

const HOUR_MS = 60 * 60 * 1000;

const DEMO_TICKET_POLICY_NUMBERS = [
  "DEMO-POL-1001",
  "DEMO-POL-1002",
  "DEMO-POL-1003",
  "DEMO-POL-1004",
  "DEMO-POL-1005",
  "DEMO-POL-1006",
  "DEMO-POL-1007",
  "DEMO-POL-1008",
  "DEMO-POL-1009",
  "DEMO-POL-1010",
  "DEMO-POL-1011",
  "DEMO-POL-1012",
] as const;

type DemoTicketPolicyNumber = (typeof DEMO_TICKET_POLICY_NUMBERS)[number];

type SeededUsersAndRoles = Awaited<ReturnType<typeof seedFactoryRolesAndDemoUsers>>;

interface DemoTicketSpec {
  demoPolicyNumber: DemoTicketPolicyNumber;
  title: string;
  createdHoursAgo: number;
  input: TicketCreateData;
  slaPolicyName?: string;
  categoryName?: string;
  channelName?: string;
  userFeedbackChannelName?: string;
  feedbackReceiveChannelName?: string;
  source?: "manual" | "feishu_form" | "community";
  creator?: keyof SeededUsersAndRoles["users"];
  assignee?: keyof SeededUsersAndRoles["users"];
  status?: "unassigned" | "assigned" | "processing" | "completed";
  contactCount?: number;
  nextContactHoursFromNow?: number;
  completionStatusName?: string;
  completionHoursAgo?: number;
  logs?: Array<{
    action: "comment" | "resolve" | "status_change";
    operator: keyof SeededUsersAndRoles["users"];
    from?: string | null;
    to?: string | null;
    remark: string;
    atHoursAgo: number;
  }>;
}

function hoursAgo(hours: number, now: Date): Date {
  return new Date(now.getTime() - hours * HOUR_MS);
}

function hoursFromNow(hours: number, now: Date): Date {
  return new Date(now.getTime() + hours * HOUR_MS);
}

function clockAt(at: Date): Clock {
  return { now: () => at };
}

function authUser(user: User, role: Role): AuthenticatedUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    team: user.team,
    roleId: role.id,
    roleName: role.name,
    permissions: role.permissions as Permission[],
    requiredTicketFields: role.requiredTicketFields,
    isExternal: isExternalRole(role),
  };
}

function demoInput(
  demoPolicyNumber: DemoTicketPolicyNumber,
  overrides: Partial<TicketCreateData>,
): TicketCreateData {
  return {
    feedbackTime: hoursAgo(1, new Date()).toISOString(),
    channelId: null,
    project: "融盛百万医疗",
    brokerageEntity: "东方大地经纪",
    paymentChannel: "连连支付",
    internalOrderNumber: `DEMO-ORDER-${demoPolicyNumber.slice(-4)}`,
    policyNumbers: [demoPolicyNumber],
    noPolicyNumber: false,
    userFeedbackChannelId: null,
    feedbackReceiveChannelId: null,
    customerName: "演示客户",
    phone: "13800000000",
    contactPhone: null,
    customerRequest: "客户反馈保单服务体验异常，要求核实并尽快回复。",
    nuclearBodyStatus: "待核实",
    hasContacted: false,
    contactTime: null,
    contactId: null,
    categoryId: null,
    slaPolicyId: null,
    priority: null,
    ...overrides,
  };
}

const demoTicketSpecs: DemoTicketSpec[] = [
  {
    demoPolicyNumber: "DEMO-POL-1001",
    title: "未分配的新投诉",
    createdHoursAgo: 3,
    channelName: "保司",
    input: demoInput("DEMO-POL-1001", {
      customerName: "陈晓雨",
      phone: "13810001001",
      customerRequest: "客户认为本期扣费金额与页面展示不一致，要求核实扣费明细。",
    }),
    categoryName: "投诉-保费收取问题",
  },
  {
    demoPolicyNumber: "DEMO-POL-1002",
    title: "待超时未分配",
    createdHoursAgo: 47,
    channelName: "监管",
    slaPolicyName: "高级投诉",
    input: demoInput("DEMO-POL-1002", {
      customerName: "周明轩",
      phone: "13810001002",
      priority: "high",
      customerRequest: "客户已向监管渠道反馈销售说明不清，要求主管介入处理。",
    }),
    categoryName: "监管投诉-引导性",
  },
  {
    demoPolicyNumber: "DEMO-POL-1003",
    title: "已超时未分配",
    createdHoursAgo: 56,
    channelName: "支付",
    input: demoInput("DEMO-POL-1003", {
      customerName: "林思远",
      phone: "13810001003",
      priority: "urgent",
      customerRequest: "客户称收到疑似营销电话，要求确认信息来源并给出书面回复。",
    }),
    categoryName: "投诉-信息泄露",
  },
  {
    demoPolicyNumber: "DEMO-POL-1004",
    title: "已分配给一线客服",
    createdHoursAgo: 8,
    assignee: "cs1",
    channelName: "保司",
    input: demoInput("DEMO-POL-1004", {
      customerName: "何佳怡",
      phone: "13810001004",
      customerRequest: "客户咨询住院理赔材料清单，要求电话回访说明。",
    }),
    categoryName: "理赔咨询",
  },
  {
    demoPolicyNumber: "DEMO-POL-1005",
    title: "待超时且已分配",
    createdHoursAgo: 47,
    assignee: "manager",
    channelName: "经纪",
    slaPolicyName: "高级投诉",
    input: demoInput("DEMO-POL-1005", {
      customerName: "吴承泽",
      phone: "13810001005",
      priority: "medium",
      customerRequest: "客户对退保金额有异议，要求重新测算现金价值。",
    }),
    categoryName: "退保投诉",
  },
  {
    demoPolicyNumber: "DEMO-POL-1006",
    title: "处理中有跟进记录",
    createdHoursAgo: 18,
    assignee: "cs1",
    status: "processing",
    contactCount: 2,
    nextContactHoursFromNow: 6,
    channelName: "保司",
    slaPolicyName: "加急投诉",
    input: demoInput("DEMO-POL-1006", {
      customerName: "郑沐辰",
      phone: "13810001006",
      priority: "high",
      hasContacted: true,
      contactId: "CALL-DEMO-1006",
      customerRequest: "客户认为理赔审核时间过长，要求说明当前节点并加急处理。",
    }),
    categoryName: "理赔投诉",
    logs: [
      {
        action: "status_change",
        operator: "cs1",
        from: "assigned",
        to: "processing",
        remark: "开始跟进",
        atHoursAgo: 16,
      },
      {
        action: "comment",
        operator: "cs1",
        remark: "首次联系客户，确认缺少住院发票原件。",
        atHoursAgo: 15,
      },
      {
        action: "comment",
        operator: "cs1",
        remark: "客户已补充材料照片，已转保司复核。",
        atHoursAgo: 4,
      },
      {
        action: "comment",
        operator: "cs1",
        remark: "已与客户确认补充材料，等待保司反馈。",
        atHoursAgo: 3,
      },
    ],
  },
  {
    demoPolicyNumber: "DEMO-POL-1007",
    title: "处理中且已超时",
    createdHoursAgo: 54,
    assignee: "manager",
    status: "processing",
    contactCount: 1,
    nextContactHoursFromNow: -2,
    channelName: "支付",
    slaPolicyName: "高级投诉",
    input: demoInput("DEMO-POL-1007", {
      customerName: "王亦凡",
      phone: "13810001007",
      priority: "urgent",
      hasContacted: true,
      customerRequest: "客户反馈重复扣费且未收到退款，要求当天给出处理方案。",
    }),
    categoryName: "投诉-保费收取问题",
    logs: [
      {
        action: "status_change",
        operator: "manager",
        from: "assigned",
        to: "processing",
        remark: "升级处理",
        atHoursAgo: 50,
      },
      {
        action: "comment",
        operator: "manager",
        remark: "已联系支付渠道排查扣款流水。",
        atHoursAgo: 30,
      },
      {
        action: "comment",
        operator: "manager",
        remark: "已升级主管处理，等待支付渠道核查回执。",
        atHoursAgo: 28,
      },
    ],
  },
  {
    demoPolicyNumber: "DEMO-POL-1008",
    title: "正常完结",
    createdHoursAgo: 40,
    assignee: "cs1",
    status: "completed",
    contactCount: 2,
    completionStatusName: "正常完结",
    completionHoursAgo: 10,
    channelName: "保司",
    input: demoInput("DEMO-POL-1008", {
      customerName: "赵一诺",
      phone: "13810001008",
      customerRequest: "客户查询电子保单下载路径。",
      hasContacted: true,
    }),
    categoryName: "保单查询",
    logs: [
      {
        action: "comment",
        operator: "cs1",
        remark: "已指导客户下载电子保单。",
        atHoursAgo: 18,
      },
      {
        action: "comment",
        operator: "cs1",
        remark: "客户认可解释，工单正常完结。",
        atHoursAgo: 12,
      },
      {
        action: "resolve",
        operator: "cs1",
        remark: "客户确认问题已解决。",
        atHoursAgo: 10,
      },
    ],
  },
  {
    demoPolicyNumber: "DEMO-POL-1009",
    title: "超时后完结",
    createdHoursAgo: 80,
    assignee: "manager",
    status: "completed",
    contactCount: 3,
    completionStatusName: "已协商解决",
    completionHoursAgo: 6,
    channelName: "监管",
    slaPolicyName: "高级投诉",
    input: demoInput("DEMO-POL-1009", {
      customerName: "孙若溪",
      phone: "13810001009",
      customerRequest: "客户对销售告知流程提出监管投诉，要求补偿方案。",
      hasContacted: true,
    }),
    categoryName: "监管投诉-非引导性",
    logs: [
      {
        action: "comment",
        operator: "manager",
        remark: "已提交录音质检并同步客户初步结论。",
        atHoursAgo: 60,
      },
      {
        action: "comment",
        operator: "manager",
        remark: "经多轮沟通后协商解决。",
        atHoursAgo: 8,
      },
      {
        action: "resolve",
        operator: "manager",
        remark: "双方已就补偿方案达成一致。",
        atHoursAgo: 6,
      },
    ],
  },
  {
    demoPolicyNumber: "DEMO-POL-1010",
    title: "特急投诉无处理时限",
    createdHoursAgo: 6,
    assignee: "cs1",
    status: "processing",
    contactCount: 1,
    nextContactHoursFromNow: 2,
    channelName: "监管",
    slaPolicyName: "特急投诉",
    input: demoInput("DEMO-POL-1010", {
      customerName: "刘安宁",
      phone: "13810001010",
      priority: "urgent",
      hasContacted: true,
      customerRequest: "监管转办特急投诉，客户要求立即联系并说明处理负责人。",
    }),
    categoryName: "监管投诉-引导性",
    logs: [
      {
        action: "status_change",
        operator: "cs1",
        from: "assigned",
        to: "processing",
        remark: "特急件首响",
        atHoursAgo: 5,
      },
      {
        action: "comment",
        operator: "cs1",
        remark: "已完成首次电话联系，约定两小时内反馈下一步。",
        atHoursAgo: 5,
      },
      {
        action: "comment",
        operator: "cs1",
        remark: "特急件已电话首响，持续滚动跟进。",
        atHoursAgo: 1,
      },
    ],
  },
  {
    demoPolicyNumber: "DEMO-POL-1011",
    title: "飞书表单导入",
    createdHoursAgo: 12,
    source: "feishu_form",
    channelName: "经纪",
    input: demoInput("DEMO-POL-1011", {
      customerName: "杨可欣",
      phone: "13810001011",
      customerRequest: "飞书表单转入：客户咨询保障责任和等待期。",
    }),
    userFeedbackChannelName: "飞书表单",
    categoryName: "产品咨询",
  },
  {
    demoPolicyNumber: "DEMO-POL-1012",
    title: "社区反馈已分配",
    createdHoursAgo: 24,
    source: "community",
    assignee: "cs1",
    channelName: "保司",
    input: demoInput("DEMO-POL-1012", {
      customerName: "马梓涵",
      phone: "13810001012",
      customerRequest: "社区反馈：客户称回访时间不便，希望改约晚间联系。",
    }),
    userFeedbackChannelName: "社区",
    categoryName: "回访问题",
  },
];

async function deleteExistingDemoTickets(prisma: PrismaClient): Promise<number> {
  const existing = await prisma.ticket.findMany({
    where: { policyNumbers: { hasSome: [...DEMO_TICKET_POLICY_NUMBERS] } },
    select: { id: true, workOrderNumber: true },
  });
  if (existing.length === 0) {
    return 0;
  }

  await prisma.appNotification.deleteMany({
    where: {
      OR: [
        { ticketId: { in: existing.map((ticket) => ticket.id) } },
        { workOrderNumber: { in: existing.map((ticket) => ticket.workOrderNumber) } },
      ],
    },
  });
  await prisma.ticket.deleteMany({
    where: { id: { in: existing.map((ticket) => ticket.id) } },
  });
  return existing.length;
}

async function createExternalTicket(
  prisma: PrismaClient,
  spec: DemoTicketSpec,
  input: TicketCreateData,
  createdAt: Date,
): Promise<Ticket> {
  const slaStamp = await computeSlaStamp(prisma, input.slaPolicyId, createdAt);

  const ticket = await prisma.ticket.create({
    data: {
      ...input,
      feedbackTime: input.feedbackTime === null ? null : new Date(input.feedbackTime),
      createdAt,
      slaAnchorAt: createdAt,
      kindId: await requireTicketKindId(prisma, TicketKindKey.Complaint),
      source: spec.source ?? "manual",
      creatorId: null,
      ...slaStamp,
    },
  });

  await prisma.processLog.create({
    data: {
      ticketId: ticket.id,
      operatorId: "system",
      operatorName: spec.source === "community" ? "社区" : "飞书",
      action: "create",
      remark: `${spec.title}：外部渠道导入`,
      at: createdAt,
    },
  });

  return ticket;
}

async function applyDemoState(
  prisma: PrismaClient,
  rolesAndUsers: SeededUsersAndRoles,
  spec: DemoTicketSpec,
  ticket: Ticket,
  now: Date,
  completionStatusIdByName: Map<string, string>,
) {
  const manager = authUser(rolesAndUsers.users.manager, rolesAndUsers.roles.csManager);
  if (spec.assignee) {
    await assignTicket(
      { prisma, clock: clockAt(hoursAgo(Math.max(spec.createdHoursAgo - 1, 0), now)) },
      manager,
      { ticketId: ticket.id, assigneeId: rolesAndUsers.users[spec.assignee].id },
    );
  }

  const status = spec.status ?? (spec.assignee ? TicketStatus.Assigned : TicketStatus.Unassigned);
  if (status === TicketStatus.Processing || status === TicketStatus.Completed) {
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status,
        contactCount: spec.contactCount ?? 0,
        nextContactTime:
          spec.nextContactHoursFromNow === undefined
            ? null
            : hoursFromNow(spec.nextContactHoursFromNow, now),
        completionStatusId: spec.completionStatusName
          ? (completionStatusIdByName.get(spec.completionStatusName) ?? null)
          : null,
        completionTime:
          spec.completionHoursAgo === undefined ? null : hoursAgo(spec.completionHoursAgo, now),
      },
    });
  }

  for (const log of spec.logs ?? []) {
    const operator = rolesAndUsers.users[log.operator];
    await prisma.processLog.create({
      data: {
        ticketId: ticket.id,
        operatorId: operator.id,
        operatorName: operator.name,
        action: log.action,
        from: log.from ?? null,
        to: log.to ?? null,
        remark: log.remark,
        at: hoursAgo(log.atHoursAgo, now),
      },
    });
  }
}

export async function seedDemoTickets(
  prisma: PrismaClient,
  rolesAndUsers: SeededUsersAndRoles,
): Promise<{ created: Ticket[]; replacedCount: number }> {
  const replacedCount = await deleteExistingDemoTickets(prisma);
  const now = new Date();
  const created: Ticket[] = [];

  // Specs reference catalog rows by name; an operator-modified catalog
  // (renamed or deleted entries) degrades those references to 未填写 instead
  // of failing.
  const categoryIdByName = new Map(
    (await prisma.ticketCategory.findMany({ where: { active: true } })).map((category) => [
      category.name,
      category.id,
    ]),
  );
  const channelIdByName = new Map(
    (await prisma.channel.findMany({ where: { active: true } })).map((channel) => [
      channel.name,
      channel.id,
    ]),
  );
  const completionStatusIdByName = new Map(
    (await prisma.completionStatus.findMany({ where: { active: true } })).map((status) => [
      status.name,
      status.id,
    ]),
  );
  const slaPolicyIdByName = new Map(
    (await prisma.slaPolicy.findMany({ where: { active: true } })).map((policy) => [
      policy.name,
      policy.id,
    ]),
  );
  const userFeedbackChannelIdByName = new Map(
    (await prisma.userFeedbackChannel.findMany({ where: { active: true } })).map((channel) => [
      channel.name,
      channel.id,
    ]),
  );
  const feedbackReceiveChannelIdByName = new Map(
    (await prisma.feedbackReceiveChannel.findMany({ where: { active: true } })).map((channel) => [
      channel.name,
      channel.id,
    ]),
  );

  for (const spec of demoTicketSpecs) {
    const createdAt = hoursAgo(spec.createdHoursAgo, now);
    const input = {
      ...spec.input,
      feedbackTime: hoursAgo(spec.createdHoursAgo + 1, now).toISOString(),
      categoryId: spec.categoryName ? (categoryIdByName.get(spec.categoryName) ?? null) : null,
      channelId: spec.channelName ? (channelIdByName.get(spec.channelName) ?? null) : null,
      slaPolicyId: slaPolicyIdByName.get(spec.slaPolicyName ?? "一般投诉") ?? null,
      userFeedbackChannelId:
        userFeedbackChannelIdByName.get(spec.userFeedbackChannelName ?? "保司400热线") ?? null,
      feedbackReceiveChannelId: spec.feedbackReceiveChannelName
        ? (feedbackReceiveChannelIdByName.get(spec.feedbackReceiveChannelName) ?? null)
        : null,
    };
    const ticket =
      spec.source === undefined || spec.source === "manual"
        ? await createTicket(
            { prisma, clock: clockAt(createdAt) },
            authUser(rolesAndUsers.users[spec.creator ?? "manager"], rolesAndUsers.roles.csManager),
            input,
          )
        : await createExternalTicket(prisma, spec, input, createdAt);

    await applyDemoState(prisma, rolesAndUsers, spec, ticket, now, completionStatusIdByName);
    created.push(ticket);
  }

  return { created, replacedCount };
}
