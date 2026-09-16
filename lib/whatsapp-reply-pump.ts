// Keep verified receipts moving even while another upload or Slack request is
// awaiting the network. Only one flush can own the durable reply outbox at once.
export function startWhatsAppReplyPump(
  deliver: () => Promise<void>,
  onError: (error: unknown) => void,
  intervalMs = 1_000,
): { flush: () => Promise<void>; stop: () => Promise<void> } {
  let inFlight: Promise<void> | undefined;
  const flush = (): Promise<void> => {
    if (!inFlight) {
      inFlight = Promise.resolve().then(deliver).catch(onError).finally(() => { inFlight = undefined; });
    }
    return inFlight;
  };
  const timer = setInterval(() => { void flush(); }, intervalMs);
  return {
    flush,
    async stop() {
      clearInterval(timer);
      await inFlight;
      await flush();
    },
  };
}
