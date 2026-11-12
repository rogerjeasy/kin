import { expect, test } from "@playwright/test";

import { dashboardNav, dashboardRoutes } from "../src/content/dashboard-routes";
import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { fill } from "../src/i18n/template";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { greetingFor } from "./support/greeting";
import { IDENTITY_PROVIDER } from "./support/identity-provider";
import { invitationLinkFor } from "./support/invitation-link";
import { E2E_APP_ORIGIN } from "./support/ports";
import { queuedPayoutOf, seedLetterBill } from "./support/letter-bill";
import { seedRealProposal } from "./support/real-proposal";
import { totpCode } from "./support/totp";
import { laptop, viewports } from "./support/viewports";

const { dashboard } = english;
const paths = dashboardNav.map((section) => dashboardRoutes[section]);

// The one signed-in person starts their own circle. The tests run in order:
// the first creates it, the rest read the empty circle it leaves.
test.describe.configure({ mode: "serial" });

test.describe("a person's own circle", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });

  test("is started from the form, with the person as organizer", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByLabel(dashboard.createCircle.parentName.label).fill("Meera");
    await page.getByLabel(dashboard.createCircle.name.label).fill("Mum’s circle");
    await page.getByRole("radio", { name: new RegExp(dashboard.circle.parent.levels.informed.title) }).check();
    await page.getByLabel(dashboard.createCircle.timezone.label).selectOption("Europe/London");
    await page.getByRole("button", { name: dashboard.createCircle.submit }).click();

    await expect(page).toHaveURL("/dashboard?notice=circleCreated");
    await expect(page.getByRole("status").filter({ hasText: dashboard.notices.circleCreated })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(greetingFor(dashboard.overview.greetings, IDENTITY_PROVIDER.person.name));
    await expect(page.getByRole("complementary")).toContainText("Mum’s circle");
  });

  test("shows a proper message, not demo data, wherever it has nothing yet", async ({ page }) => {
    const expected: Record<string, string> = {
      "/dashboard": dashboard.empty.activity,
      "/dashboard/approvals": dashboard.approvals.waitingEmpty,
      "/dashboard/bills": dashboard.empty.comingUp,
      "/dashboard/fairness": dashboard.empty.fairness,
      "/dashboard/record": dashboard.empty.record,
      "/dashboard/circle": dashboard.empty.agreement,
    };
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole("main")).toContainText(expected[path] ?? "");
      await expect(page.getByRole("main")).not.toContainText(/Rose|Elena|Marcus|Amara|Northfield|\$382\.18/);
      await expect(page.getByRole("note")).toHaveCount(0);
    }
  });

  test("lists the person and the parent as its members", async ({ page }) => {
    await page.goto("/dashboard/circle");
    const main = page.getByRole("main");
    await expect(main).toContainText(`${IDENTITY_PROVIDER.person.name} (${dashboard.common.you})`);
    await expect(main).toContainText("Meera");
    await expect(main).toContainText(fill(dashboard.circle.parent.title, { parent: "Meera" }));
  });

  test("takes an invitation from its organizer", async ({ page }) => {
    await page.goto("/dashboard/circle");
    await page.getByRole("main").getByRole("button", { name: dashboard.circle.members.invite }).click();
    await page.getByLabel(dashboard.circle.invite.email).fill("ravi@example.com");
    await page.getByRole("button", { name: dashboard.circle.invite.submit }).click();
    await expect(page.getByRole("region", { name: dashboard.circle.invitations.title })).toContainText("ravi@example.com");
    await expect(page.getByRole("status").filter({ hasText: dashboard.notices.invited })).toBeVisible();
  });

  test("refuses a second invitation to an address that already has one waiting", async ({ page }) => {
    await page.goto("/dashboard/circle");
    await page.getByRole("main").getByRole("button", { name: dashboard.circle.members.invite }).click();
    await page.getByLabel(dashboard.circle.invite.email).fill("Ravi@Example.com");
    await page.getByRole("button", { name: dashboard.circle.invite.submit }).click();
    await expect(page.getByRole("status").filter({ hasText: dashboard.notices.alreadyInvited })).toBeVisible();
  });

  test("invites the parent to her own place only when the organizer says so", async ({ page }) => {
    const invite = dashboard.circle.invite;
    const takeSeat = fill(invite.takeSeat, { parent: "Meera" });
    const openForm = async () => {
      await page.goto("/dashboard/circle");
      await page.getByRole("main").getByRole("button", { name: dashboard.circle.members.invite }).click();
      await page.getByLabel(invite.email).fill("meera@example.com");
      await page.getByLabel(invite.role).selectOption("parent");
    };
    await openForm();
    await expect(page.getByRole("checkbox", { name: takeSeat })).toBeVisible();
    await page.getByRole("button", { name: invite.submit }).click();
    await expect(page.getByRole("status").filter({ hasText: dashboard.notices.chooseParentSeat })).toBeVisible();
    await openForm();
    await page.getByRole("checkbox", { name: takeSeat }).check();
    await page.getByRole("button", { name: invite.submit }).click();
    await expect(page.getByRole("status").filter({ hasText: dashboard.notices.invited })).toBeVisible();
    await expect(page.getByRole("region", { name: dashboard.circle.invitations.title })).toContainText("meera@example.com");
  });

  test("emails a link that shows the invitation to someone not signed in, and grants nothing", async ({ browser }) => {
    const join = english.joinLink;
    const link = await invitationLinkFor("ravi@example.com");
    const context = await browser.newContext({ baseURL: E2E_APP_ORIGIN, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.77" } });
    try {
      const page = await context.newPage();
      const response = await page.goto(link);
      expect(response?.headers()["cache-control"]).toContain("no-store");
      expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(join.title);
      const firstName = IDENTITY_PROVIDER.person.name.split(" ")[0] ?? "";
      await expect(page.getByRole("main")).toContainText(fill(join.lede, { inviter: firstName, parent: "Meera", role: join.roles.contributor }));
      await expect(page.getByRole("main")).not.toContainText("ravi@example.com");
      await expect(page.getByRole("link", { name: join.signUp })).toHaveAttribute("href", /^\/auth\/sign-in\?next=%2Fdashboard&screen=sign-up$/);
      await expect(page.getByRole("link", { name: join.signIn })).toHaveAttribute("href", "/auth/sign-in?next=%2Fdashboard");
      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await expectNoHorizontalOverflow(page);
      }
      await page.goto(`/en/join/${"A".repeat(43)}`);
      await expect(page.getByRole("alert").filter({ hasText: join.problems.link })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  for (const viewport of viewports) {
    test(`fits at ${viewport.width}×${viewport.height} (${viewport.name}) on every screen`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const path of paths) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }
    });
  }
});

