import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawnSync } from "child_process";
import { PDFDocument } from "pdf-lib";
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { conversions, slides } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { storagePut } from "./storage";

// SSE clients map: conversionId -> response writers
export const sseClients = new Map<number, Set<(data: string) => void>>();

export function sendProgress(conversionId: number, data: object) {
  const clients = sseClients.get(conversionId);
  if (clients) {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    clients.forEach((write) => write(msg));
  }
}

/**
 * Get total page count using pdf-lib (pure JS, no system binary required).
 * This is reliable in all environments including Docker containers.
 */
async function getPdfPageCount(pdfPath: string): Promise<number> {
  const buf = fs.readFileSync(pdfPath);
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  return doc.getPageCount();
}

/**
 * Convert a single PDF page to JPEG buffer using pdftoppm (poppler-utils).
 * pdftoppm is pre-installed on the server and requires no extra dependencies.
 * Note: pdftoppm names output files as <prefix>-<padded_pagenum>.jpg
 */
function convertPageToJpeg(pdfPath: string, pageNum: number, tmpDir: string): Buffer | null {
  const outPrefix = path.join(tmpDir, `p${pageNum}`);

  const result = spawnSync(
    "pdftoppm",
    [
      "-jpeg",
      "-r", "150",
      "-jpegopt", "quality=90",
      "-f", String(pageNum),
      "-l", String(pageNum),
      pdfPath,
      outPrefix,
    ],
    { timeout: 60000 }
  );

  if (result.status !== 0) {
    console.error(`pdftoppm failed for page ${pageNum}:`, result.stderr?.toString());
    return null;
  }

  // pdftoppm outputs: <prefix>-<zero_padded_pagenum>.jpg
  // e.g. prefix "p1" → "p1-01.jpg" or "p1-001.jpg" depending on total pages
  const files = fs.readdirSync(tmpDir).filter(
    (f) => f.startsWith(`p${pageNum}-`) && f.endsWith(".jpg")
  );

  if (files.length === 0) {
    console.error(`pdftoppm: no output file found for page ${pageNum} in ${tmpDir}. Files:`, fs.readdirSync(tmpDir));
    return null;
  }

  return fs.readFileSync(path.join(tmpDir, files[0]));
}

