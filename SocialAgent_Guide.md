# 📚 SocialAgent — Comprehensive Architecture Guide

This document is the "Everything You Need To Know" guide for the SocialAgent project. It explains exactly how the codebase is structured, how the AI generates content, how publishing works, and how to maintain the project.

---

## 🏗️ 1. High-Level Architecture

SocialAgent is a **Next.js 16 (App Router)** application deployed on Vercel. It operates on a 3-tier architecture:

1. **Frontend (React Client Components):** Glassmorphism UI built with vanilla CSS. Interacts entirely via Next.js API routes.
2. **Backend (Next.js API Routes):** Serverless functions handling OAuth, database queries, AI generation, publishing, and analytics.
3. **Database Layer (Hybrid SQLite/Postgres):** Uses `better-sqlite3` for local development (files in `data/`) and **Neon Postgres** for production on Vercel.

### Key Workflows:
- **Generation:** User inputs a "Gist" → Backend calls **Groq API (LLaMA)** for text and **Pollinations AI** for images → Saves to DB as `draft`.
- **Approval:** User edits post → Clicks "Approve" → Status changes to `approved` with a scheduled date/time.
- **Publishing:** GitHub Actions triggers a cron every 15 minutes → API pulls `approved` posts due now → Calls Facebook/Instagram Graph APIs → Status becomes `published`.
- **Analytics:** A daily Vercel cron (+ manual "Sync Analytics" button on the dashboard) fetches live engagement stats from Meta APIs and updates the database.

---

## 📂 2. Folder Structure Explained

```text
src/
├── app/                          # Next.js App Router (Pages and APIs)
│   ├── api/
│   │   ├── analytics/sync/       # POST — manual analytics sync trigger
│   │   ├── auth/
│   │   │   ├── facebook/         # GET — starts Facebook OAuth flow
│   │   │   │   └── callback/     # GET — handles Meta OAuth callback for FB
│   │   │   ├── instagram/        # GET — starts Instagram OAuth flow
│   │   │   │   └── callback/     # GET — handles Meta OAuth callback for IG
│   │   │   └── disconnect/       # POST — revokes a stored platform token
│   │   ├── content/              # GET/POST — post CRUD; content/[id] for single posts
│   │   ├── cron/
│   │   │   ├── route.js          # GET — auto-publish cron (called by GitHub Actions)
│   │   │   └── analytics/        # GET — analytics sync cron (called by Vercel daily)
│   │   ├── generate/
│   │   │   ├── text/             # POST — AI text generation via Groq
│   │   │   └── image/            # POST — AI image generation via Pollinations
│   │   ├── plan/                 # GET/POST — monthly content plan management
│   │   ├── publish/              # POST — publishes a post to connected platforms
│   │   └── stats/                # GET — dashboard stats, connections, config status
│   ├── approve/                  # Approve & schedule drafts
│   ├── calendar/                 # Calendar view of scheduled posts
│   ├── compose/                  # Create new AI-generated posts
│   ├── data-deletion/            # Required by Meta App Review
│   ├── edit/[id]/                # Edit a single post
│   ├── plan/                     # Monthly content planner
│   ├── privacy/                  # Required by Meta App Review
│   ├── settings/                 # Platform connections & API key status
│   ├── globals.css               # Full design system (tokens, components, layout)
│   ├── layout.js                 # Root layout with Sidebar + Toast provider
│   └── page.js                   # Dashboard (stats, post list, sync button)
├── components/
│   ├── Sidebar.js                # Navigation sidebar
│   └── Toast.js                  # Toast notification context + component
└── lib/
    ├── ai/
    │   ├── text-generator.js     # Groq API wrapper (LLaMA, with fallbacks)
    │   └── image-generator.js    # Pollinations AI wrapper
    ├── platforms/
    │   ├── facebook.js           # Facebook Graph API: text + image post creation
    │   └── instagram.js          # Instagram Graph API: 2-step media publish
    ├── analytics.js              # Syncs live engagement data from Meta APIs to DB
    ├── db.js                     # Hybrid SQLite/Postgres database adapter
    └── n8n.js                    # Smart router: tries n8n first, falls back to direct API
```

**Root-level files of note:**
```text
.env.local                        # Local secrets (gitignored)
.github/workflows/auto-publish.yml  # Every-15-min GitHub Actions cron
next.config.mjs                   # Image hostname allowlist (Pollinations, Unsplash)
vercel.json                       # Vercel daily crons for publish + analytics
```

---

## 🧠 3. The AI Engine

### Text Generation ([text-generator.js](./src/lib/ai/text-generator.js))
Uses the **Groq API** for lightning-fast LLaMA inference.

| Priority | Model | Knowledge Cutoff |
|----------|-------|-----------------|
| Primary | `llama-3.3-70b-versatile` | December 2023 |
| Fallback 1 | `llama-3.1-8b-instant` | March 2023 |
| Fallback 2 | `mixtral-8x7b-32768` | Early 2024 |