// After every test that expects the circle to have no agreement.
test.describe("a person's first agreement", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });
  const copy = dashboard.agreement;

  test("is written by the organizer and governs at once, as the only member who shares the cost", async ({ page }) => {
    await page.goto("/dashboard/circle");
    await page.getByRole("link", { name: copy.open }).click();
    await expect(page.getByRole("main")).toContainText(copy.noneOrganizer);
    const form = page.getByRole("region", { name: copy.form.writeTitle });
    await expect(form.getByLabel(`${IDENTITY_PROVIDER.person.name}’s share (%)`)).toHaveValue("100");
    await form.getByLabel("Meera decides above").fill("50");
    await form.getByLabel(copy.form.secondAbove).fill("500");
    await form.getByLabel(copy.form.ceiling).fill("2000");
    await form.getByRole("button", { name: copy.form.review }).click();
    await expect(form).toContainText(`${IDENTITY_PROVIDER.person.name} now shares the cost: 100%`);
    await expect(form).toContainText("Largest single payment: $2,000.00");
    await form.getByRole("button", { name: "Propose version 1" }).click();
    await expect(page.getByRole("region", { name: /^Version 1 · in force since/ })).toContainText("$1,000.00 from Sam Rivera");
    // Meera is kept informed rather than deciding, so her threshold is shown as not used.
    const examples = page.getByRole("region", { name: copy.examplesTitle });
    await expect(examples).toContainText("A bill of $51.00The organizer approves");
    await expect(examples).toContainText("A bill of $501.00Two yeses");
    await expect(page.getByRole("region", { name: /^Version 1 · in force since/ })).toContainText("$50.00, not used while Meera does not decide payments");
    await expectNoHorizontalOverflow(page);
  });
});

