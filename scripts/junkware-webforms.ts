import type { Page } from "@playwright/test";
import { prepareJunkwareEmailSubmission } from "@/lib/junkware-email";

const POSTBACK_TIMEOUT_MS = 30_000;

export async function sanitizeJunkwareCustomerEmail(page: Page): Promise<void> {
  const email = page.locator("#ctl00_Content_EmailTB").first();
  if (!(await email.count())) throw new Error("The JunkWare customer email control has changed.");
  const current = await email.inputValue();
  const submission = prepareJunkwareEmailSubmission(current);
  if (current !== submission.controlValue) await email.fill(submission.controlValue);
}

async function waitForWebFormsNavigation(
  page: Page,
  action: () => Promise<unknown>,
  description: string,
): Promise<void> {
  let resolveDialog: ((message: string) => void) | null = null;
  const dialogMessage = new Promise<string>((resolve) => {
    resolveDialog = resolve;
  });
  const onDialog = async (dialog: { message(): string; dismiss(): Promise<void> }) => {
    const message = dialog.message().trim();
    await dialog.dismiss();
    resolveDialog?.(message || "JunkWare blocked the form submission.");
  };
  page.once("dialog", onDialog);

  const navigation = page.waitForNavigation({
    waitUntil: "domcontentloaded",
    timeout: POSTBACK_TIMEOUT_MS,
  }).then(
    () => ({ kind: "navigation" as const }),
    () => ({ kind: "timeout" as const }),
  );

  try {
    await action();
    const outcome = await Promise.race([
      navigation,
      dialogMessage.then((message) => ({ kind: "dialog" as const, message })),
    ]);
    if (outcome.kind === "dialog") {
      throw new Error(`JunkWare blocked ${description}: ${outcome.message}`);
    }
    if (outcome.kind === "timeout") {
      throw new Error(`JunkWare did not finish ${description} within 30 seconds.`);
    }
  } finally {
    page.off("dialog", onDialog);
  }
}

export async function selectWithWebFormsPostback(
  page: Page,
  selector: string,
  value: string,
  description: string,
): Promise<void> {
  const control = page.locator(selector).first();
  if (!(await control.count())) throw new Error(`The JunkWare control is unavailable (${selector}).`);
  if (await control.inputValue() === value) return;

  await waitForWebFormsNavigation(page, () => control.evaluate((node, nextValue) => {
    const select = node as HTMLSelectElement;
    if (!Array.from(select.options).some((option) => option.value === nextValue)) {
      throw new Error("The requested JunkWare option is unavailable.");
    }
    const form = select.form;
    const eventTarget = form?.elements.namedItem("__EVENTTARGET");
    const eventArgument = form?.elements.namedItem("__EVENTARGUMENT");
    if (!form || !select.name || !(eventTarget instanceof HTMLInputElement) || !(eventArgument instanceof HTMLInputElement)) {
      throw new Error("The JunkWare postback control has changed.");
    }
    select.value = nextValue;
    // JunkWare's Microsoft PageRequestManager reads Function.arguments, which
    // throws when __doPostBack is called from Playwright's strict evaluation
    // context. Submit the equivalent WebForms event target directly.
    eventTarget.value = select.name;
    eventArgument.value = "";
    HTMLFormElement.prototype.submit.call(form);
  }, value), description);
}

export async function setInputWithWebFormsPostback(
  page: Page,
  selector: string,
  value: string,
  description: string,
): Promise<void> {
  const control = page.locator(selector).first();
  if (!(await control.count())) throw new Error(`The JunkWare control is unavailable (${selector}).`);
  if (await control.inputValue() === value) return;

  await waitForWebFormsNavigation(page, () => control.evaluate((node, nextValue) => {
    const input = node as HTMLInputElement;
    const form = input.form;
    const eventTarget = form?.elements.namedItem("__EVENTTARGET");
    const eventArgument = form?.elements.namedItem("__EVENTARGUMENT");
    if (!form || !input.name || !(eventTarget instanceof HTMLInputElement) || !(eventArgument instanceof HTMLInputElement)) {
      throw new Error("The JunkWare postback control has changed.");
    }
    input.value = nextValue;
    eventTarget.value = input.name;
    eventArgument.value = "";
    HTMLFormElement.prototype.submit.call(form);
  }, value), description);
}

export async function clickWithWebFormsCompletion(
  page: Page,
  selector: string,
  description: string,
): Promise<void> {
  const control = page.locator(selector).first();
  if (!(await control.count())) throw new Error(`The JunkWare control is unavailable (${selector}).`);
  let blockingMessage = "";
  let resolveDialog: ((message: string) => void) | null = null;
  const dialogMessage = new Promise<string>((resolve) => {
    resolveDialog = resolve;
  });
  const onDialog = async (dialog: { message(): string; dismiss(): Promise<void> }) => {
    blockingMessage = dialog.message().trim() || "JunkWare blocked the form submission.";
    await dialog.dismiss();
    resolveDialog?.(blockingMessage);
  };
  page.once("dialog", onDialog);
  const navigation = page.waitForNavigation({
    waitUntil: "domcontentloaded",
    timeout: POSTBACK_TIMEOUT_MS,
  }).then(
    () => ({ kind: "navigation" as const }),
    () => ({ kind: "timeout" as const }),
  );

  try {
    await control.click();
    const partialPostback = page.waitForFunction((buttonSelector) => {
      const button = document.querySelector<HTMLInputElement>(buttonSelector);
      const spinner = document.querySelector<HTMLElement>("#page-spinner");
      const spinnerHidden = !spinner || getComputedStyle(spinner).display === "none" || getComputedStyle(spinner).visibility === "hidden";
      return Boolean(button && !button.disabled && spinnerHidden);
    }, selector, { timeout: POSTBACK_TIMEOUT_MS }).then(
      () => ({ kind: "partial" as const }),
      () => ({ kind: "timeout" as const }),
    );
    const outcome = await Promise.race([
      navigation,
      partialPostback,
      dialogMessage.then((message) => ({ kind: "dialog" as const, message })),
    ]);
    if (blockingMessage) throw new Error(`JunkWare blocked ${description}: ${blockingMessage}`);
    if (outcome.kind === "dialog") throw new Error(`JunkWare blocked ${description}: ${outcome.message}`);
    if (outcome.kind === "timeout") {
      throw new Error(`JunkWare did not finish ${description} within 30 seconds.`);
    }
  } finally {
    page.off("dialog", onDialog);
  }
}
