# Nice Print

**AI-powered PDF → Print-Friendly Slides Converter**

Nice Print takes any PDF presentation and strips away heavy backgrounds, dark themes, and decorative colors, converting every page into a clean white-background, black-text HTML slide that is optimized for printing. The layout, structure, and all text content are faithfully preserved by GPT-4o vision — only the colors change.

---

## For Users

### What Nice Print Does

Many presentation PDFs are designed for screens: dark backgrounds, bright accent colors, gradient fills. When you print them directly, they consume enormous amounts of ink and produce hard-to-read results. Nice Print solves this by:

1. **Extracting each slide as a high-resolution image** using `pdftoppm` (Poppler).
2. **Sending each image to GPT-4o** with a detailed prompt that instructs the model to reconstruct the slide as inline-HTML, preserving every word and the original spatial layout (columns, cards, tables, bullet lists) while replacing all colors with white backgrounds and black text.
3. **Rendering the HTML slides** in a 1280 × 720 px (16:9) iframe so you can preview the result in your browser before downloading.
4. **Generating a downloadable PDF** where each slide is rendered by Puppeteer at exactly 1280 × 720 px — guaranteeing that the output PDF has the same number of pages as the original.

### How to Use It

| Step | Action |
|------|--------|
| 1 | Open the app and drag-and-drop (or click to browse) your PDF. Maximum file size is **16 MB**. |
| 2 | Watch the real-time progress bar as each page is extracted and processed by AI. |
| 3 | Preview all converted slides in the browser. Use the page navigation to inspect individual slides. |
| 4 | Click **Download All Slides** to download a single merged PDF ready for printing. |
| 5 | If a slide did not convert well, click **Re-process** to re-run the AI extraction on that conversion using the original stored PDF. |

### Conversion History

All your past conversions are saved and accessible via the **History** button in the top navigation. Each entry shows the original filename, page count, conversion status, and a link back to the full preview and download page.

---

## For Developers

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Tailwind CSS 4, shadcn/ui (Radix UI), Wouter (routing) |
| API layer | tRPC 11 + Superjson (end-to-end type safety) |
| Backend | Express 4, Node.js (tsx watch in dev, esbuild bundle in prod) |
| Database | MySQL / TiDB via Drizzle ORM |
| File storage | S3-compatible object storage via AWS SDK v3 |
| AI extraction | GPT-4o vision through the Manus Forge API |
| PDF rendering | Puppeteer-core + Chromium, pdf-lib (merge), pdftoppm / Poppler (page-to-image) |
| Auth | Manus OAuth (JWT session cookie) |
| Real-time progress | Server-Sent Events (SSE) |

### Project Structure

```
client/
  src/
    pages/          ← Home.tsx, Convert.tsx, History.tsx
    components/     ← shadcn/ui components
    lib/trpc.ts     ← tRPC client binding
    App.tsx         ← Route definitions
drizzle/
  schema.ts         ← Database tables (users, conversions, slides)
server/
  pdfProcessor.ts   ← Core pipeline: pdftoppm → GPT-4o → HTML → DB
  htmlToPdf.ts      ← Puppeteer renderer: HTML slides → merged PDF
  uploadRoutes.ts   ← Express routes: /api/convert, /api/convert/:id/*
  db.ts             ← Drizzle query helpers
  routers.ts        ← tRPC procedures
  storage.ts        ← S3 helpers (storagePut / storageGet)
  _core/            ← Framework plumbing (OAuth, context, LLM, env)
```

### Database Schema

Three tables are used:

- **`users`** — OAuth identity, role (`user` | `admin`), login metadata.
- **`conversions`** — One row per uploaded PDF. Tracks `status` (`pending` → `processing` → `done` | `error`), `pageCount`, the S3 key of the original PDF (`originalPdfKey`), and an optional pre-generated download URL.
- **`slides`** — One row per page per conversion. Stores the raw `htmlContent` produced by GPT-4o, keyed by `conversionId` + `pageNum`.

