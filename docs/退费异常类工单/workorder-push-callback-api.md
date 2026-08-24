# 工单系统对接接口文档

> 退费异常线下处理线上闭环 —— 工单推送(出向)与工单回调(入向)接口说明

---

## 接口总览

| # | 接口 | 方向 | 方法 | 路径 | 加密 |
|---|------|------|------|------|------|
| 1 | 工单推送 | 保险平台 → 工单系统 | POST | 工单系统提供 | 无(明文 JSON) |
| 2 | 工单回调 | 工单系统 → 保险平台 | POST | `/api/work/order/callback` | **AES 加密 body** |

---

# 1. 工单推送(Push)

保险平台在退费失败时,将异常信息推送至工单系统生成线下处理工单。

### 基本信息

| 项 | 值 |
|----|-----|
| **Method** | `POST` |
| **URL** | 由工单系统方提供 |
| **Content-Type** | `application/json` |
| **加密** | 无,请求体为明文 JSON |

### Request Body

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sysOrderId` | string | 是 | 系统订单号 |
| `holderName` | string | 否 | 投保人姓名 |
| `holderPhone` | string | 否 | 投保人手机号码 |
| `companyName` | string | 否 | 保司名称 |
| `productId` | string | 否 | 产品ID |
| `productName` | string | 否 | 产品名称 |
| `policyNo` | string | 否 | 保单号 |
| `endorNo` | string | 是 | 退费申请号,**幂等键**,工单系统回调时原样回传 |
| `workOrderType` | string | 是 | 工单类型,枚举见下 |
| `refundTrade` | array&lt;RefundTrade&gt; | 是 | 退费交易明细列表 |
| `expectedAmount` | string | 是 | 预期退款总金额(元) |
| `refundCreateTime` | string | 是 | 退费创建时间 |
| `failureReason` | string | 否 | 失败原因 |

**workOrderType 枚举:**

| 值 | 说明 |
|----|------|
| `卡异常-退费失败` | 银行卡异常导致退费失败 |
| `其它异常-退费失败` | 其它原因导致退费失败 |

**RefundTrade 子对象:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `tradeNo` | string | 是 | 交易编号(期数) |
| `payNo` | string | 是 | 支付流水号 |
| `expectedAmount` | string | 是 | 该期预期退款金额(元) |

### 请求示例

```json
{
  "sysOrderId": "20260818163304040016053",
  "holderName": "张三",
  "holderPhone": "138****8888",
  "companyName": "泰康在线",
  "productId": "P10001",
  "productName": "泰康百万医疗险",
  "policyNo": "P20260818000123",
  "endorNo": "20260818163304040016053_NO1_1787044393123",
  "workOrderType": "卡异常-退费失败",
  "refundTrade": [
    {
      "tradeNo": "1",
      "payNo": "PAY20260818001",
      "expectedAmount": "100.00"
    }
  ],
  "expectedAmount": "100.00",
  "refundCreateTime": "2026-08-18 16:40:00",
  "failureReason": "银行卡状态异常,退款被退回"
}
```

### Response Body

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 是否成功 |
| `code` | string | 响应码,`0000` 表示成功 |
| `message` | string | 响应消息(失败时才有值) |
| `data` | object | 响应数据 |
| `data.workOrderNumber` | string | 工单号 |

### 响应示例

**成功:**

```json
{
  "success": true,
  "code": "0000",
  "message": "",
  "data": {
    "workOrderNumber": "oa12321312312312"
  }
}
```

**失败:**

```json
{
  "success": false,
  "code": "9999",
  "message": "参数校验失败",
  "data": null
}
```

---

# 2. 工单处理结果回调(Callback)

工单系统线下处理完成后,回调保险平台通知处理结果(实际退款金额、补偿金额等)。

### 基本信息

| 项 | 值 |
|----|-----|
| **Method** | `POST` |
| **URL** | `/api/work/order/callback` |
| **Content-Type** | `application/json;charset=UTF-8` |
| **加密** | **body 字段为 AES 加密密文(Hex 编码)**,见下文加解密规范 |

### Request Body(外层报文,密文)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `channel` | string | 是 | 渠道标识,固定为 `WORK-ORDER` |
| `body` | string | 是 | **AES 加密后的密文(Hex 字符串)**,解密后为回调明文 JSON |

### 加解密规范 ⚠️

| 项 | 值 |
|----|-----|
| **渠道(channel)** | `WORK-ORDER` |
| **密钥(secret)** | `28631eafa8d346f68b3c3bbab0fac5ec` |
| **算法** | `AES/CBC/PKCS5Padding` |
| **密钥派生** | 对 secret 做 **MD5(32位小写Hex)**,取其 **前 16 字节**作为 AES-128 密钥 |
| **IV(固定)** | `8765432112345678`(ASCII 字节) |
| **密文编码** | Hex 小写字符串(非 Base64) |
| **明文编码** | UTF-8 |

**加解密代码(Java):**

```java
import org.apache.commons.codec.DecoderException;
import org.apache.commons.codec.binary.Hex;
import org.apache.commons.codec.digest.DigestUtils;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.util.Arrays;

