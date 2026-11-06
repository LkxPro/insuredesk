# 汇付投诉 Webhook

## 接口

`POST https://工单域名/api/integrations/huifu/webhook`

Content-Type 为 `application/json`。`sign` 可以位于请求头或 URL query；两处同时提供时必须一致。签名按官方 Demo 使用 `MD5(原始 UTF-8 请求体 + 终端密钥)` 十六进制；不采用 RSA。必须先验签再解析 JSON。

接受 `namespace=opps-webhook` 下的 `wechat.complaint`、`hotline.complaint`。微信商户字段为 `mer_id`，400 为 `merchantNo`，都必须在配置白名单内。移除附件字段后的报文持久化成功后返回 HTTP 200，纯文本 `success`。重复消息仍返回成功。未配置返回 503；验签失败 401；商户未授权 403；报文错误 400；保存失败 503。不使用 session 或开放数据 API key。

有效签名的其他事件只应答，不建单。2026-11-05 实测汇付控台「端点校验」发送无签名空对象 `{}`。配置完成后，仅当请求头和 URL 均未提供 `sign`、请求体为空对象（允许 JSON 空白）时返回 HTTP 200、纯文本 `success`，不保存事件、不创建工单。非空报文仍必须验签；带错误签名的空对象也会拒绝。控台模拟事件若使用真实投诉模板，会按正常事件处理，应在测试环境或隔离测试商户联调。

控台模拟投诉也校验报文内的商户号；模板使用的虚拟商户不在白名单时返回 403。端点所属账号的商户号不会替换报文内的 `merchantNo`。

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
- 新单来源「汇付工单系统」、种类「投诉」、未分配，通知有分配权限的用户。跳过手工工单的手机号/保单号查重。
- 400 新单业务信息默认：反馈渠道「支付」、支付渠道「汇付」、反馈信息接收渠道「汇付400工单投诉」。经纪主体取商户名称中唯一匹配的「凯森」「东方大地」「中融」，未知或多重匹配留空。所需渠道缺失或停用时保留消息重试。后续事件不覆盖客服编辑。
- 400 新单按 `complaintSource` 填入用户反馈渠道，映射见下表。缺省或未知编码留空，原码保留在接收报文；已知编码对应的目录项缺失或停用时保留消息重试。后续事件不覆盖已录入或由客服修改的渠道。
- 微信只建摘要，订单号、金额和商户信息写入客户诉求及创建记录。金额原样展示，不推断单位，不将微信订单号当内部订单号。
- 400 正文与补充信息进入客户诉求；超过 2000 字的内容保留在处理记录及接收记录。投诉人明文电话进入备用联系人电话，脱敏电话仅保留原文。
- 附件不保留：完整原始请求体验签成功后移除 `attachmentList` / `attachment_list`，不下载、不展示、不参与去重。数据库 `rawBody` 保存其余字段的 JSON，已非逐字原文；非附件的未识别字段仍保留。
- 同单新事件追加「外部留言」并通知责任人；不覆盖客服字段，不计联系次数，不自动完结或重开工单。已软删除工单的后续消息标为 `ignored`，不重建。
- 建单、投诉映射、处理记录、通知、消息处理成功标记在同一事务提交。失败保持 `pending`，5 分钟起指数退避，最大 6 小时，无自动丢弃；查看 `attempts`、`lastError`、`nextAttemptAt` 排查。
- 不包含微信详情查询、历史回填、手机号 AES 解密、对外回复或完结回传；Webhook 不承诺覆盖历史投诉或所有后续状态变化。

## 用户反馈渠道映射

码表依据：[汇付400投诉查询文档](https://paas.huifu.com/docs/api/#/shgl/tousu/api_hotline_complaint_query)。查询字段 `complaint_source` 对应推送中的 `complaintSource`；核对过程见 [字段码表研究](huifu-hotline-field-codes-research.md)。

| 编码 | 工单用户反馈渠道 |
| --- | --- |
| `01` | 支付400热线 |
| `02` | 在线客服 |
| `03` | 客服邮箱 |
| `04` | 黑猫 |
| `05` | 人行专线 |
| `06` | 消保委市监局 |
| `07` | 汇付官网 |
| `08` | 微信 |
| `09` | 支付宝 |
| `11` | 企微群投诉 |
| `12` | 小程序投诉 |
| `13` | 人行消保 |
| `14` | 人行信访 |
| `15` | 协会 |
| `16` | 服务号 |
| `17` | 银行 |
| `18` | 消费保 |

迁移只补齐缺少的目录项，复用已有名称，不修改或重新启用已有条目。来源码保留前导零，`1` 不当成 `01`，未定义的 `10` 不猜测含义。`08` 微信仍属于 400 投诉来源，不将其改成 `wechat.complaint`。

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

## 清理历史附件

部署停止旧 API 后，用新镜像在 `apps/api` 目录运行 `node prisma/remove-huifu-attachments.ts` 预览，再加 `--apply` 执行；完成后启动新 API。脚本在事务内锁定相关表，移除接收报文的附件字段、由汇付接入生成的附件尾段，重建去重摘要；客服自己写入的备注不处理。接收记录不删除，仅附件不同的待处理副本标为 ignored，避免重推重复通知。再次运行应无改动。

此清理针对在线数据库，已生成的备份和导出不被脚本修改，按各自保留策略处理。