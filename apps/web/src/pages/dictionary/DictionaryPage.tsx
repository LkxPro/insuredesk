import {
  channelCreateInputSchema,
  complaintReceiveChannelCreateInputSchema,
  completionStatusCreateInputSchema,
  ticketCategoryCreateInputSchema,
  userComplaintChannelCreateInputSchema,
} from "@insuredesk/shared";
import { trpc } from "@/lib/trpc";
import { CatalogAdmin, type CatalogAdminConfig } from "./CatalogAdmin";

/**
 * 字典管理: the catalog management page behind dictionary.manage. 反馈渠道,
 * 客诉类别 and 完结状态 are each a CatalogAdmin config over their own tRPC
 * namespace. 建单/编辑/完结 dropdowns, ticket detail, and exports read the
 * catalogs live, so every change here shows through immediately.
 */

const channelCatalog: CatalogAdminConfig = {
  idPrefix: "channel",
  title: "反馈渠道",
  noun: "渠道",
  nameNoun: "渠道",
  subtitle: "建单与编辑表单只列启用项；停用不影响存量工单的显示。",
  emptyDescription: "新增一个渠道后即可在建单表单中选择。",
  dialogDescription: "改名对存量工单全局生效；调整顺序即调整建单下拉的呈现顺序。",
  createInputSchema: channelCreateInputSchema,
  hooks: {
    useList: () => trpc.channel.list.useQuery(),
    useInvalidate: () => {
      const utils = trpc.useUtils();
      return () => void utils.channel.invalidate();
    },
    useCreate: (opts) => trpc.channel.create.useMutation(opts),
    useUpdate: (opts) => trpc.channel.update.useMutation(opts),
    useSetActive: (opts) => trpc.channel.setActive.useMutation(opts),
    useDelete: (opts) => trpc.channel.delete.useMutation(opts),
  },
};

const ticketCategoryCatalog: CatalogAdminConfig = {
  idPrefix: "category",
  title: "客诉类别",
  noun: "类别",
  nameNoun: "类别",
  subtitle: "建单与编辑表单只列启用项；停用不影响存量工单的显示。",
  emptyDescription: "新增一个类别后即可在建单表单中选择。",
  dialogDescription: "改名对存量工单全局生效；调整顺序即调整建单下拉的呈现顺序。",
  createInputSchema: ticketCategoryCreateInputSchema,
  hooks: {
    useList: () => trpc.ticketCategory.list.useQuery(),
    useInvalidate: () => {
      const utils = trpc.useUtils();
      return () => void utils.ticketCategory.invalidate();
    },
    useCreate: (opts) => trpc.ticketCategory.create.useMutation(opts),
    useUpdate: (opts) => trpc.ticketCategory.update.useMutation(opts),
    useSetActive: (opts) => trpc.ticketCategory.setActive.useMutation(opts),
    useDelete: (opts) => trpc.ticketCategory.delete.useMutation(opts),
  },
};

const completionStatusCatalog: CatalogAdminConfig = {
  idPrefix: "completion-status",
  title: "完结状态",
  noun: "完结状态",
  nameNoun: "状态",
  subtitle: "完结弹窗只列启用项；停用不影响存量工单的显示。",
  emptyDescription: "新增一个状态后即可在完结弹窗中选择。",
  dialogDescription: "改名对存量工单全局生效；调整顺序即调整完结弹窗下拉的呈现顺序。",
  createInputSchema: completionStatusCreateInputSchema,
  hooks: {
    useList: () => trpc.completionStatus.list.useQuery(),
    useInvalidate: () => {
      const utils = trpc.useUtils();
      return () => void utils.completionStatus.invalidate();
    },
    useCreate: (opts) => trpc.completionStatus.create.useMutation(opts),
    useUpdate: (opts) => trpc.completionStatus.update.useMutation(opts),
    useSetActive: (opts) => trpc.completionStatus.setActive.useMutation(opts),
    useDelete: (opts) => trpc.completionStatus.delete.useMutation(opts),
  },
};

const userComplaintChannelCatalog: CatalogAdminConfig = {
  idPrefix: "user-complaint-channel",
  title: "用户投诉渠道",
  noun: "用户投诉渠道",
  nameNoun: "渠道",
  subtitle: "客户发起侧的投诉途径；建单与编辑表单只列启用项，停用不影响存量工单的显示。",
  emptyDescription: "新增一个渠道后即可在建单表单中选择。",
  dialogDescription: "改名对存量工单全局生效；调整顺序即调整建单下拉的呈现顺序。",
  createInputSchema: userComplaintChannelCreateInputSchema,
  hooks: {
    useList: () => trpc.userComplaintChannel.list.useQuery(),
    useInvalidate: () => {
      const utils = trpc.useUtils();
      return () => void utils.userComplaintChannel.invalidate();
    },
    useCreate: (opts) => trpc.userComplaintChannel.create.useMutation(opts),
    useUpdate: (opts) => trpc.userComplaintChannel.update.useMutation(opts),
    useSetActive: (opts) => trpc.userComplaintChannel.setActive.useMutation(opts),
    useDelete: (opts) => trpc.userComplaintChannel.delete.useMutation(opts),
  },
};

const complaintReceiveChannelCatalog: CatalogAdminConfig = {
  idPrefix: "complaint-receive-channel",
  title: "投诉信息接收渠道",
  noun: "投诉信息接收渠道",
  nameNoun: "渠道",
  subtitle: "我方收到投诉信息的途径；建单与编辑表单只列启用项，停用不影响存量工单的显示。",
  emptyDescription: "新增一个渠道后即可在建单表单中选择。",
  dialogDescription: "改名对存量工单全局生效；调整顺序即调整建单下拉的呈现顺序。",
  createInputSchema: complaintReceiveChannelCreateInputSchema,
  hooks: {
    useList: () => trpc.complaintReceiveChannel.list.useQuery(),
    useInvalidate: () => {
      const utils = trpc.useUtils();
      return () => void utils.complaintReceiveChannel.invalidate();
    },
    useCreate: (opts) => trpc.complaintReceiveChannel.create.useMutation(opts),
    useUpdate: (opts) => trpc.complaintReceiveChannel.update.useMutation(opts),
    useSetActive: (opts) => trpc.complaintReceiveChannel.setActive.useMutation(opts),
    useDelete: (opts) => trpc.complaintReceiveChannel.delete.useMutation(opts),
  },
};

export function DictionaryPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">字典管理</h1>
        <p className="text-sm text-muted-foreground">
          维护工单可选的目录项；改名全局生效，被工单使用中的目录项只能停用。
        </p>
      </div>
      <CatalogAdmin config={channelCatalog} />
      <CatalogAdmin config={ticketCategoryCatalog} />
      <CatalogAdmin config={completionStatusCatalog} />
      <CatalogAdmin config={userComplaintChannelCatalog} />
      <CatalogAdmin config={complaintReceiveChannelCatalog} />
    </div>
  );
}
