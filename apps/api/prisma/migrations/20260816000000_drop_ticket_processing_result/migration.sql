-- 跟进记录的唯一事实源是 ProcessLog (action=comment)；该快照列每次跟进被覆盖为
-- 最新一条，既是冗余又让 internalOnly 跟进经外部详情泄漏。历史值无需回填：每次
-- 写入都有对应 comment ProcessLog，可完整派生。

ALTER TABLE "tickets" DROP COLUMN "processingResult";
