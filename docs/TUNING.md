# Tuning the look yourself

You can change every colour, light and placement **live in the browser** and then send
one small block of settings. No round trip, no rebuild.

## Opening the panel

1. In the project folder run:

   ```
   npm run dev
   ```

2. Open the URL it prints, and add **`?tune`** to the end:

   ```
   http://localhost:5173/?tune
   ```

   A small grey panel titled **"Space Bunny look"** appears in the top-right corner.
   Without `?tune` there is no panel at all.

The panel is a development tool. It is never part of the published game.

## What the folders do

Folders mirror the file `src/game/look.js`, top to bottom.

| Folder | What it changes |
|---|---|
| **exposure** | The overall brightness of the whole picture. The single most powerful slider. |
| **sky** | The flat lilac backdrop, top and bottom. |
| **env** | The environment map — what every shiny surface reflects. |
| **floor** | The big floor disc: its two colours, its size, and the soft pink pool under the podium. |
| **cushion** | The round pad the bunny sits on. **Top** and **side** are separate now, each with its own colour and its own glow, plus roughness. This is the one that was fighting itself — now you can lift the dark side wall without brightening the top. |
| **pedestal** | The stepped podium under the bowl: pink on the left fading to lilac on the right, its glow, gloss and roughness. |
| **rim** | The ring around the bowl's mouth: its two ends and how much it glows. |
| **glass** | The bowl. Its tint, how far you can see through it (`attenuationDistance` — bigger means clearer), how much it reflects, and the pink/violet edge colours. |
| **lights** | Overall exposure, plus one folder per lamp: `key`, `pinkLeft`, `blueRight`, `blueRim`, `hemi`, `bounce`, `inner`, and **`rightFill`**. Every lamp has a colour and a strength. **`rightFill` starts at 0** — the scene looks identical until you raise it. It lights the right-hand side, which nothing else does. |
| **bunny** | The soft shadow pooling under him: how dark, how wide, and its colour. |
| **petals** | How many little spheres make up each flower head, and how big each one is. |
| **leafTones** | The three leaf colour sets — `mint`, `teal`, `blue` — each with a lit, base, shadow and glow colour. |
| **leaves** | One folder per leaf `L1`–`L7`: `x`, `z`, `len`, `lean`, `yaw`. |
| **clusters** | The two flower bunches `F1` (left) and `F2` (right): `x`, `z`, `yaw`, `leanZ`, and for `F1` also `stemX` / `stemZ` — the single spot on the cushion its stems spring from. |
| **moon** | The crescent: `x`, `z`, `height`, `leanDeg`. |

Every slider and colour picker takes effect **immediately**. You never need to reload.

Two things that are deliberately *not* in the panel, because changing them needs the
scene rebuilt rather than nudged: the physics (`CONFIG`), and the bunny's own shape.

## Sending your settings back

1. When you are happy with it, press **Copy settings**.
2. The settings are now on your clipboard, and are also printed in the browser console
   as `[look] settings blob:`. If the clipboard was blocked, copy them from the console.
3. Paste that block to the builder. That is the whole handoff — it gets pasted into
   `src/game/look.js` and the next build has your look.

The block contains **only what you actually changed**, so it stays short:

```json
{
  "lights": {
    "rightFill": {
      "intensity": 0.9
    }
  },
  "pedestal": {
    "clearcoat": 0
  }
}
```

## Coming back to it later

Your tweaks are remembered in the browser, so closing the tab and coming back keeps
them.

- **Reset all** — throw away everything and go back to how the game shipped.
- **Clear saved tweaks** — forget your saved session without changing what you see now.
- Every folder also has its own **Reset this folder**, so you can undo one area and
  keep the rest.

## Good things to try

- The podium is currently the brightest thing in the picture. Try
  **pedestal → clearcoat** at `0`. That single slider is the difference between "shiny"
  and "in front of".
- Nothing lights the right-hand side. Try **lights → rightFill → intensity** around
  `0.5` to `1`, and watch the right side of the podium and bowl wake up.
- If the bowl looks too dark inside, raise **glass → attenuationDistance** (try `40`).
  If it looks too pink, set **glass → color** towards white.
- The bunny melts into the pad. Try **bunny → shadowOpacity** up to `0.4`, or
  **cushion → topEmissive** down a little.