-- 用户投诉渠道 / 投诉信息接收渠道：自由文本 → 字典目录引用。
-- 两个目录均无应用层种子；本迁移的 INSERT 是目录真相源（映射表目标全集，
-- displayOrder = 映射表中目标首次出现顺序）。

-- CreateTable
CREATE TABLE "user_complaint_channels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_complaint_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_receive_channels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "complaint_receive_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_complaint_channels_name_key" ON "user_complaint_channels"("name");

-- CreateIndex
CREATE UNIQUE INDEX "complaint_receive_channels_name_key" ON "complaint_receive_channels"("name");

-- 用户投诉渠道初始条目（15 项，全部启用）
INSERT INTO "user_complaint_channels" ("id", "name", "displayOrder", "updatedAt") VALUES
    (gen_random_uuid()::text, '经纪400热线', 1, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '支付400热线', 2, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '保司400热线', 3, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '监管引导件', 4, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '监管正式件', 5, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '网微投诉', 6, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '黑猫', 7, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '市监/工商', 8, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '发卡行', 9, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '人行', 10, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '内部客服热线', 11, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '派出所', 12, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '消保平台', 13, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '微信商户', 14, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '政府转办', 15, CURRENT_TIMESTAMP);

-- 投诉信息接收渠道初始条目（36 项，全部启用）
INSERT INTO "complaint_receive_channels" ("id", "name", "displayOrder", "updatedAt") VALUES
    (gen_random_uuid()::text, '（微信）凯森&骏伯客诉对接群', 1, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）骏伯-融盛客户服务沟通群', 2, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）东方大地-多点客诉处理群', 3, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）富友支付&东方大地客诉处理群', 4, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）保险-凯森&易宝支付客诉群', 5, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）凯森与银商支付客诉处理群', 6, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（飞书）骏伯&泰康互联投诉沟通群', 7, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）私发', 8, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）众惠官方&骏伯客诉处理群', 9, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（飞书）骏伯-水滴分销双均分投诉处理群', 10, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）保险-东方大地与连连支付客诉处理', 11, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）东方大地保险10093023194&易宝', 12, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）利宝&骏伯 客服对接群', 13, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）信息流-客诉处理群', 14, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）泰康大健康-亿瀚客诉处理群', 15, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）通联支付&客诉处理群', 16, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）骏伯保东方大地-融盛 客户服务沟通', 17, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（飞书）骏伯&海客-客服对接群', 18, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）爱邦保险经纪（暖哇）&骏伯客服群', 19, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）泰康互联-弘梵客诉处理群', 20, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（飞书）保险微信投诉告警群', 21, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）中融多点客诉处理群', 22, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）中华-骏伯客户服务沟通群', 23, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）轻松保&骏伯客诉沟通群', 24, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）暖哇-多点 客诉处理群', 25, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）安盛&骏伯客诉沟通群', 26, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）【内部】BPO版块客诉沟通群', 27, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）保险&银商支付客诉处理群', 28, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）保险-东方大地&合利宝客诉处理', 29, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）保险-易宝支付&凯森客诉群', 30, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '内部客服热线', 31, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）保险媒体信息流-客诉处理', 32, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）骏伯&宜信客服沟通群', 33, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）众安安心保-东方大地-客诉处理群', 34, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）骏伯保东方大地-融盛 客户服务沟通群', 35, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '（微信）东方大地、陕西凯森&快钱支付客诉', 36, CURRENT_TIMESTAMP);

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "userComplaintChannelId" TEXT;
ALTER TABLE "tickets" ADD COLUMN "complaintReceiveChannelId" TEXT;

-- 映射表（迁移内临时，用完即 drop）；new = NULL 表示该旧值归「未填写」
CREATE TABLE "_map_user_complaint_channel" ("old" TEXT PRIMARY KEY, "new" TEXT);
INSERT INTO "_map_user_complaint_channel" ("old", "new") VALUES
    ('经纪400热线', '经纪400热线'),
    ('支付400热线', '支付400热线'),
    ('保司400热线', '保司400热线'),
    ('保司销管投诉', '保司400热线'),
    ('监管引导件', '监管引导件'),
    ('京东投诉', '支付400热线'),
    ('监管转办', '监管引导件'),
    ('监管转办件', '监管引导件'),
    ('支付投诉', '支付400热线'),
    ('监管局热线（12378）', '监管引导件'),
    ('经济400热线', '经纪400热线'),
    ('保司销管热线', '保司400热线'),
    ('400热线', '保司400热线'),
    ('监管正式件', '监管正式件'),
    ('网微投诉', '网微投诉'),
    ('黑猫投诉', '黑猫'),
    ('12345', '市监/工商'),
    ('监管引导', '监管引导件'),
    ('支付400热线/银行', '发卡行'),
    ('支付', '支付400热线'),
    ('支付400热线/人行', '人行'),
    ('热线投诉', '内部客服热线'),
    ('工商局', '市监/工商'),
    ('支付400热线/黑猫', '黑猫'),
    ('经纪400热线/监管引导件', '监管引导件'),
    ('监管投诉', '监管引导件'),
    ('经济热线400', '经纪400热线'),
    ('报警', '派出所'),
    ('人行投诉', '人行'),
    ('黑猫', '黑猫'),
    ('监管信访件', '监管正式件'),
    ('银行/黑猫', '发卡行'),
    ('支付400热线/黑猫/银行', '发卡行'),
    ('客服热线', '内部客服热线'),
    ('消保件', '消保平台'),
    ('监管', '监管引导件'),
    ('客服400热线', '内部客服热线'),
    ('人行', '人行'),
    ('监管投诉/湖南监管局', '监管引导件'),
    ('监管转办件（12378）', '监管引导件'),
    ('支付400热线/银行/黑猫投诉', '发卡行'),
    ('支付渠道', '支付400热线'),
    ('保司400热线/银行', '发卡行'),
    ('经纪400热线/监管', '监管引导件'),
    ('微信商户', '微信商户'),
    ('消保平台', '消保平台'),
    ('人行转办', '人行'),
    ('支付400', '支付400热线'),
    ('广点通', '内部客服热线'),
    ('消保投诉', '消保平台'),
    ('银行投诉', '发卡行'),
    ('建行', '发卡行'),
    ('政府转办', '政府转办'),
    ('福建消保协投诉件', '消保平台'),
    ('公安局', '派出所'),
    ('消保', '消保平台'),
    ('监管局热线12378', '监管引导件'),
    ('20260711145507817181222', '内部客服热线'),
    ('银行', '发卡行'),
    ('黑猫/银行', '发卡行'),
    ('无', NULL),
    ('测试', NULL),
    ('测试工单2', NULL),
    ('1111', NULL),
    ('内测工单WO107777', NULL),
    -- dev 演示数据专有值（外部来源枚举的演示残留），生产不存在
    ('社区', NULL),
    ('飞书表单', NULL);

CREATE TABLE "_map_complaint_receive_channel" ("old" TEXT PRIMARY KEY, "new" TEXT);
INSERT INTO "_map_complaint_receive_channel" ("old", "new") VALUES
    ('（微信）凯森&骏伯客诉对接群', '（微信）凯森&骏伯客诉对接群'),
    ('（微信）骏伯-融盛客户服务沟通群', '（微信）骏伯-融盛客户服务沟通群'),
    ('（微信）东方大地-多点客诉处理群', '（微信）东方大地-多点客诉处理群'),
    ('（微信）富友支付&东方大地客诉处理群', '（微信）富友支付&东方大地客诉处理群'),
    ('（微信）保险-凯森&易宝支付客诉群', '（微信）保险-凯森&易宝支付客诉群'),
    ('凯森与银商支付客诉处理群', '（微信）凯森与银商支付客诉处理群'),
    ('（飞书）骏伯&泰康互联投诉沟通群', '（飞书）骏伯&泰康互联投诉沟通群'),
    ('（微信）凯森与银商支付客诉处理群', '（微信）凯森与银商支付客诉处理群'),
    ('（微信）私发', '（微信）私发'),
    ('（微信）众惠官方&骏伯客诉处理群', '（微信）众惠官方&骏伯客诉处理群'),
    ('（飞书）骏伯-水滴分销双均分投诉处理群', '（飞书）骏伯-水滴分销双均分投诉处理群'),
    ('连连支付', '（微信）保险-东方大地与连连支付客诉处理'),
    ('（微信）东方大地保险10093023194&易宝', '（微信）东方大地保险10093023194&易宝'),
    ('凯森&骏伯客诉对接群(微信)', '（微信）凯森&骏伯客诉对接群'),
    ('（微信）利宝&骏伯 客服对接群', '（微信）利宝&骏伯 客服对接群'),
    ('（微信）信息流-客诉处理群', '（微信）信息流-客诉处理群'),
    ('（微信）泰康大健康-亿瀚客诉处理群', '（微信）泰康大健康-亿瀚客诉处理群'),
    ('（微信）通联支付&客诉处理群', '（微信）通联支付&客诉处理群'),
    ('骏伯保东方大地-融盛 客户服务沟通', '（微信）骏伯保东方大地-融盛 客户服务沟通'),
    ('（微信）骏伯保东方大地-融盛 客户服务沟通', '（微信）骏伯保东方大地-融盛 客户服务沟通'),
    ('（微信）保险-东方大地与连连支付客诉处理', '（微信）保险-东方大地与连连支付客诉处理'),
    ('（飞书）骏伯&海客-客服对接群', '（飞书）骏伯&海客-客服对接群'),
    ('（微信）爱邦保险经纪（暖哇）&骏伯客服群', '（微信）爱邦保险经纪（暖哇）&骏伯客服群'),
    ('（微信）泰康互联-弘梵客诉处理群', '（微信）泰康互联-弘梵客诉处理群'),
    ('（飞书）保险微信投诉告警群', '（飞书）保险微信投诉告警群'),
    ('东方大地保险10093023194&易宝', '（微信）东方大地保险10093023194&易宝'),
    ('(微信)凯森&骏伯客诉对接群', '（微信）凯森&骏伯客诉对接群'),
    ('（微信）保险-东方大地、凯森与连连支付客', '（微信）保险-东方大地与连连支付客诉处理'),
    ('（微信）保险-东方大地&连连支付客诉', '（微信）保险-东方大地与连连支付客诉处理'),
    ('（微信）中融多点客诉处理群', '（微信）中融多点客诉处理群'),
    ('(微信)利宝&骏伯 客服对接群', '（微信）利宝&骏伯 客服对接群'),
    ('（微信）中华-骏伯客户服务沟通群', '（微信）中华-骏伯客户服务沟通群'),
    ('保险-通联支付&客诉处理群', '（微信）通联支付&客诉处理群'),
    ('中华-骏伯客户服务沟通群', '（微信）中华-骏伯客户服务沟通群'),
    ('保险&银商支付客诉处理群', '（微信）保险&银商支付客诉处理群'),
    ('【内部】BPO版块客诉沟通群', '（微信）【内部】BPO版块客诉沟通群'),
    ('众惠官方&骏伯客诉处理群', '（微信）众惠官方&骏伯客诉处理群'),
    ('(微信)保险媒体信息流-客诉处理', '（微信）信息流-客诉处理群'),
    ('（微信）保险-通联支付&客诉处理群', '（微信）通联支付&客诉处理群'),
    ('（微信）轻松保&骏伯客诉沟通群', '（微信）轻松保&骏伯客诉沟通群'),
    ('轻松保&骏伯客诉沟通群', '（微信）轻松保&骏伯客诉沟通群'),
    ('（微信）合利宝客诉处理 C1809597282鼎立+C1809596', '（微信）保险-东方大地&合利宝客诉处理'),
    ('骏伯-水滴分销双均分投诉处理', '（飞书）骏伯-水滴分销双均分投诉处理群'),
    ('（飞书）骏伯-水滴分销双均分投诉处理', '（飞书）骏伯-水滴分销双均分投诉处理群'),
    ('（微信）保险-易宝支付&凯森客诉群', '（微信）保险-易宝支付&凯森客诉群'),
    ('泰康大健康-亿瀚客诉处理群', '（微信）泰康大健康-亿瀚客诉处理群'),
    ('（微信）暖哇-多点 客诉处理群', '（微信）暖哇-多点 客诉处理群'),
    ('（微信）安盛&骏伯客诉沟通群', '（微信）安盛&骏伯客诉沟通群'),
    ('(微信)DBT客服对接群', '内部客服热线'),
    ('（微信）保险&银商支付客诉处理群', '（微信）保险&银商支付客诉处理群'),
    ('东方大地-多点客诉处理群', '（微信）东方大地-多点客诉处理群'),
    ('(微信)东方大地-多点客诉处理群', '（微信）东方大地-多点客诉处理群'),
    ('（微信）保险-东方大地、凯森与连连支付客诉', '（微信）保险-东方大地与连连支付客诉处理'),
    ('保险-东方大地、凯森与连连支付客诉（微信）', '（微信）保险-东方大地与连连支付客诉处理'),
    ('客服热线', '内部客服热线'),
    ('（微信）保险媒体信息流-客诉处理', '（微信）保险媒体信息流-客诉处理'),
    ('（微信）保险-富友支付&东方大地客诉处理群', '（微信）富友支付&东方大地客诉处理群'),
    ('（微信）骏伯&宜信客服沟通群', '（微信）骏伯&宜信客服沟通群'),
    ('（微信）众安开平', '（微信）众安安心保-东方大地-客诉处理群'),
    ('(微信)保险-富友支付&东方大地客诉处理群', '（微信）富友支付&东方大地客诉处理群'),
    ('爱邦保险经纪（暖哇）&骏伯客服群', '（微信）爱邦保险经纪（暖哇）&骏伯客服群'),
    ('（微信）利宝 &骏伯客服对接群', '（微信）利宝&骏伯 客服对接群'),
    ('保险-富友支付&东方大地客诉处理群', '（微信）富友支付&东方大地客诉处理群'),
    ('（微信）【内部】BPO版块客诉沟通群', '（微信）【内部】BPO版块客诉沟通群'),
    ('爱邦保险经纪(暖哇)&骏伯客服群', '（微信）爱邦保险经纪（暖哇）&骏伯客服群'),
    ('（微信） 保险-富友支付&东方大地客诉处理群', '（微信）富友支付&东方大地客诉处理群'),
    ('(微信)骏伯保东方大地-融盛 客户服务沟通群', '（微信）骏伯保东方大地-融盛 客户服务沟通群'),
    ('(微信）骏伯保东方大地-融盛 客户服务沟通', '（微信）骏伯保东方大地-融盛 客户服务沟通群'),
    ('(微信)保险-东方大地、凯森与连连支付客诉', '（微信）保险-东方大地与连连支付客诉处理'),
    ('（微信）骏伯保东方大地-融盛客户服务沟通', '（微信）骏伯保东方大地-融盛 客户服务沟通群'),
    ('骏伯保东方大地-融盛客户服务沟通', '（微信）骏伯保东方大地-融盛 客户服务沟通群'),
    ('(微信)保险-东方大地、凯森与连连支付客', '（微信）保险-东方大地与连连支付客诉处理'),
    ('DBT客服对接群', '内部客服热线'),
    ('（微信）利宝&骏伯客服对接群', '（微信）利宝&骏伯 客服对接群'),
    ('中融多点客诉处理群', '（微信）中融多点客诉处理群'),
    ('（微信）东方大地、陕西凯森&快钱支付客诉', '（微信）东方大地、陕西凯森&快钱支付客诉'),
    ('保险-东方大地与连连支付客诉处理', '（微信）保险-东方大地与连连支付客诉处理'),
    ('骏伯&泰康互联投诉沟通群', '（飞书）骏伯&泰康互联投诉沟通群'),
    ('无', NULL),
    ('111', NULL),
    ('支付渠道', NULL),
    ('（微信）华泰&多点健康售后对接群', NULL);

-- 映射目标自检
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "_map_user_complaint_channel" m
        LEFT JOIN "user_complaint_channels" c ON c."name" = m."new"
        WHERE m."new" IS NOT NULL AND c."id" IS NULL
    ) THEN
        RAISE EXCEPTION 'user_complaint_channels 缺映射目标: %', (
            SELECT string_agg(m."new", ' | ') FROM "_map_user_complaint_channel" m
            LEFT JOIN "user_complaint_channels" c ON c."name" = m."new"
            WHERE m."new" IS NOT NULL AND c."id" IS NULL
        );
    END IF;
    IF EXISTS (
        SELECT 1 FROM "_map_complaint_receive_channel" m
        LEFT JOIN "complaint_receive_channels" c ON c."name" = m."new"
        WHERE m."new" IS NOT NULL AND c."id" IS NULL
    ) THEN
        RAISE EXCEPTION 'complaint_receive_channels 缺映射目标: %', (
            SELECT string_agg(m."new", ' | ') FROM "_map_complaint_receive_channel" m
            LEFT JOIN "complaint_receive_channels" c ON c."name" = m."new"
            WHERE m."new" IS NOT NULL AND c."id" IS NULL
        );
    END IF;
