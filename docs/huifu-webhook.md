# 汇付投诉 Webhook

## 接口

`POST https://工单域名/api/integrations/huifu/webhook`

Content-Type 为 `application/json`。`sign` 可以位于请求头或 URL query；两处同时提供时必须一致。签名按官方 Demo 使用 `MD5(原始 UTF-8 请求体 + 终端密钥)` 十六进制；不采用 RSA。必须先验签再解析 JSON。

接受 `namespace=opps-webhook` 下的 `wechat.complaint`、`hotline.complaint`。微信商户字段为 `mer_id`，400 为 `merchantNo`，都必须在配置白名单内。完整报文持久化成功后返回 HTTP 200，纯文本 `success`。重复消息仍返回成功。未配置返回 503；验签失败 401；商户未授权 403；报文错误 400；保存失败 503。不使用 session 或开放数据 API key。

有效签名的其他事件只应答，不建单。端点校验报文若无签名会被拒绝；需用实际控台报文确认校验协议，不能为通过校验而开放未验签的建单。控台模拟事件若使用真实投诉模板，会按正常事件处理，应在测试环境或隔离测试商户联调。

## 服务器配置

部署包含本接口的版本，迁移创建 `huifu_webhook_events`、`huifu_complaints`。现有 Docker 入口会执行 `prisma migrate deploy`。

在服务器 `.env` 设置：

```dotenv
HUIFU_WEBHOOK_SECRET="填写32位字母数字终端密钥"
HUIFU_WEBHOOK_MERCHANT_IDS="填写商户汇付ID，多个用英文逗号分隔"
# HUIFU_WEBHOOK_SLA_POLICY_ID="投诉种类下启用的策略ID"
```

密钥和白名单均配置后启用。未配置 SLA 时仍建单，但不产生处理时限或 SLA 告警。填写策略时，worker 从首次收到推送的时间盖章 SLA；策略错误时消息保留等待重试。

修改 `.env` 后须重新创建 API 容器以加载配置，不能仅重启 Node；使用项目现有部署流程操作。公网 HTTPS 和反向代理由现有工单站点提供。

## 汇付配置

1. 商户控台「开发 → Webhook管理 → Webhook配置」新增端点。
2. 填部署后的上述地址。
3. 配置与服务器一致的终端密钥。
4. 订阅「微信投诉」「400消费者投诉」。只订阅需要处理的商户范围。
5. 校验、保存、发送测试事件，查看控台推送结果和本地接收记录。

## 建单与重试

- 每 5 秒处理最多 50 条到期消息。保存接收记录不等待后台建单。
- 规范化已识别事件字段后计算 SHA-256 去重；JSON 排版、键顺序变化不重复入库。
- 按 `(事件类型, 商户汇付ID, 投诉号)` 唯一映射工单；数据库行锁与事务级投诉锁防止并发消费重复建单。
- 新单来源「汇付」、种类「投诉」、未分配，通知有分配权限的用户。跳过手工工单的手机号/保单号查重。
- 微信只建摘要，订单号、金额和商户信息写入客户诉求及创建记录。金额原样展示，不推断单位，不将微信订单号当内部订单号。
- 400 正文与补充信息进入客户诉求；超过 2000 字的内容保留在处理记录及原始接收记录。投诉人明文电话进入备用联系人电话，脱敏电话仅保留原文。
- 同单新事件追加「外部留言」并通知责任人；不覆盖客服字段，不计联系次数，不自动完结或重开工单。已软删除工单的后续消息标为 `ignored`，不重建。
- 建单、投诉映射、处理记录、通知、消息处理成功标记在同一事务提交。失败保持 `pending`，5 分钟起指数退避，最大 6 小时，无自动丢弃；查看 `attempts`、`lastError`、`nextAttemptAt` 排查。
- 不包含微信详情查询、历史回填、手机号 AES 解密、对外回复或完结回传；Webhook 不承诺覆盖历史投诉或所有后续状态变化。

## 本地验证

启动 API、配置测试密钥和测试商户白名单后，在仓库根目录执行：

```powershell
$env:HUIFU_WEBHOOK_SECRET='0123456789abcdef0123456789abcdef'
$huifuBody='{"namespace":"opps-webhook","event_define_no":"wechat.complaint","complaint_id":"LOCAL-TEST-1","mer_id":"TEST-MERCHANT","complaint_datetime":"2026-10-29 16:00:00","wechat_order_no":"TEST-ORDER"}'
$huifuBytes=[Text.Encoding]::UTF8.GetBytes($huifuBody+$env:HUIFU_WEBHOOK_SECRET)
$huifuMd5=[Security.Cryptography.MD5]::Create()
$huifuSign=[BitConverter]::ToString($huifuMd5.ComputeHash($huifuBytes)).Replace('-','')
Invoke-WebRequest -Uri 'http://localhost:3000/api/integrations/huifu/webhook' -Method Post -ContentType 'application/json; charset=utf-8' -Headers @{sign=$huifuSign} -Body ([Text.Encoding]::UTF8.GetBytes($huifuBody))
```

API 自身需预先配置同一测试密钥及 `HUIFU_WEBHOOK_MERCHANT_IDS=TEST-MERCHANT`；上述临时终端变量不改变已运行服务配置。测试会创建工单，重复运行同一报文只保留一张。

官方依据及待确认项见 [接入研究](huifu-complaint-api-research.md)。