// After every test that expects the circle to be empty: these put real
// payments into it.
test.describe("a yes to real money", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });
  const { approvals, notices, common, security } = dashboard;
  const card = (page: import("@playwright/test").Page, name: string) => page.getByRole("article", { name });

  test("is refused, with the way to set up an authenticator app, while the person has none", async ({ page }) => {
    await seedRealProposal("Electric Co", 3_100);
    await page.goto("/dashboard/approvals");
    await card(page, "Electric Co").getByRole("button", { name: common.approve }).click();

    await expect(page).toHaveURL("/dashboard/approvals?notice=stepUpMissing");
    const notice = page.getByRole("status").filter({ hasText: notices.stepUpMissing });
    await notice.getByRole("link", { name: approvals.setUpAuthenticator }).click();
    await expect(page).toHaveURL("/dashboard/circle/security");
    await expect(page.getByRole("main")).toContainText(security.status.not_set);
  });

  test("never gives a session the power to change the account, nor a set-up to one that did not sign in again", async ({ page, request }) => {
    await page.goto("/dashboard/circle/security");
    const access = (await page.context().cookies()).find((cookie) => cookie.name === "__Host-kin-access");
    const claims = JSON.parse(Buffer.from(access?.value.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    expect(String(claims["scope"]).split(" ")).not.toContain("aws.cognito.signin.user.admin");
    // Confirming with no fresh sign-in behind it finds nothing to confirm.
    const confirm = await page.evaluate(async () => (await fetch("/api/account/authenticator", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "123456" }) })).status);
    expect(confirm).toBe(401);
    for (const route of ["/auth/enrol-authenticator", "/api/account/authenticator"]) {
      const foreign = await request.post(route, { form: { locale: "en" }, headers: { origin: "https://evil.example" }, maxRedirects: 0 });
      expect(foreign.status()).toBe(403);
    }
  });

  test("asks first for an authenticator app, set up after a fresh sign-in with the person's own code", async ({ page, request }) => {
    await page.goto("/dashboard/circle/security");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(security.title);
    await expect(page.getByRole("main")).toContainText(security.beginHint);
    const sessionBefore = (await page.context().cookies()).find((cookie) => cookie.name === "__Host-kin-access")?.value;
    // The button sends the person to sign in again; the stand-in signs them straight back.
    await page.getByRole("button", { name: security.begin }).click();
    await expect(page).toHaveURL("/dashboard/circle/security");
    await expect(page.getByRole("main")).toContainText(security.status.pending);
    await expect(page.getByRole("img", { name: security.qrLabel })).toBeVisible();
    // The fresh sign-in's tokens never became the session.
    expect((await page.context().cookies()).find((cookie) => cookie.name === "__Host-kin-access")?.value).toBe(sessionBefore);
    const sealed = (await page.context().cookies()).find((cookie) => cookie.name === "__Host-kin-enrolment");
    expect(sealed?.httpOnly).toBe(true);
    expect(sealed?.value).not.toMatch(/eyJ/);
    await expectNoHorizontalOverflow(page);
    const secret = (await page.getByLabel(security.manual).inputValue()).replace(/\s/g, "");
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);

    await page.getByLabel(security.code).fill("000000" === totpCode(secret) ? "111111" : "000000");
    await page.getByRole("button", { name: security.confirm }).click();
    await expect(page.getByRole("region", { name: security.panel }).getByRole("alert")).toContainText(security.errors.wrong_code);

    await page.getByLabel(security.code).fill(totpCode(secret));
    await page.getByRole("button", { name: security.confirm }).click();
    await expect(page.getByRole("status").filter({ hasText: security.done })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("main")).toContainText(security.status.enabled);
    await expect(page.getByRole("button", { name: security.begin })).toHaveCount(0);
    expect((await page.context().cookies()).some((cookie) => cookie.name === "__Host-kin-enrolment")).toBe(false);
    const account = (await (await request.get(`http://localhost:${IDENTITY_PROVIDER.port}/test/account`)).json()) as { authenticator: boolean; revocations: number; selfServiceCalls: { operation: string; allowed: boolean }[] };
    expect(account.authenticator).toBe(true);
    // Every call that changed the account carried the fresh sign-in's token, and that token was revoked after.
    expect(account.selfServiceCalls.filter((call) => call.allowed).map((call) => call.operation)).toEqual(expect.arrayContaining(["AssociateSoftwareToken", "VerifySoftwareToken", "SetUserMFAPreference"]));
    expect(account.revocations).toBeGreaterThanOrEqual(1);
  });

  test("refuses to replace an authenticator app that is set up", async ({ page }) => {
    await page.goto("/dashboard/circle/security");
    const again = await page.request.post("/auth/enrol-authenticator", { form: { locale: "en" }, headers: { origin: E2E_APP_ORIGIN }, maxRedirects: 0 });
    expect(again.status()).toBe(303);
    expect(again.headers()["location"]).toContain("/dashboard/circle/security?problem=refused");
  });

  for (const viewport of viewports) {
    test(`shows sign-in security without overflow on a ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/dashboard/circle/security");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(security.title);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("is recorded only after a fresh sign-in with a second factor", async ({ page }) => {
    await seedRealProposal("City Water", 4_000);
    await page.goto("/dashboard/approvals");
    const water = card(page, "City Water");
    await expect(water).toContainText(approvals.freshCheckNote);
    await water.getByRole("button", { name: common.approve }).click();

    await expect(page).toHaveURL("/dashboard/approvals?notice=approved");
    await expect(page.getByRole("status").filter({ hasText: notices.approved })).toBeVisible();
    await expect(card(page, "City Water")).toHaveCount(0);
    await expect(page.getByRole("main")).toContainText(approvals.answered.states.approved);
  });

  test("is not recorded when the sign-in had no second factor", async ({ page, request }) => {
    await seedRealProposal("Gas Board", 5_500);
    await request.post(`http://localhost:${IDENTITY_PROVIDER.port}/test/next-step-up-without-mfa`);
    await page.goto("/dashboard/approvals");
    await card(page, "Gas Board").getByRole("button", { name: common.approve }).click();

    await expect(page).toHaveURL("/dashboard/approvals?notice=stepUpMissing");
    await expect(page.getByRole("status").filter({ hasText: notices.stepUpMissing })).toBeVisible();
    await expect(card(page, "Gas Board").getByRole("button", { name: common.approve })).toBeVisible();
  });

  test("is refused when posted without the fresh check, while a no needs none", async ({ page }) => {
    await seedRealProposal("Phone Company", 2_900);
    await page.goto("/dashboard/approvals");
    await card(page, "Phone Company").getByRole("button", { name: common.decline }).click();
    await expect(page).toHaveURL("/dashboard/approvals?notice=rejected");
    await expect(card(page, "Phone Company")).toHaveCount(0);
  });

  test("cannot be started from another site", async ({ request }) => {
    const response = await request.post("/auth/step-up", { form: { proposal: "00000000-0000-4000-8000-000000000000", locale: "en" }, headers: { origin: "https://evil.example" }, maxRedirects: 0 });
    expect(response.status()).toBe(403);
  });
});

