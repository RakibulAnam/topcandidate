#!/usr/bin/env node
// npm run capture-ui [-- --url https://www.topcandidatebd.com/bn --name landing-bn] [--width 390] [--height 844] [--full]
// Screenshots of the REAL product (live site, or `npm run dev` in apps/web with --url http://localhost:3000/…)
// at phone size → shared/ui/<name>.png, ready for the `screenshot` component. With no args it
// captures the public marketing pages. Logged-in app screens: capture manually (see guides/PRODUCT_UI.md).
import puppeteer from "puppeteer-core";
import { join } from "node:path";
import { SHARED, ensureDir, parseArgs, log } from "./lib/util.mjs";

const args = parseArgs(process.argv.slice(2));
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SITE = "https://www.topcandidatebd.com";
const targets = args.url
  ? [[args.name || "capture", args.url]]
  : [
      ["landing-en", `${SITE}/`],
      ["landing-bn", `${SITE}/bn`],
      ["resume-maker", `${SITE}/resume-maker`],
      ["cover-letter", `${SITE}/cover-letter`],
      ["interview-preparation", `${SITE}/interview-preparation`],
      ["job-application-email", `${SITE}/job-application-email`],
    ];

const out = ensureDir(join(SHARED, "ui"));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  for (const [name, url] of targets) {
    const page = await browser.newPage();
    await page.setViewport({ width: Number(args.width || 390), height: Number(args.height || 844), deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    // Settle entrance animations and lazy content.
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
    await new Promise((r) => setTimeout(r, 800));
    const file = join(out, `${name}.png`);
    await page.screenshot({ path: file, fullPage: args.full !== false });
    log(`${url} → shared/ui/${name}.png`);
    await page.close();
  }
} finally {
  await browser.close();
}
