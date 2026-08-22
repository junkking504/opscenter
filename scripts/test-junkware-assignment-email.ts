import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { classifyJunkwareAssignmentFailure } from "@/lib/junkware-assignment-failure";
import { prepareJunkwareEmailSubmission } from "@/lib/junkware-email";
import { sanitizeJunkwareCustomerEmail } from "./junkware-webforms";

function fakePageWithCustomerEmail(value: string): { page: Page; fills: string[] } {
  const fills: string[] = [];
  const control = {
    count: async () => 1,
    inputValue: async () => value,
    fill: async (next: string) => { fills.push(next); },
  };
  return {
    page: { locator: () => ({ first: () => control }) } as unknown as Page,
    fills,
  };
}

async function main(): Promise<void> {
  assert.deepEqual(prepareJunkwareEmailSubmission("   "), { controlValue: "" });
  assert.deepEqual(prepareJunkwareEmailSubmission("not-an-email"), { controlValue: "" });
  assert.deepEqual(prepareJunkwareEmailSubmission(" valid@example.com "), {
    email: "valid@example.com",
    controlValue: "valid@example.com",
  });
  const blankEmail = fakePageWithCustomerEmail("   ");
  await sanitizeJunkwareCustomerEmail(blankEmail.page);
  assert.deepEqual(blankEmail.fills, [""], "blank email must remain blank for the WebForms save");
  const invalidEmail = fakePageWithCustomerEmail("not-an-email");
  await sanitizeJunkwareCustomerEmail(invalidEmail.page);
  assert.deepEqual(invalidEmail.fills, [""], "invalid email must never reach the WebForms save");
  assert.equal(
    classifyJunkwareAssignmentFailure(
      new Error("JunkWare blocked the truck assignment: Please enter a valid email or leave it blank."),
    ),
    "manual_correction",
  );
  assert.equal(
    classifyJunkwareAssignmentFailure(new Error("JunkWare did not finish the truck assignment within 30 seconds.")), "pending");

  console.log("JunkWare assignment email and retry classification checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