END $$;

-- 按映射回填
UPDATE "tickets" t
SET "userComplaintChannelId" = c."id"
FROM "_map_user_complaint_channel" m
JOIN "user_complaint_channels" c ON c."name" = m."new"
WHERE t."userComplaintChannel" = m."old";

UPDATE "tickets" t
SET "complaintReceiveChannelId" = c."id"
FROM "_map_complaint_receive_channel" m
JOIN "complaint_receive_channels" c ON c."name" = m."new"
WHERE t."complaintReceiveChannel" = m."old";

-- 白名单校验
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "tickets" t
        WHERE t."userComplaintChannel" IS NOT NULL AND t."userComplaintChannel" <> ''
          AND t."userComplaintChannel" NOT IN (SELECT "old" FROM "_map_user_complaint_channel")
    ) THEN
        RAISE EXCEPTION '存在映射未覆盖的 userComplaintChannel 值，迁移中止: %', (
            SELECT string_agg(DISTINCT t."userComplaintChannel", ' | ') FROM "tickets" t
            WHERE t."userComplaintChannel" IS NOT NULL AND t."userComplaintChannel" <> ''
              AND t."userComplaintChannel" NOT IN (SELECT "old" FROM "_map_user_complaint_channel")
        );
    END IF;
    IF EXISTS (
        SELECT 1 FROM "tickets" t
        WHERE t."complaintReceiveChannel" IS NOT NULL AND t."complaintReceiveChannel" <> ''
          AND t."complaintReceiveChannel" NOT IN (SELECT "old" FROM "_map_complaint_receive_channel")
    ) THEN
        RAISE EXCEPTION '存在映射未覆盖的 complaintReceiveChannel 值，迁移中止: %', (
            SELECT string_agg(DISTINCT t."complaintReceiveChannel", ' | ') FROM "tickets" t
            WHERE t."complaintReceiveChannel" IS NOT NULL AND t."complaintReceiveChannel" <> ''
              AND t."complaintReceiveChannel" NOT IN (SELECT "old" FROM "_map_complaint_receive_channel")
        );
    END IF;
