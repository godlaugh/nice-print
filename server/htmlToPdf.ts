import puppeteer from "puppeteer-core";
import { PDFDocument } from "pdf-lib";

const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ||
  "/usr/bin/chromium-browser" ||
  "/usr/bin/chromium" ||
  "/usr/bin/google-chrome";

/**
 * Convert an array of per-slide HTML strings to a single PDF buffer.
 * Each slide is rendered at exactly 1280×720px (16:9) in its own Puppeteer page,
 * then all pages are merged with pdf-lib.
 * This guarantees: 1 HTML slide → exactly 1 PDF page, regardless of content height.
 */
export async function htmlToPdf(slides: string[]): Promise<Buffer> {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
    ],
  });

  const slideBuffers: Buffer[] = [];

  try {
    for (const slideHtml of slides) {
      const page = await browser.newPage();
      // Set viewport to exactly 1280×720 (16:9)
      await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
      await page.setContent(slideHtml, { waitUntil: "networkidle0", timeout: 60000 });

      // Render as a single page PDF at exactly 1280×720px
      // width/height in px → each slide becomes exactly one page
      const pdfBuffer = await page.pdf({
        width: "1280px",
        height: "720px",
        printBackground: false,
        margin: { top: "0", bottom: "0", left: "0", right: "0" },
      });

      slideBuffers.push(Buffer.from(pdfBuffer));
      await page.close();
    }
  } finally {
    await browser.close();
  }

  // Merge all single-page PDFs into one multi-page PDF using pdf-lib
  const mergedPdf = await PDFDocument.create();
  for (const buf of slideBuffers) {
    const singlePagePdf = await PDFDocument.load(buf);
    const [copiedPage] = await mergedPdf.copyPages(singlePagePdf, [0]);
    mergedPdf.addPage(copiedPage);
  }

  const mergedBytes = await mergedPdf.save();
  return Buffer.from(mergedBytes);
}