function generatePrintSlideHtml(contentHtml: string, pageNum: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  /* Reset — minimal so LLM inline styles take full effect */
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    background: #fff;
    font-family: 'Segoe UI', Arial, sans-serif;
    color: #000;
    -webkit-print-color-adjust: exact;
  }
  .slide {
    width: 1280px;
    height: 720px;          /* Strict 16:9 — never grow beyond one page */
    background: #fff !important;
    color: #000 !important;
    padding: 48px 64px 44px;
    position: relative;
    overflow: hidden;       /* Clip any content that exceeds one page */
    display: flex;
    flex-direction: column;
  }
  /* Scale down font sizes when content is dense */
  .slide .content-area {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  /* Force all backgrounds to white and all text to black */
  .slide * {
    background-color: transparent !important;
    color: #000 !important;
    border-color: #ccc !important;
  }
  /* Override any height:100vh that LLM may generate — this causes blank slides */
  .slide > div[style*="100vh"],
  .slide > div[style*="height:100"],
  .slide > div[style*="height: 100"] {
    height: auto !important;
    min-height: unset !important;
    flex: 1;
  }
  /* Restore acceptable structural borders */
  .slide [style*="border"] { border-color: #ccc !important; }
  .slide blockquote { border-left-color: #555 !important; background: #f9f9f9 !important; }
  .slide th { background: #f0f0f0 !important; }
  /* Typography defaults (overridden by LLM inline styles) */
  .slide h1 { font-size: 42px; font-weight: 700; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 3px solid #000 !important; flex-shrink: 0; }
  .slide h2 { font-size: 32px; font-weight: 700; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 2px solid #000 !important; flex-shrink: 0; }
  .slide h3 { font-size: 24px; font-weight: 700; margin-bottom: 10px; }
  .slide p { font-size: 17px; line-height: 1.5; margin-bottom: 10px; }
  .slide ul, .slide ol { margin-left: 28px; margin-bottom: 10px; }
  .slide li { font-size: 17px; line-height: 1.5; margin-bottom: 5px; }
  .slide table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  .slide th, .slide td { padding: 7px 12px; border: 1px solid #ccc; font-size: 15px; text-align: left; }
  .slide th { font-weight: bold; }
  .slide blockquote { border-left: 4px solid #555; padding: 8px 16px; margin: 10px 0; font-style: italic; font-size: 16px; }
  .page-num { position: absolute; bottom: 14px; right: 28px; font-size: 13px; color: #888 !important; }
  @media print { body { background: none; } .slide { box-shadow: none; } }
</style>
</head>
<body>
<div class="slide">
${contentHtml}
<div class="page-num">${pageNum}</div>
</div>
</body>
</html>`;
}

async function extractSlideContent(imageBuffer: Buffer, pageNum: number): Promise<string> {
  // Upload image to S3 to get a URL for the LLM
  const key = `temp-slides/page-${pageNum}-${Date.now()}.jpg`;
  const { url } = await storagePut(key, imageBuffer, "image/jpeg");

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are an expert slide layout reconstructor. Your job is to convert a slide image into a print-friendly HTML layout that FAITHFULLY REPRODUCES the original visual structure.

CRITICAL RULES:
1. FIT IN ONE PAGE: The slide container is exactly 1280×720px (16:9). ALL content MUST fit within this area. Use compact font sizes and tight spacing. If content is dense, reduce font sizes further.
2. PRESERVE LAYOUT STRUCTURE: If the slide has 2 columns → use CSS flexbox/grid with 2 columns. If it has 3 cards/boxes → render 3 side-by-side boxes. If it has a title + grid of items → keep that grid. Match the original spatial arrangement as closely as possible.
3. REMOVE ALL COLORS: Set ALL backgrounds to white (#fff or transparent). Set ALL text to black (#000 or #333). Remove all colored borders, colored backgrounds, gradients, and decorative color blocks.
4. KEEP BORDERS/STRUCTURE: Thin light-gray borders (1px solid #ccc or #ddd) are acceptable to show card/box boundaries. Do NOT remove structural boxes — just make them white with a light border.
5. PRESERVE ALL TEXT: Include every word visible in the slide — titles, subtitles, body text, bullet points, captions, labels.
6. INLINE STYLES ONLY: Use inline style attributes for layout (e.g. style="display:flex;gap:24px"). Do NOT output <style> tags, <html>, <head>, or <body> tags.
7. NEVER USE height:100vh or height:100% on any container — this causes blank slides. For centering, use style="display:flex;flex-direction:column;justify-content:center;align-items:center;"
8. FONT SIZE GUIDE (use these as maximums, reduce if content is dense):
   - Main title (h1): 36-42px
   - Section title (h2): 26-32px
   - Body text / list items: 14-18px
   - Captions / small text: 12-14px
   - Card content with many items: 13-15px
9. SPACING GUIDE: Use gap:12px-16px between cards, padding:12px-16px inside cards, margin-bottom:6px-10px between list items. Keep it compact.
10. COMMON PATTERNS:
   - Title + 3-4 cards side by side → <div style="display:flex;gap:12px"><div style="flex:1;border:1px solid #ccc;padding:14px;font-size:14px">...</div>...</div>
   - Title + bullet list → <h2 style="font-size:30px">Title</h2><ul style="font-size:16px"><li>...</li></ul>
   - Two-column layout → <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
   - Table → standard <table> with borders, font-size:14px
   - Quote/callout → <blockquote style="border-left:4px solid #000;padding:10px 16px;font-size:16px">

Output ONLY the inner HTML body content. No markdown, no code fences, no explanation.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Reconstruct this slide (page ${pageNum}) as print-friendly HTML. Preserve the original layout structure exactly, but replace ALL colors with white backgrounds and black text.`,
          },
          {
            type: "image_url",
            image_url: { url, detail: "high" },
          },
        ] as any,
      },
    ],
  });

  const rawContent = response.choices?.[0]?.message?.content;
  const content = typeof rawContent === "string" ? rawContent : "";
  // Strip any accidental code fences
  return content.replace(/```html?\n?/gi, "").replace(/```/g, "").trim();
}

export async function processPdf(conversionId: number, pdfPath: string, originalFilename: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nice-print-"));

  try {
    // Update status to processing
    await db.update(conversions).set({ status: "processing" }).where(eq(conversions.id, conversionId));
    sendProgress(conversionId, { status: "processing", message: "Reading PDF..." });

    // Get page count using pdf-lib (pure JS — works in all environments)
    const pageCount = await getPdfPageCount(pdfPath);
    if (pageCount === 0) {
      throw new Error("Could not read PDF. Please ensure the file is a valid PDF document.");
    }

    await db.update(conversions).set({ pageCount }).where(eq(conversions.id, conversionId));
    sendProgress(conversionId, {
      status: "processing",
      message: `Found ${pageCount} pages. Converting and extracting content...`,
      pageCount,
    });

    // Process each page
    const allSlideHtmls: string[] = [];
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      sendProgress(conversionId, {
        status: "processing",
        message: `Extracting content from page ${pageNum}/${pageCount}...`,
        current: pageNum,
        total: pageCount,
      });

      let contentHtml = "<p>Content could not be extracted from this page.</p>";
      try {
        const imageBuffer = convertPageToJpeg(pdfPath, pageNum, tmpDir);
        if (imageBuffer) {
          contentHtml = await extractSlideContent(imageBuffer, pageNum);
        } else {
          contentHtml = `<p><em>Could not render page ${pageNum} as image.</em></p>`;
        }
      } catch (err) {
        console.error(`Error extracting page ${pageNum}:`, err);
        contentHtml = `<p><em>Error extracting content from page ${pageNum}.</em></p>`;
      }

      const fullHtml = generatePrintSlideHtml(contentHtml, pageNum);
      allSlideHtmls.push(fullHtml);

      // Save slide to DB
      await db.insert(slides).values({
        conversionId,
        pageNum,
        htmlContent: fullHtml,
      });
    }

    // Generate combined HTML and upload to S3
    const combinedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Print-Friendly Slides — ${originalFilename}</title>
<style>
  body { background: #e0e0e0; display: flex; flex-direction: column; align-items: center; padding: 20px; font-family: Arial, sans-serif; }
  @media print { body { background: none; padding: 0; } }
</style>
</head>
<body>
${allSlideHtmls.map((h) => h.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? "").join("\n")}
</body>
</html>`;

    const downloadKey = `downloads/${conversionId}-${Date.now()}.html`;
    const { url: downloadUrl } = await storagePut(downloadKey, Buffer.from(combinedHtml, "utf-8"), "text/html");

    // Mark done
    await db.update(conversions).set({ status: "done", downloadUrl }).where(eq(conversions.id, conversionId));
    sendProgress(conversionId, { status: "done", message: "Conversion complete!", pageCount, downloadUrl });
  } catch (err: any) {
    console.error("PDF processing error:", err);
    await db.update(conversions).set({ status: "error", errorMessage: err.message ?? "Unknown error" }).where(eq(conversions.id, conversionId));
    sendProgress(conversionId, { status: "error", message: err.message ?? "Conversion failed" });
  } finally {
    // Cleanup temp dir
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    // Cleanup uploaded PDF
    try { fs.unlinkSync(pdfPath); } catch {}
  }
}

/**
 * Re-process an existing conversion: delete old slides and re-run AI extraction.
 * The original PDF is downloaded from S3 before calling this function.
 */
export async function reprocessPdf(conversionId: number, pdfPath: string, originalFilename: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Delete all existing slides for this conversion
  await db.delete(slides).where(eq(slides.conversionId, conversionId));

  // Reset status and re-run the full processing pipeline
  await db.update(conversions)
    .set({ status: "pending", errorMessage: null, downloadUrl: null, pageCount: 0 })
    .where(eq(conversions.id, conversionId));

  sendProgress(conversionId, { status: "processing", message: "Re-processing started..." });

  // Delegate to the main processPdf function
  return processPdf(conversionId, pdfPath, originalFilename);
}
