# Publishing Space Bunny (checklist)

Live address once it is up: **https://agata-c.github.io/space-bunny/**

## 1. Before anything

- [x] Publish prep round (cleanup + production-build checks) is done.
- [x] Sounds made, wired in (R4e) and checked (R4d).
- [x] Demo video: docs/demo.mp4 (linked from both READMEs).
      Any screen recorder works. Save it as an .mp4, under 10 MB if you can.

## 2. Put it on GitHub

In the project folder:

```bash
git init -b main
git add .
git commit -m "Space Bunny 1.0"
gh repo create agata-c/space-bunny --public --source=. --remote=origin --push
```

`.gitignore` keeps out everything that is not the game: node_modules, dist, logs, the build rounds and reports,
the reference images and the Photoshop files. If you would like to publish the build log
("how I built this with AI"), remove `rounds/` and `reports/` from `.gitignore` before the commit.

## 3. Turn on GitHub Pages

On github.com/agata-c/space-bunny: **Settings > Pages > Source: GitHub Actions**.
The workflow in `.github/workflows/pages.yml` then builds and publishes the game on every push to `main`
(first run takes about a minute; follow it under the **Actions** tab).

## 4. The video

Edit `README.md` on github.com, drag the .mp4 into the editor, and GitHub gives you a link. Paste that link
where the comment says so, in both `README.md` and `README.pl.md`, and commit.

## 5. Check the live site

Open https://agata-c.github.io/space-bunny/ on your phone and on a computer: it loads, a shot flies,
PL/EN switches, and a link preview (paste the address into a chat) shows the cover image.
