import { expect, test, type Page } from "@playwright/test";

/** Keep the test hermetic: only our own server is reachable. Map tiles fall back to a plain style. */
async function offline(page: Page) {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
}

async function joinAndTap(page: Page, name: string, fx: number, fy: number) {
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("heading", { name: `Your pin, ${name}` })).toBeVisible();
  const map = page.getByTestId("map");
  await expect(map.locator("canvas")).toBeVisible();
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await expect(page.getByTestId("my-location")).toContainText("Shared as");
}

const parse = (s: string) => s.split(",").map(Number) as [number, number];

test("two people join, the center appears, and a weight change moves it", async ({ browser }) => {
  const orgCtx = await browser.newContext();
  const org = await orgCtx.newPage();
  await offline(org);

  await org.goto("/");
  await org.getByLabel("Event name").fill("E2E lunch");
  await org.getByRole("button", { name: "Create event" }).click();
  await expect(org).toHaveURL(/\/e\/[A-Za-z0-9]+$/); // organizer token moved out of the URL
  const shareUrl = await org.getByLabel("Share link").inputValue();
  await expect(org.getByRole("region", { name: "Organizer settings" })).toBeVisible();

  await joinAndTap(org, "Ana", 0.3, 0.5);

  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await offline(guest);
  await guest.goto(shareUrl);
  await expect(guest.getByRole("region", { name: "Organizer settings" })).toHaveCount(0);
  await joinAndTap(guest, "Ben", 0.7, 0.5);

  // The center shows up for both, live.
  const orgCenter = org.getByTestId("center-coords");
  const guestCenter = guest.getByTestId("center-coords");
  await expect(org.getByTestId("trip")).toHaveCount(2);
  await expect(guest.getByTestId("trip")).toHaveCount(2);
  const before = (await orgCenter.textContent())!;
  await expect(guestCenter).toHaveText(before);

  const anaShared = parse((await org.getByTestId("my-location").textContent())!.match(/-?\d+\.\d+, -?\d+\.\d+/)![0]);
  const [, lngBefore] = parse(before);

  // Organizer triples Ana's weight; the center moves toward Ana, for everyone.
  await org.getByLabel("Weight for Ana").selectOption("3");
  await expect(orgCenter).not.toHaveText(before);
  const after = (await orgCenter.textContent())!;
  await expect(guestCenter).toHaveText(after);
  const [, lngAfter] = parse(after);
  expect(Math.abs(lngAfter - anaShared[1])).toBeLessThan(Math.abs(lngBefore - anaShared[1]));

  // The guest can't change weights.
  await expect(guest.getByLabel("Weight for Ana")).toHaveCount(0);

  await orgCtx.close();
  await guestCtx.close();
});