### Environment Variables

All credentials are injected by the Manus platform at runtime. For self-hosted deployments, set the following in your environment or `.env` file:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | MySQL / TiDB connection string (e.g. `mysql://user:pass@host:3306/db`) |
| `JWT_SECRET` | Secret used to sign session cookies |
| `VITE_APP_ID` | Manus OAuth application ID |
| `OAUTH_SERVER_URL` | Manus OAuth backend base URL |
| `VITE_OAUTH_PORTAL_URL` | Manus login portal URL (frontend) |
| `OWNER_OPEN_ID` | Owner's Manus Open ID (used for admin notifications) |
| `BUILT_IN_FORGE_API_URL` | Manus Forge API base URL (LLM + storage proxy) |
| `BUILT_IN_FORGE_API_KEY` | Bearer token for server-side Forge API calls |
| `VITE_FRONTEND_FORGE_API_KEY` | Bearer token for client-side Forge API calls |
| `VITE_FRONTEND_FORGE_API_URL` | Forge API base URL for the frontend |

> **Note on the AI backend:** The LLM calls use the Manus Forge API (`invokeLLM` helper in `server/_core/llm.ts`), which proxies to GPT-4o. For self-hosted deployments outside the Manus platform, replace `invokeLLM` with a direct OpenAI API call using `gpt-4o` and set `OPENAI_API_KEY` accordingly.

> **Note on file storage:** `storagePut` / `storageGet` in `server/storage.ts` use the Manus Forge storage proxy. For self-hosted deployments, replace these with direct AWS S3 SDK calls and set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, and `S3_BUCKET_NAME`.

### System Dependencies

The server requires **Poppler utilities** (`pdftoppm`) and **Chromium** to be installed on the host:

```bash
# Ubuntu / Debian
sudo apt-get install -y poppler-utils chromium-browser

# macOS (Homebrew)
brew install poppler
# Chromium is managed by puppeteer-core; set CHROMIUM_PATH to your Chrome/Chromium binary
```

The `CHROMIUM_PATH` environment variable controls which Chromium binary Puppeteer uses. It defaults to `/usr/bin/chromium-browser` and falls back to `/usr/bin/chromium` and `/usr/bin/google-chrome`.

### Local Development

```bash
# 1. Install dependencies
pnpm install

# 2. Set environment variables (copy and fill in values)
cp .env.example .env   # or export them directly in your shell

# 3. Push the database schema
pnpm db:push

# 4. Start the development server (tsx watch + Vite HMR)
pnpm dev
```

The dev server runs on `http://localhost:3000`. The Vite frontend and Express backend are served from the same port via a proxy configured in `vite.config.ts`.

### Production Build & Start

```bash
# Build frontend (Vite) and bundle server (esbuild)
pnpm build

# Start the production server
pnpm start
```

The build output is placed in `dist/`. The server entry point is `dist/index.js`.

### Running Tests

```bash
pnpm test
```

Tests are written with Vitest. See `server/auth.logout.test.ts` for the reference pattern.

### Deploying on Manus

Nice Print is built on the **Manus WebDev** platform. To deploy:

1. Ensure all features (`db`, `server`, `user`) are initialized via the Manus project dashboard.
2. Create a checkpoint with the Manus agent (`webdev_save_checkpoint`).
3. Click the **Publish** button in the Manus Management UI header.

The platform automatically injects all environment variables listed above, provisions the MySQL database, and sets up the S3 storage proxy — no manual configuration is required.

### Self-Hosted Deployment (Docker)

A minimal Dockerfile for self-hosted deployment:

```dockerfile
FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    poppler-utils \
    chromium \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN npm install -g pnpm && pnpm install --frozen-lockfile
RUN pnpm build

ENV NODE_ENV=production
ENV CHROMIUM_PATH=/usr/bin/chromium

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

Pass all required environment variables via `--env-file` or your container orchestration platform's secrets management.

---

## License

MIT