If the primary model hits a rate limit, the system automatically tries the next one.

- **Platform Splitting:** When writing for "both" platforms, the AI outputs `=== FACEBOOK ===` and `=== INSTAGRAM ===` sections. The publish pipeline parses these so each platform gets tailored text.
- **Current Events:** The models have training cutoffs — always include key facts (scores, dates, names, outcomes) in your Gist when posting about recent news.

### Image Generation ([image-generator.js](./src/lib/ai/image-generator.js))
Uses **Pollinations AI** — high-quality images via URL parameters, no API key required.
- Uses strong negative prompts (`negative=text,font,letters,typography`) to prevent the AI from adding text overlays to images.

---

## ⚙️ 4. The Publishing Pipeline

Located in [src/app/api/publish/route.js](./src/app/api/publish/route.js).

**How a post reaches Facebook/Instagram:**
1. A post ID is sent to `POST /api/publish`.
2. The system checks whether n8n is available (via `smartPublish` in `n8n.js`). Since n8n is disabled on Vercel (`N8N_ENABLED=false`), it always falls through to the **direct API path**.
3. Platform-specific text is parsed out of the `=== FACEBOOK ===` / `=== INSTAGRAM ===` blocks.
4. **Facebook:** Calls `/{page_id}/photos` (image post) or `/{page_id}/feed` (text-only post).
5. **Instagram:** 2-step process:
   - Creates a Media Container by POSTing the image URL to `/{ig_user_id}/media`.
   - Polls the container status until `FINISHED`.
   - Publishes via `/{ig_user_id}/media_publish` with the container ID.
6. The post's `status`, `facebook_post_id`, `instagram_post_id`, and `published_at` are saved to the database.

---

## ⏰ 5. Auto-Publishing & Cron System

### Why GitHub Actions?
Vercel's free Hobby tier only allows one **daily** cron. Posts need to publish at their exact scheduled times throughout the day.

### Auto-Publish Cron ([auto-publish.yml](./.github/workflows/auto-publish.yml))
- Runs every **15 minutes** via GitHub Actions.
- Hits `GET /api/cron` with a `Bearer {CRON_SECRET}` header.
- The cron route fetches all `approved` posts where `scheduled_datetime ≤ now` and triggers `/api/publish` for each.

### Analytics Cron (Vercel — [vercel.json](./vercel.json))
- Runs **daily at 6 AM UTC** via `GET /api/cron/analytics`.
- Calls `syncAllPostsAnalytics()` in [analytics.js](./src/lib/analytics.js).
- Can also be triggered manually from the Dashboard via the **🔄 Sync Analytics** button (`POST /api/analytics/sync`).

---

## 📊 6. Analytics System

Located in [src/lib/analytics.js](./src/lib/analytics.js).

The `syncAllPostsAnalytics()` function iterates over every `published` post and fetches live engagement data from the Meta Graph API:

**Facebook metrics (per post):**
- Likes & Comments: `/{facebook_post_id}?fields=likes.summary(true),comments.summary(true)`
- Shares: `/{facebook_post_id}?fields=shares`
- Impressions: First resolves `page_story_id` from the photo node, then queries `/{page_story_id}/insights?metric=post_impressions`

> ⚠️ Facebook impressions require the `read_insights` permission scope on the token. If you see 0 impressions, reconnect Facebook to grant the new scope.

**Instagram metrics (per post):**
- Likes & Comments: `/{instagram_post_id}?fields=like_count,comments_count`
- Impressions: `/{instagram_post_id}/insights?metric=impressions`

> ⚠️ Instagram impressions require the `instagram_manage_insights` scope. If missing, reconnect via Settings.

All values are written to the `posts` table in both **per-platform** (`fb_likes`, `ig_likes`, etc.) and **aggregate** (`likes`, `comments`, `impressions`) columns. The Dashboard displays both breakdowns.

---

## 🗄️ 7. Database Schema ([db.js](./src/lib/db.js))

