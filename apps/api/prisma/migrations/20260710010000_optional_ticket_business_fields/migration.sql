-- Issue #43: 支持无必填业务字段的新建工单.
-- Every user-entered business column becomes nullable; NULL means "unknown".
-- Pure DROP NOT NULL — existing rows and their values are untouched.
ALTER TABLE "tickets"
  ALTER COLUMN "feedbackTime" DROP NOT NULL,
  ALTER COLUMN "channel" DROP NOT NULL,
  ALTER COLUMN "project" DROP NOT NULL,
  ALTER COLUMN "brokerageEntity" DROP NOT NULL,
  ALTER COLUMN "paymentChannel" DROP NOT NULL,
  ALTER COLUMN "policyNumber" DROP NOT NULL,
  ALTER COLUMN "userComplaintChannel" DROP NOT NULL,
  ALTER COLUMN "customerName" DROP NOT NULL,
  ALTER COLUMN "phone" DROP NOT NULL,
  ALTER COLUMN "customerRequest" DROP NOT NULL,
  ALTER COLUMN "nuclearBodyStatus" DROP NOT NULL,
  ALTER COLUMN "hasContacted" DROP NOT NULL,
  ALTER COLUMN "category" DROP NOT NULL,
  ALTER COLUMN "complaintLevel" DROP NOT NULL,
  ALTER COLUMN "followUpFrequency" DROP NOT NULL,
  ALTER COLUMN "firstResponseRequirement" DROP NOT NULL;
