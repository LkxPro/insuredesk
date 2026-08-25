# 退费异常工单的 SLA 计时锚 = refundCreateTime

系统既有铁律：一切 SLA 计时自 createdAt（录入时刻）起算。但退费异常的 48h 对外承诺从用户申请退费起算，其中含平台侧最长 12h 的推送延迟（卡异常立即推送、其它异常 12h 后才推送）；锚定 createdAt（推送到达时刻）会把端到端时效放大到最多 60h，业务承诺落空。决定：`tickets` 增加盖章列 `slaAnchorAt`——普通工单 = createdAt，退费异常工单 = 平台推送的 refundCreateTime；dueAt 盖章、改策略引用重盖章、待办读时判定（首响/检查点/超时）统一消费此列。计时锚由工单种类的行为决定，不是策略的可配参数。

## Considered Options

- **维持 createdAt**——48h 业务承诺破裂（平台烧掉 12h 后客服只剩 36h，但系统以为还有 48h）。
- **读时 join 退费扩展表取 refundCreateTime**——30s 待办轮询热路径每次多 join，且 dueAt 是盖章列、改策略重盖章仍需锚值，口径分裂成两处；盖章列让所有读时口径单点消费。

## Consequences

考核口径有意分叉：退费单的超时单数按 slaAnchorAt 判定（平台推送延迟计入客服超时——48h 是对外承诺），平均完结时长仍 completionTime − createdAt（不计平台延迟）。存量工单 slaAnchorAt 回填 = createdAt，行为不变。