The database self-configures on boot (runs `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for every field). Works identically on SQLite and Postgres.

### `posts` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `title` | TEXT | Post title |
| `status` | TEXT | `draft` / `approved` / `published` / `failed` |
| `platform` | TEXT | `facebook` / `instagram` / `both` |
| `written_gist` | TEXT | Original user gist |
| `written_content` | TEXT | AI-generated text (may contain `=== FACEBOOK ===` sections) |
| `image_path` | TEXT | URL or `/generated/...` path |
| `scheduled_date` | TEXT | `YYYY-MM-DD` |
| `scheduled_time` | TEXT | `HH:MM` |
| `plan_id` | INTEGER | FK to `monthly_plans` |
| `facebook_post_id` | TEXT | Meta Graph API post ID after publishing |
| `instagram_post_id` | TEXT | Meta Graph API media ID after publishing |
| `published_at` | TIMESTAMP | When the post was published |
| `likes` | INTEGER | Aggregate (FB + IG) |
| `comments` | INTEGER | Aggregate (FB + IG) |
| `shares` | INTEGER | Facebook shares |
| `impressions` | INTEGER | Aggregate (FB + IG) |
| `fb_likes` | INTEGER | Facebook-only likes |
| `fb_comments` | INTEGER | Facebook-only comments |
| `fb_shares` | INTEGER | Facebook shares |
| `fb_impressions` | INTEGER | Facebook-only impressions |
| `ig_likes` | INTEGER | Instagram-only likes |
| `ig_comments` | INTEGER | Instagram-only comments |
| `ig_impressions` | INTEGER | Instagram-only impressions |

### `platform_tokens` table

| Column | Description |
|--------|-------------|
| `platform` | `facebook` or `instagram` (PK) |
| `access_token` | Long-lived Page Access Token (60-day lifetime) |
| `user_id` | Facebook Page ID or Instagram Business Account ID |
| `user_name` | Page name or `@instagram_handle` |
| `expires_at` | Token expiry timestamp |

### `monthly_plans` table
Stores AI-generated content calendars with `month`, `year`, `theme`, `goals`, and `suggested_posts` (JSON array of post ideas).

---

## 🔑 8. Setting Up Meta/Facebook Credentials

To connect Facebook and Instagram, you must create an App in the **Meta Developer Portal**.

1. Go to [developers.facebook.com](https://developers.facebook.com) → Create App → Choose **Business** type.
2. Add the **Facebook Login for Business** product.
3. Under **Valid OAuth Redirect URIs**, add both:
   ```
   https://socialagent18.vercel.app/api/auth/facebook/callback
   https://socialagent18.vercel.app/api/auth/instagram/callback
   ```
4. Copy the **App ID** and **App Secret** to Vercel Environment Variables as `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`.
5. Set `NEXT_PUBLIC_APP_URL=https://socialagent18.vercel.app` in Vercel Environment Variables.
6. In Meta Business Suite → Settings → Users → assign yourself **Full Control** of the App.

### Required OAuth Scopes (automatically requested during connect)
```
pages_show_list, pages_read_engagement, pages_manage_posts,
pages_manage_metadata, read_insights, business_management,
instagram_basic, instagram_content_publish, instagram_manage_insights
```

Both the **Connect Facebook** and **Connect Instagram** buttons request this same full set of scopes. Connecting Facebook also automatically links any Instagram Business Account connected to that Facebook Page.

---

## 🔐 9. Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | ✅ | Groq API key for LLaMA inference |
| `FACEBOOK_APP_ID` | ✅ | Meta App ID (used for both FB and IG OAuth) |
| `FACEBOOK_APP_SECRET` | ✅ | Meta App Secret |
| `INSTAGRAM_APP_ID` | Optional | Defaults to `FACEBOOK_APP_ID` if not set |
| `INSTAGRAM_APP_SECRET` | Optional | Defaults to `FACEBOOK_APP_SECRET` if not set |
| `NEXT_PUBLIC_APP_URL` | ✅ | Your deployed URL, no trailing slash: `https://socialagent18.vercel.app` |
| `DATABASE_URL` | ✅ (prod) | Neon Postgres connection string. Omit for local SQLite. |
| `CRON_SECRET` | Recommended | Shared secret to authenticate GitHub Actions cron calls |

---

## 🐛 10. Troubleshooting / Common Issues

**Images have garbled text on them**
The AI generation prompt may be using words like "poster" or "flyer". Use simpler visual descriptions without mentioning text.

**"Unknown Error" when publishing**
Check Vercel Logs. Usually means your Facebook Page Access Token expired, or Instagram isn't linked to the Facebook Page in Meta Business Suite.

**Comments or impressions show 0**
The stored token is missing the `read_insights` or `instagram_manage_insights` scope. Go to **Settings → Disconnect → Reconnect** both platforms to re-authorize with the complete scope list.

**Posts aren't auto-publishing**
- Ensure the GitHub Actions workflow (`auto-publish.yml`) is enabled in your repository.
- Verify `CRON_SECRET` matches between GitHub Secrets and Vercel Environment Variables.

**OAuth callback redirects to wrong URL / localhost**
Set `NEXT_PUBLIC_APP_URL=https://socialagent18.vercel.app` in Vercel Environment Variables (no trailing slash). The callback routes use this as the canonical redirect URI.

**"No Facebook Pages found"**
1. Make sure you're logged in as the Page Admin and granted permissions in the popup.
2. Verify the Page is owned by a **Meta Business Portfolio** — the `business_management` scope is required for pages inside Business Suite.
3. If permissions are cached, remove the app at [facebook.com/settings?tab=business_tools](https://www.facebook.com/settings?tab=business_tools), then reconnect.

**Instagram not connecting / not auto-detected**
Instagram is auto-linked when you connect Facebook (if your IG Business Account is linked to the Facebook Page in Meta Business Suite). You can also manually trigger the Instagram connection from the Settings page. Ensure your Instagram account is set to **Business** or **Creator** type.
