-- 用户投诉渠道 → 用户反馈渠道、投诉信息接收渠道 → 反馈信息接收渠道：
-- 目录表名、外键列名与角色必填集键一并改名（仅命名，无数据语义变化）。

-- RenameTable
ALTER TABLE "user_complaint_channels" RENAME TO "user_feedback_channels";
ALTER TABLE "complaint_receive_channels" RENAME TO "feedback_receive_channels";

-- RenameColumn
ALTER TABLE "tickets" RENAME COLUMN "userComplaintChannelId" TO "userFeedbackChannelId";
ALTER TABLE "tickets" RENAME COLUMN "complaintReceiveChannelId" TO "feedbackReceiveChannelId";
ALTER TABLE "users" RENAME COLUMN "prefillUserComplaintChannelId" TO "prefillUserFeedbackChannelId";
ALTER TABLE "users" RENAME COLUMN "prefillComplaintReceiveChannelId" TO "prefillFeedbackReceiveChannelId";

-- RenameIndex（表/列改名不会连带改索引与约束名，逐一跟上 Prisma 命名约定）
ALTER INDEX "user_complaint_channels_name_key" RENAME TO "user_feedback_channels_name_key";
ALTER INDEX "complaint_receive_channels_name_key" RENAME TO "feedback_receive_channels_name_key";
ALTER INDEX "tickets_userComplaintChannelId_idx" RENAME TO "tickets_userFeedbackChannelId_idx";
ALTER INDEX "tickets_complaintReceiveChannelId_idx" RENAME TO "tickets_feedbackReceiveChannelId_idx";
ALTER INDEX "users_prefillUserComplaintChannelId_idx" RENAME TO "users_prefillUserFeedbackChannelId_idx";
ALTER INDEX "users_prefillComplaintReceiveChannelId_idx" RENAME TO "users_prefillFeedbackReceiveChannelId_idx";

-- RenameConstraint
ALTER TABLE "user_feedback_channels" RENAME CONSTRAINT "user_complaint_channels_pkey" TO "user_feedback_channels_pkey";
ALTER TABLE "feedback_receive_channels" RENAME CONSTRAINT "complaint_receive_channels_pkey" TO "feedback_receive_channels_pkey";
ALTER TABLE "tickets" RENAME CONSTRAINT "tickets_userComplaintChannelId_fkey" TO "tickets_userFeedbackChannelId_fkey";
ALTER TABLE "tickets" RENAME CONSTRAINT "tickets_complaintReceiveChannelId_fkey" TO "tickets_feedbackReceiveChannelId_fkey";
ALTER TABLE "users" RENAME CONSTRAINT "users_prefillUserComplaintChannelId_fkey" TO "users_prefillUserFeedbackChannelId_fkey";
ALTER TABLE "users" RENAME CONSTRAINT "users_prefillComplaintReceiveChannelId_fkey" TO "users_prefillFeedbackReceiveChannelId_fkey";

-- 存量角色必填集键改写：目录引用旧 key → 新 key
UPDATE "roles"
SET "requiredTicketFields" = array_replace(
    array_replace("requiredTicketFields", 'userComplaintChannelId', 'userFeedbackChannelId'),
    'complaintReceiveChannelId', 'feedbackReceiveChannelId'
)
WHERE 'userComplaintChannelId' = ANY("requiredTicketFields")
   OR 'complaintReceiveChannelId' = ANY("requiredTicketFields");
