# Uploading this site to GoDaddy (cPanel)

The site is plain static HTML/CSS/JS — no build step, no server code. All internal links are
relative, so it works from the domain root or from a subdirectory.

## Steps

1. Log in to GoDaddy → your hosting → **cPanel Admin**.
2. Open **File Manager** and go to `public_html/` (the web root for yardarmdev.com).
3. Upload the **contents** of this `website/` folder into `public_html/` — i.e. `index.html`,
   `support.html`, `privacy.html`, `terms.html`, `robots.txt`, `sitemap.xml`, and the `docs/`
   and `assets/` folders should sit directly inside `public_html/`.
   - Easiest way: zip the contents (`cd website && zip -r site.zip . -x UPLOAD.md`), upload
     `site.zip` via File Manager, then right-click → Extract, and delete the zip.
4. Visit https://yardarmdev.com/ and click through the nav, docs sidebar, and footer links.

Do not upload this `UPLOAD.md` file (it's harmless if you do, just unnecessary).

## Email

The site references **support@yardarmdev.com** (support page, privacy policy, terms). Create
that mailbox (or a forwarder) in cPanel → **Email Accounts** — or find-and-replace
`support@yardarmdev.com` across the HTML files with your preferred address before uploading.

## App Store listing URLs

- Marketing URL: `https://yardarmdev.com/`
- Support URL: `https://yardarmdev.com/support.html`
- Privacy Policy URL: `https://yardarmdev.com/privacy.html`

## Updating later

Re-upload the changed files. There is no cache-busting; if a stylesheet change doesn't show,
hard-refresh (Cmd+Shift+R) or clear the browser cache.
