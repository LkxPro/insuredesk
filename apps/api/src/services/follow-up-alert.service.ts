import type { FollowUpCheckpointRule, RollingFollowUpRule } from "@insuredesk/shared";

/**
 * SLAPolicy 提醒规则的命中谓词，读时判定、无发送/去重概念：我的待办与
 * dashboard 的跟进欠账列共用这一份，规则语义只允许存在一个实现。
 * 窗口边界与阈值语义见各谓词注释；策略停用即退出判定，由调用方只传
 * active 策略的规则落实。
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * 窗口 [checkpoint − advance, checkpoint) 内且累计跟进（contactCount，跨改派
 * 累计）未达标即命中；窗口已过不再命中——"已过检查点不补发"由此自然成立。
 */
export function isFollowUpCheckpointHit(
  rule: FollowUpCheckpointRule,
  ticket: { slaAnchorAt: Date; contactCount: number },
  now: Date,
): boolean {
  const checkpointMs = ticket.slaAnchorAt.getTime() + rule.checkpointHours * HOUR_MS;
  const windowStartMs = checkpointMs - rule.advanceMinutes * MINUTE_MS;
  return (
    now.getTime() >= windowStartMs &&
    now.getTime() < checkpointMs &&
    ticket.contactCount < rule.requiredCount
  );
}

/**
 * 滚动时钟以上一条 comment 为基准：尚无任何 comment 时不滚——常驻的待首响
 * 告警已经把工单按在待办里。
 */
export function isRollingFollowUpHit(
  rule: RollingFollowUpRule,
  lastCommentAt: Date | null,
  now: Date,
): boolean {
  return (
    lastCommentAt !== null &&
    now.getTime() - lastCommentAt.getTime() >= rule.intervalHours * HOUR_MS
  );
}
