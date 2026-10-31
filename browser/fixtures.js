import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  cspGuard: [async ({ context }, use) => {
    const violations = [];
    await context.exposeBinding("reportCspViolation", (_, violation) => violations.push(violation));
    await context.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", event => {
        window.reportCspViolation({ directive: event.violatedDirective, blockedURI: event.blockedURI,
          source: event.sourceFile, line: event.lineNumber });
      });
    });
    await use();
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  }, { auto: true }],
});
export { expect };
