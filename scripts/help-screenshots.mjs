// Captures the screenshots used by the Help guides (in the app and in docs/help) into
// public/help-shots/. Run against a workspace with the demo seed data:
//
//   TAVORO_URL=https://tavoro-test.example TAVORO_EMAIL=admin@… TAVORO_PASSWORD=… npm run help:screenshots
//
// Content is found by the demo seed's names, so the shots are reproducible. Each shot
// is the viewport (1280×800) or one element on the page; settle() waits for data and
// fonts so nothing is captured half-loaded.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.TAVORO_URL ?? "").replace(/\/$/, "");
const EMAIL = process.env.TAVORO_EMAIL;
const PASSWORD = process.env.TAVORO_PASSWORD;
if (!BASE || !EMAIL || !PASSWORD) {
  console.error("Set TAVORO_URL, TAVORO_EMAIL and TAVORO_PASSWORD (an admin in a workspace with the demo seed).");
  process.exit(1);
}
const ONLY = process.argv.slice(2);
const OUT = join(process.cwd(), "public/help-shots");
mkdirSync(OUT, { recursive: true });

// The demo seed's content.
const SEED = {
  project: "Security Awareness 2027 Refresh",
  board: "Security Awareness 2027",
  card: "Phishing simulation interaction",
  privateCard: "Pilot group recruitment",
  storyboard: "Security Awareness 2027 – Module 1",
  round: { deliverable: "Module 1 storyboard", number: 2 },
  sprint: "Sprint 42",
  whiteboard: "Module 1 – learner journey",
  group: "Design Team",
  needsInfoRequest: "Excel for analysts",
  content: "HIPAA Privacy & Security 2026",
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light", deviceScaleFactor: 1 });
const page = await context.newPage();

async function settle() {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}
async function go(path) {
  await page.goto(BASE + path);
  await settle();
}
async function openLink(listPath, name) {
  await go(listPath);
  await page.getByRole("link", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  await page.waitForLoadState("load");
  await settle();
}
async function shot(name, target) {
  if (ONLY.length && !ONLY.includes(name)) return;
  const path = join(OUT, `${name}.png`);
  if (target) await target.screenshot({ path, animations: "disabled" });
  else await page.screenshot({ path, animations: "disabled" });
  console.log("✓", name);
}
const want = (...names) => !ONLY.length || names.some((n) => ONLY.includes(n));

// ── signed out ───────────────────────────────────────────────────────────────
if (want("login")) {
  await go("/login");
  await shot("login", page.locator("div.max-w-sm").first());
}

// ── sign in ──────────────────────────────────────────────────────────────────
await go("/login");
await page.fill("input[type=email]", EMAIL);
await page.fill("input[type=password]", PASSWORD);
await page.click("button[type=submit]");
await page.waitForURL(/\/dashboard/);
await settle();

if (want("dashboard")) await shot("dashboard");

if (want("board", "card-drawer", "board-list")) {
  await openLink("/boards", SEED.board);
  const boardUrl = page.url();
  await shot("board");
  if (want("card-drawer")) {
    await page.getByText(SEED.card).first().click();
    await page.getByRole("dialog").or(page.locator("[aria-label='Card details']")).first().waitFor();
    await settle();
    await shot("card-drawer");
    await page.getByRole("button", { name: "Close card" }).first().click();
    await page.waitForTimeout(500);
  }
  if (want("board-list")) {
    await page.goto(boardUrl);
    await settle();
    await page.getByRole("button", { name: "List" }).click();
    await settle();
    await shot("board-list");
  }
}

// Public board links: mark a card private, share the board, capture what a visitor sees
// and the admin list, then put everything back (unshared, not private).
if (want("card-private", "share-dialog", "public-board", "sharing-settings")) {
  await openLink("/boards", SEED.board);
  const boardUrl = page.url();
  await page.getByRole("button", { name: new RegExp(SEED.privateCard) }).first().click();
  await page.getByRole("button", { name: "Close card" }).first().waitFor();
  const visibility = page.getByRole("button", { name: /^(Not private|Private)$/ });
  if ((await visibility.innerText()).trim() === "Not private") await visibility.click();
  await page.getByRole("button", { name: "Private", exact: true }).waitFor();
  await visibility.scrollIntoViewIfNeeded();
  await settle();
  await shot("card-private");
  await page.getByRole("button", { name: "Close card" }).first().click();
  await page.waitForTimeout(500);

  await page.getByRole("button", { name: "Board settings" }).click();
  await page.getByRole("menuitem", { name: /Share publicly|Public link/ }).click();
  const create = page.getByRole("button", { name: "Create public link" });
  const dialog = page.getByRole("dialog");
  await dialog.locator("code").or(create).first().waitFor();
  if (await create.count()) await create.click();
  await dialog.locator("code").waitFor();
  await page.mouse.move(5, 5); // off every button, so nothing shows a hover state
  await page.evaluate(() => document.activeElement?.blur());
  await settle();
  await page.waitForTimeout(600); // the dialog's open animation
  if (!ONLY.length || ONLY.includes("share-dialog")) {
    // A crop of the page around the dialog (with the dimmed board behind it), rather than
    // an element shot, which renders the centred, transformed dialog washed out.
    const box = await dialog.boundingBox();
    const pad = 24;
    await page.screenshot({
      path: join(OUT, "share-dialog.png"),
      animations: "disabled",
      clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 },
    });
    console.log("✓ share-dialog");
  }
  const link = (await dialog.locator("code").innerText()).trim();
  await page.keyboard.press("Escape");

  if (want("public-board")) {
    const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
    const p2 = await fresh.newPage();
    await p2.goto(link);
    await p2.waitForLoadState("networkidle");
    await p2.evaluate(() => document.fonts.ready);
    if (!ONLY.length || ONLY.includes("public-board")) {
      await p2.screenshot({ path: join(OUT, "public-board.png") });
      console.log("✓ public-board");
    }
    await fresh.close();
  }

  if (want("sharing-settings")) {
    await go("/settings/sharing");
    await shot("sharing-settings");
  }

  // Clean up.
  await page.goto(boardUrl);
  await settle();
  await page.getByRole("button", { name: "Public link on" }).click();
  await page.getByRole("button", { name: "Stop sharing" }).click();
  await page.getByRole("button", { name: "Create public link" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: new RegExp(SEED.privateCard) }).first().click();
  await page.getByRole("button", { name: "Private", exact: true }).click();
  await page.getByRole("button", { name: "Not private" }).waitFor();
  await page.waitForTimeout(800);
}

if (want("project", "alignment")) {
  await openLink("/projects", SEED.project);
  await shot("project");
  if (want("alignment")) {
    // Bring the section heading to just under the sticky header, then take the viewport:
    // the coverage summary and the first objectives.
    await page.evaluate(() => {
      const h = [...document.querySelectorAll("h2, h3, div, span")].find((e) => e.textContent?.trim().toLowerCase() === "learning objectives & alignment");
      if (h) window.scrollBy(0, h.getBoundingClientRect().top - 72);
    });
    await settle();
    await shot("alignment");
  }
}

if (want("review-round", "feedback")) {
  await go("/my-work"); // reviews are reached from their deliverable; find the round by link text
  await openLink(`/projects`, SEED.project);
  const round = page.getByRole("link", { name: new RegExp(`Round ${SEED.round.number}`) }).first();
  if (await round.count()) {
    await round.click();
  } else {
    await page.getByText(SEED.round.deliverable).first().click();
    await page.getByRole("link", { name: new RegExp(`Round ${SEED.round.number}`) }).first().click();
  }
  await page.waitForURL(/\/reviews\//);
  await settle();
  await shot("review-round");
  if (want("feedback")) {
    await page.getByRole("link", { name: /All feedback/ }).first().click();
    await page.waitForURL(/\/reviews\/feedback\//);
    await settle();
    await shot("feedback");
  }
}

if (want("storyboard")) {
  await openLink("/storyboards", SEED.storyboard);
  // Expand the first screen (its toggle controls the screen body; the sidebar's account
  // menu also has aria-expanded, so match on aria-controls too).
  await page.locator("main [aria-controls][aria-expanded='false']").first().click();
  await settle();
  await shot("storyboard");
}

if (want("sprint-board")) {
  await go("/sprints");
  // Sprint names are editable fields, so find the row by the field's value.
  const href = await page.evaluate((name) => {
    const input = [...document.querySelectorAll("input")].find((i) => i.value === name);
    let el = input;
    while (el && !el.querySelector?.("a[href^='/sprints/']")) el = el.parentElement;
    return el?.querySelector("a[href^='/sprints/']")?.getAttribute("href") ?? null;
  }, SEED.sprint);
  if (!href) throw new Error(`No sprint called ${SEED.sprint}`);
  await go(href);
  await shot("sprint-board");
}

if (want("whiteboard")) {
  await openLink("/whiteboards", SEED.whiteboard);
  await page.locator(".excalidraw").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  await shot("whiteboard");
}

if (want("intake-queue", "intake-approve")) {
  await go("/intake");
  await shot("intake-queue");
  if (want("intake-approve")) {
    // Open the first open request's Approve dialog and capture it; nothing is approved.
    await page.locator("main li").getByRole("button", { name: "Approve" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Methodology").waitFor();
    await page.mouse.move(5, 5);
    await page.evaluate(() => document.activeElement?.blur?.());
    await settle();
    await page.waitForTimeout(600);
    const box = await dialog.boundingBox();
    const pad = 24;
    if (!ONLY.length || ONLY.includes("intake-approve")) {
      await page.screenshot({
        path: join(OUT, "intake-approve.png"),
        animations: "disabled",
        clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 },
      });
      console.log("✓ intake-approve");
    }
    await page.keyboard.press("Escape");
  }
}

if (want("intake-form")) {
  await go("/settings/intake");
  const link = (await page.locator("code").first().innerText()).trim();
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
  const p2 = await fresh.newPage();
  await p2.goto(link);
  await p2.waitForLoadState("networkidle");
  if (!ONLY.length || ONLY.includes("intake-form")) {
    await p2.screenshot({ path: join(OUT, "intake-form.png") });
    console.log("✓ intake-form");
  }
  await fresh.close();
}

if (want("intake-request", "intake-status")) {
  // A request with a conversation, and the requester's status page for it.
  await go("/intake");
  await page.getByRole("link", { name: new RegExp(SEED.needsInfoRequest) }).first().click();
  await page.waitForURL(/\/intake\/[a-z0-9]+/);
  await settle();
  await page.getByText("Conversation", { exact: true }).scrollIntoViewIfNeeded();
  await shot("intake-request");
  if (want("intake-status")) {
    const href = await page.getByRole("link", { name: "View as requester" }).getAttribute("href");
    const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
    const p2 = await fresh.newPage();
    await p2.goto(href);
    await p2.waitForLoadState("networkidle");
    await p2.evaluate(() => document.fonts.ready);
    if (!ONLY.length || ONLY.includes("intake-status")) {
      await p2.screenshot({ path: join(OUT, "intake-status.png"), fullPage: true });
      console.log("✓ intake-status");
    }
    await fresh.close();
  }
}

if (want("my-work")) {
  await go("/my-work");
  await shot("my-work");
}

if (want("content-inventory")) {
  await go("/content");
  await shot("content-inventory");
}

if (want("content-item")) {
  await openLink("/content", SEED.content);
  await shot("content-item");
}

if (want("members")) {
  await go("/settings/members");
  await shot("members");
}

if (want("group")) {
  await openLink("/settings/groups", SEED.group);
  await shot("group");
}

if (want("notifications-settings")) {
  await go("/settings/notifications");
  await shot("notifications-settings");
}

if (want("ai-settings")) {
  await go("/settings/ai");
  const connect = page.locator("section", { hasText: "Connect an AI assistant" }).first();
  await shot("ai-settings", connect);
}

if (want("sso-settings")) {
  await go("/settings/sso");
  // The overview and the first two steps: what an admin copies, and where the IdP's details go.
  const from = await page.locator("main h1, h1").first().boundingBox();
  const to = await page.locator("section", { hasText: "Identity provider details" }).first().boundingBox();
  if (!(ONLY.length && !ONLY.includes("sso-settings"))) {
    await page.screenshot({ path: join(OUT, "sso-settings.png"), fullPage: true, clip: { x: 256, y: Math.max(0, from.y - 24), width: 1280 - 256, height: to.y + to.height + 24 - Math.max(0, from.y - 24) } });
    console.log("✓ sso-settings");
  }
}

if (want("account")) {
  await go("/settings/account");
  await shot("account");
}

await browser.close();
