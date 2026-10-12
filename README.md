# Route One TCG — Card Catalog

A professional online catalog for buying and selling trading cards, plus a private **Manager** where the two of you add cards, photos, prices and grades — no coding required.

- **`index.html`** — the public catalog: hero, a **Showcase** of your best cards, a searchable/filterable grid, card detail pages with photo zoom, an "Inquire" button, and a print / save-as-PDF catalog.
- **`admin.html`** — the Manager: add/edit cards, upload photos from your phone, mark cards sold or on hold, pick Showcase cards, edit store details, and **Publish** to the live site.

It's a plain static website (HTML/CSS/JS), so it's free to host on GitHub Pages.

---

## 1. Put the site online (once)

1. Make sure the code is on a `main` branch (merge this branch into `main`, or rename it to `main` under **Settings → Branches** if it's the only branch).
2. In the repo go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, branch **`main`**, folder **`/ (root)`**, and save.
4. After a minute your catalog is live at
   `https://routeonetcg.github.io/RouteOneTCGCatalog/`
   and the Manager at
   `https://routeonetcg.github.io/RouteOneTCGCatalog/admin.html`

   Want just `https://routeonetcg.github.io/`? Rename the repository to `routeonetcg.github.io` (**Settings → General → Repository name**). The Manager detects the new name on its own.

> GitHub Pages is free for **public** repositories. A private repo needs a paid GitHub plan for Pages.

## 2. Connect the Manager to GitHub (once per person, per device)

The Manager publishes by saving your cards into this repository. Each of you needs a token:

1. On GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Resource owner:** `routeonetcg`. **Repository access:** *Only select repositories* → `RouteOneTCGCatalog`.
3. **Repository permissions → Contents:** *Read and write*. Nothing else is needed.
4. Copy the token, open the Manager → **Publishing** tab, paste it, and click **Save & test connection**.

The token is stored only in that browser. Your friend needs their own GitHub account, added as a member of the `routeonetcg` organization with write access to this repo, and their own token. If the organization requires approval for fine-grained tokens, an owner approves it under **Organization settings → Personal access tokens**.

## 3. Day-to-day use

1. Open `admin.html` → **Add card**. Fill in the name, game, set, number, condition (raw or graded slab), price and market value, and add photos (front first). On a phone, "Add photos" opens the camera.
2. Tick **Show in the Showcase** for your best cards — they get the dark, spotlighted section at the top.
3. Change status to **On hold** or **Sold** straight from the inventory list.
4. Click **Preview** to see the site with your unpublished changes.
5. Click **Publish**. The live catalog updates about a minute later.

Edits are saved as a draft on your device until you publish, so nothing goes live by accident. If your partner published while you were editing, their changes are merged in automatically; only if you both edited the **same card** does your version win.

The site comes with **example cards** so you can see the design — remove them with the **Remove examples** button in the Manager, then publish.

Set your email, Instagram, Whatnot, eBay, etc. in **Store details** — the "Inquire about this card" button emails you with the card details pre-filled.

## Backups

**Backup → Download backup** saves every card, setting and photo in one file. **Download spreadsheet (CSV)** gives you an inventory sheet for Excel/Google Sheets. Keep backups somewhere safe; restoring one loads it into your draft.

## Running it on your computer

The pages load their data with `fetch`, so open them through a small web server rather than double-clicking:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000/ and http://localhost:8000/admin.html
```

## How it's organised

```
index.html            public catalog
admin.html            manager
data/catalog.json     every card + store details (written by Publish)
images/cards/         card photos (written by Publish)
assets/css/           styles.css (site + shared), admin.css
assets/js/common.js   data model, formatting, local draft storage
assets/js/catalog.js  public catalog
assets/js/admin.js    manager
assets/js/github.js   publishing to GitHub
```

Publishing also removes photos in `images/cards/` that no card uses any more, so don't keep other files in that folder.
