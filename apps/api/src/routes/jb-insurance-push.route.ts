import { timingSafeEqual } from "node:crypto";
import {
  REFUND_PUSH_CODES,
  type WorkOrderPushEnvelope,
  workOrderPushSchema,
} from "@insuredesk/shared";
import type { FastifyInstance } from "fastify";
import { systemClock } from "../clock.ts";
import { prisma } from "../db.ts";
import type { Env } from "../env.ts";
import {
  pushRefundWorkOrder,
  RefundPushNoActivePolicyError,
  RefundPushValidationError,
} from "../services/refund-push.service.ts";

function envelope(
  code: WorkOrderPushEnvelope["code"],
  message: string,
  data: WorkOrderPushEnvelope["data"] = null,
): WorkOrderPushEnvelope {
  return { success: code === REFUND_PUSH_CODES.Success, code, message, data };
}

/** 长度前置是 timingSafeEqual 的定长前提；token 长度本身不是秘密。 */
function bearerMatches(authorization: string | undefined, token: string): boolean {
  const presented = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
  if (!presented) {
    return false;
  }
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerJbInsurancePushRoute(app: FastifyInstance, env: Env) {
  app.register((scope, _opts, done) => {
    // 预处理失败（malformed JSON / 错误 content-type）也按合同应答 envelope
    scope.setErrorHandler((error, req, reply) => {
      const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
      if (statusCode >= 400 && statusCode < 500) {
        return reply
          .code(200)
          .send(envelope(REFUND_PUSH_CODES.Invalid, "参数校验失败: 请求体不是合法 JSON"));
      }
      req.log.error({ err: error }, "jb-insurance push failed");
      return reply.code(200).send(envelope(REFUND_PUSH_CODES.SystemError, "系统繁忙"));
    });

    scope.post("/api/integrations/jb-insurance/work-orders", async (req, reply) => {
      const token = env.JB_INSURANCE_PUSH_TOKEN;
      if (!token) {
        return reply.code(200).send(envelope(REFUND_PUSH_CODES.SystemError, "推送服务未配置"));
      }
      if (!bearerMatches(req.headers.authorization, token)) {
        return reply.code(401).send(envelope(REFUND_PUSH_CODES.Invalid, "认证失败"));
      }

      const parsed = workOrderPushSchema.safeParse(req.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return reply
          .code(200)
          .send(
            envelope(REFUND_PUSH_CODES.Invalid, `参数校验失败: ${issue?.message ?? "请求不合法"}`),
          );
      }

      try {
        const result = await pushRefundWorkOrder({ prisma, clock: systemClock }, parsed.data);
        return reply
          .code(200)
          .send(
            envelope(REFUND_PUSH_CODES.Success, "", { workOrderNumber: result.workOrderNumber }),
          );
      } catch (error) {
        if (error instanceof RefundPushValidationError) {
          return reply
            .code(200)
            .send(envelope(REFUND_PUSH_CODES.Invalid, `参数校验失败: ${error.message}`));
        }
        if (error instanceof RefundPushNoActivePolicyError) {
          return reply.code(200).send(envelope(REFUND_PUSH_CODES.SystemError, error.message));
        }
        req.log.error({ err: error }, "jb-insurance push failed");
        return reply.code(200).send(envelope(REFUND_PUSH_CODES.SystemError, "系统繁忙"));
      }
    });

    done();
  });
}