// After the yes to real money: the circle has an agreement in force, so a reviewed bill can be planned.
test.describe("a bill read from a letter", () => {
  test.use({ viewport: { width: laptop.width, height: laptop.height } });
  const { letters, approvals, notices, common } = dashboard;
  const copy = letters.bills;
  const bill = (page: import("@playwright/test").Page, name: string) => page.getByRole("listitem", { name });

  test("is reviewed with the company's PayPal address, and the reviewer's own fresh yes never pays it alone", async ({ page }) => {
    const billId = await seedLetterBill("Lakeside Water", 6_100, "2026-12-30");
    await page.goto("/dashboard/bills");
    const water = bill(page, "Lakeside Water");
    await expect(water).toContainText(copy.states.needs_review);
    await water.getByRole("button", { name: copy.review.open }).click();
    const form = water.getByRole("form", { name: copy.review.open });
    await expect(form.getByLabel(copy.review.amount)).toHaveValue("61.00");
    await form.getByLabel(copy.review.amount).fill("61.50");
    await form.getByLabel(copy.review.email).fill("Billing@Lakeside.Example");
    await form.getByRole("button", { name: copy.review.submit }).click();
    await expect(water).toContainText(copy.states.proposed);
    await expect(water).toContainText("$61.50");

    await page.goto("/dashboard/approvals");
    const card = page.getByRole("article", { name: "Lakeside Water bill" });
    await expect(card).toContainText(approvals.notes.newPayee);
    await expect(card).toContainText(/Paid by PayPal to b\S*@lakeside\.example, the address the family entered for Lakeside Water/);
    await expect(card).toContainText(fill(approvals.notes.raiserNotAlone, { name: IDENTITY_PROVIDER.person.name }));
    await expect(card).toContainText(approvals.freshCheckNote);
    await card.getByRole("button", { name: common.approve }).click();
    await expect(page).toHaveURL("/dashboard/approvals?notice=answered");
    await expect(page.getByRole("status").filter({ hasText: notices.answered })).toBeVisible();

    // The person reviewed it and is the circle's only member who shares the cost: their yes is recorded, and it waits for another.
    const waiting = page.getByRole("article", { name: "Lakeside Water bill" });
    await expect(waiting).toContainText(approvals.slots.independent);
    await expect(waiting.getByRole("button", { name: common.approve })).toHaveCount(0);
    expect(await queuedPayoutOf(billId)).toBeNull();
  });

  test("without a PayPal address is kept to pay outside Kin, and the member records paying it", async ({ page }) => {
    await seedLetterBill("Northfield Gas", 4_200, "2026-12-28");
    await page.goto("/dashboard/bills");
    const gas = bill(page, "Northfield Gas");
    await gas.getByRole("button", { name: copy.review.open }).click();
    const form = gas.getByRole("form", { name: copy.review.open });
    await form.getByRole("radio", { name: new RegExp(copy.review.outside) }).check();
    await expect(form.getByLabel(copy.review.email)).toHaveCount(0);
    await form.getByRole("button", { name: copy.review.submit }).click();
    await expect(gas).toContainText(copy.states.ready);
    await expect(gas).toContainText(fill(copy.outside.due, { day: "Dec 28" }));

    await gas.getByRole("button", { name: copy.outside.record }).click();
    await expect(gas).toContainText(fill(copy.outside.waiting, { name: IDENTITY_PROVIDER.person.name }));
    await expect(gas.getByRole("button", { name: copy.outside.record })).toHaveCount(0);
  });

  for (const viewport of viewports) {
    test(`fits at ${viewport.width}×${viewport.height} (${viewport.name}) with a bill's review open`, async ({ page }) => {
      const name = `Riverside Council ${viewport.width}`;
      await seedLetterBill(name, 12_345_678, "2026-12-31");
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/dashboard/bills");
      const item = bill(page, name);
      await item.getByRole("button", { name: copy.review.open }).click();
      await expect(item.getByRole("form", { name: copy.review.open })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }
});