END $$;

DROP TABLE "_map_user_complaint_channel";
DROP TABLE "_map_complaint_receive_channel";

-- 外部账号预填同口径回填与校验
ALTER TABLE "users" ADD COLUMN "prefillUserComplaintChannelId" TEXT;
ALTER TABLE "users" ADD COLUMN "prefillComplaintReceiveChannelId" TEXT;

UPDATE "users" u
SET "prefillUserComplaintChannelId" = c."id"
FROM "user_complaint_channels" c
WHERE u."prefillUserComplaintChannel" = c."name";

UPDATE "users" u
SET "prefillComplaintReceiveChannelId" = c."id"
FROM "complaint_receive_channels" c
WHERE u."prefillComplaintReceiveChannel" = c."name";

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "users" u
        WHERE u."prefillUserComplaintChannel" IS NOT NULL AND u."prefillUserComplaintChannel" <> ''
          AND u."prefillUserComplaintChannel" NOT IN (SELECT "name" FROM "user_complaint_channels")
    ) THEN
        RAISE EXCEPTION '存在目录外的 prefillUserComplaintChannel 值，迁移中止: %', (
            SELECT string_agg(DISTINCT u."prefillUserComplaintChannel", ' | ') FROM "users" u
            WHERE u."prefillUserComplaintChannel" IS NOT NULL AND u."prefillUserComplaintChannel" <> ''
              AND u."prefillUserComplaintChannel" NOT IN (SELECT "name" FROM "user_complaint_channels")
        );
    END IF;
    IF EXISTS (
        SELECT 1 FROM "users" u
        WHERE u."prefillComplaintReceiveChannel" IS NOT NULL AND u."prefillComplaintReceiveChannel" <> ''
          AND u."prefillComplaintReceiveChannel" NOT IN (SELECT "name" FROM "complaint_receive_channels")
    ) THEN
        RAISE EXCEPTION '存在目录外的 prefillComplaintReceiveChannel 值，迁移中止: %', (
            SELECT string_agg(DISTINCT u."prefillComplaintReceiveChannel", ' | ') FROM "users" u
            WHERE u."prefillComplaintReceiveChannel" IS NOT NULL AND u."prefillComplaintReceiveChannel" <> ''
              AND u."prefillComplaintReceiveChannel" NOT IN (SELECT "name" FROM "complaint_receive_channels")
        );
    END IF;
