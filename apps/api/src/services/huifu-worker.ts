import { tickHuifuWebhooks } from "./huifu-webhook.service.ts";
import type { TicketServiceDeps } from "./ticket.service.ts";

export function startHuifuWorker(
  deps: TicketServiceDeps & {
    enabled: boolean;
    slaPolicyId?: string;
    log: { info(msg: string): void; error(msg: string): void };
  },
) {
  let current: Promise<void> | undefined;
  let stopped = false;
  const tick = () => {
    if (stopped || !deps.enabled) return Promise.resolve();
    if (current) return current;
    current = (async () => {
      try {
        const result = await tickHuifuWebhooks(deps);
        if (result.retried)
          deps.log.error(`huifu webhook: ${result.retried} events awaiting retry`);
        if (result.processed) deps.log.info(`huifu webhook: ${result.processed} events processed`);
      } catch {
        deps.log.error("huifu webhook worker failed");
      }
    })().finally(() => {
      current = undefined;
    });
    return current;
  };
  const timer = setInterval(() => void tick(), 5000);
  timer.unref();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await current;
    },
  };
}