public class ExternalOrderAesUtil {

    private static final byte[] IV = "8765432112345678".getBytes();

    /**
     * 加密
     *
     * @param keyStr  密钥(secret)
     * @param message 明文
     * @return Hex 小写密文
     */
    public static String encrypt(String keyStr, String message) {
        try {
            String keyMd5 = DigestUtils.md5Hex(keyStr);
            byte[] keys = Arrays.copyOf(keyMd5.getBytes(), 16);
            final SecretKey key = new SecretKeySpec(keys, "AES");
            final IvParameterSpec iv = new IvParameterSpec(IV);
            final Cipher cipher = Cipher.getInstance("AES/CBC/Pkcs5Padding");
            cipher.init(Cipher.ENCRYPT_MODE, key, iv);
            final byte[] plainTextBytes = message.getBytes("utf-8");
            final byte[] cipherText = cipher.doFinal(plainTextBytes);
            return Hex.encodeHexString(cipherText);
        } catch (Exception e) {
            e.printStackTrace();
        }
        return null;
    }

    /**
     * 解密
     *
     * @param keyStr     密钥(secret)
     * @param decryptStr Hex 小写密文
     * @return 明文
     */
    public static String decrypt(String keyStr, String decryptStr) {
        try {
            byte[] message = Hex.decodeHex(decryptStr);
            String keyMd5 = DigestUtils.md5Hex(keyStr);
            byte[] keys = Arrays.copyOf(keyMd5.getBytes(), 16);
            final SecretKey key = new SecretKeySpec(keys, "AES");
            final IvParameterSpec iv = new IvParameterSpec(IV);
            final Cipher decipher = Cipher.getInstance("AES/CBC/Pkcs5Padding");
            decipher.init(Cipher.DECRYPT_MODE, key, iv);
            final byte[] plainText = decipher.doFinal(message);
            return new String(plainText, "utf-8");
        } catch (Exception e) {
            e.printStackTrace();
        }
        return null;
    }
}
```

### 解密后明文(回调业务报文)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sysOrderId` | string | 是 | 系统订单号 |
| `endorNo` | string | 是 | 退费申请号,推送时的幂等键,**原样回传** |
| `actualAmount` | number | 是 | 实际退款金额(元) |
| `workOrderNumber` | string | 是 | 工单号 |
| `compensationAmount` | number | 否 | 补偿金额(诚意金,元) |
| `remark` | string | 否 | 备注信息 |
| `operator` | string | 否 | 处理人 |

### 请求示例

```http
POST /api/work/order/callback HTTP/1.1
Content-Type: application/json;charset=UTF-8
```

```json
{
  "channel": "WORK-ORDER",
  "body": "a1b2c3d4e5f6...(Hex 密文)"
}
```

**body 解密前的明文示例:**

```json
{
  "sysOrderId": "20260818163304040016053",
  "endorNo": "20260818163304040016053_NO1_1787044393123",
  "actualAmount": "100",
  "workOrderNumber": "oa12321312312312",
  "compensationAmount": "20",
  "remark": "测试测试测试",
  "operator": "testUser"
}
```

### Response Body

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 是否成功 |
| `code` | string | 响应码:`0000` 成功 / `9999` 失败 |
| `message` | string | 响应消息 |
| `data` | boolean | 处理结果:`true` 已处理(含幂等重复回调);`false` 处理失败,**工单系统应稍后重试** |

### 响应示例

**成功(已处理):**

```json
{
  "success": true,
  "code": "0000",
  "message": "",
  "data": true
}
```

**解密失败 / 参数异常:**

```json
{
  "success": false,
  "code": "9999",
  "message": "工单回调解密异常",
  "data": false
}
```

**业务处理失败(需重试):**

```json
{
  "success": false,
  "code": "9999",
  "message": "工单回调处理异常: xxx",
  "data": false
}
```

### 错误码汇总

| code | 场景 | data | 工单系统动作 |
|------|------|------|--------------|
| `0000` | 处理成功(含幂等重复回调) | `true` | 无需重试 |
| `9999` | 解密异常/参数校验失败 | `false` | 检查密钥与报文,**不要盲重试** |
| `9999` | 业务处理异常 | `false` | 稍后重试 |

---

## 附: 端到端时序

```
保险平台                              工单系统
   |                                     |
   |-- 1. 退费失败,推送工单(明文JSON) --->|  生成工单,返回 workOrderNumber
   |                                     |
   |                [线下人工处理退费]     |
   |                                     |
   |<-- 2. 回调处理结果(AES加密body) -----|
   |-- 3. 返回 {code:"0000",data:true} -->|
   |        (data:false 时工单系统重试)   |
```

**幂等设计:** `endorNo`(退费申请号)为全链路幂等键,推送时生成,回调时原样回传;重复回调返回 `code=0000, data=true` 不重复处理。