END $$;

-- CreateIndex
CREATE INDEX "tickets_userComplaintChannelId_idx" ON "tickets"("userComplaintChannelId");

-- CreateIndex
CREATE INDEX "tickets_complaintReceiveChannelId_idx" ON "tickets"("complaintReceiveChannelId");

-- CreateIndex
CREATE INDEX "users_prefillUserComplaintChannelId_idx" ON "users"("prefillUserComplaintChannelId");

-- CreateIndex
CREATE INDEX "users_prefillComplaintReceiveChannelId_idx" ON "users"("prefillComplaintReceiveChannelId");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_userComplaintChannelId_fkey" FOREIGN KEY ("userComplaintChannelId") REFERENCES "user_complaint_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_complaintReceiveChannelId_fkey" FOREIGN KEY ("complaintReceiveChannelId") REFERENCES "complaint_receive_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_prefillUserComplaintChannelId_fkey" FOREIGN KEY ("prefillUserComplaintChannelId") REFERENCES "user_complaint_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_prefillComplaintReceiveChannelId_fkey" FOREIGN KEY ("prefillComplaintReceiveChannelId") REFERENCES "complaint_receive_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "tickets" DROP COLUMN "userComplaintChannel";
ALTER TABLE "tickets" DROP COLUMN "complaintReceiveChannel";
ALTER TABLE "users" DROP COLUMN "prefillUserComplaintChannel";
ALTER TABLE "users" DROP COLUMN "prefillComplaintReceiveChannel";

UPDATE "roles"
SET "requiredTicketFields" = array_replace(
    array_replace("requiredTicketFields", 'userComplaintChannel', 'userComplaintChannelId'),
    'complaintReceiveChannel', 'complaintReceiveChannelId'
);
