# Space Bunny

**Fling a floppy bunny out of his glass bubble, catch the stars, and blast him into space.**
A cozy, pastel, low-poly browser game: pull the bunny back, let go, and watch a very floppy plush toy tumble out of his terrarium into the unknown.

**[▶ Play it now](https://agata-c.github.io/space-bunny/)** · [Polski](README.pl.md)



https://github.com/user-attachments/assets/f34bb410-2512-4292-80b9-2a53b980afba



---

## The idea

I made this game to do one thing: **shoot the bunny into space.** In the very first prototype, the best moment was the bunny flying out of his bowl into the unknown, so the whole game is built around it.

Everything you see, from the glass bowl to the last star, is generated in code: there are no 3D models and no textures. The only files are the sound effects, which I made with Suno, and the share-card image.

## How to play

| Action | What happens |
|---|---|
| Drag back from the bunny, then let go | Aim and launch (mouse or touch). The dotted line shows where he will fly |
| Touch a star | It shatters, and he falls |
| Catch 8 of the 12 stars | The finale |
| **R**, or the **restart** button | New round: new star layout, and the bunny drops back in |
| **B** | Show or hide his blush |
| **PL / EN** | Switch the language |

## What's in it

- **A very floppy bunny.** Ears, arms, legs and head hang on springs, he tumbles in the air, stretches when he flies and squashes when he lands. Hit something hard and he gets dizzy ("x x" eyes and little stars circling his head).
- **Into the unknown.** Fly off any edge of the screen: a short, silent beat, then he drops back in from above. Land outside the bowl and he vanishes in a puff of stars, then drops in again.
- **Twelve stars a round, three kinds**, all in the colours of the moon: a puffy star, a glossy orb and an outline star. They land in new places every round, always on paths a real launch can reach, and they re-arrange themselves if you resize the window.
- **The finale.** Catch the 8th star and he gets an astronaut helmet right where he is, then rockets straight up while the sky turns from pastel lilac to deep space. He shrinks into the distance and becomes a twinkling star.
- **Polish and English**, switchable in the game.

## How it was made

This project is an experiment in **directing AI to build a game**, without writing a line of code by hand.

- **Concept, art direction, references and every design decision:** Agata Poniatowska-Ormicka
- **Design:** the bunny and the terrarium were designed in Midjourney, then cut apart in Photoshop into "puppet parts" and a composition mockup, so the proportions could be measured and matched exactly in code
- **Technical specs & code review:** Claude (Anthropic)
- **Sound effects:** made with Suno by Agata
- **Code:** Space Bunny, a stealth model in OpenCode, over about 30 build rounds

The workflow ran in rounds: a precise spec, the build, a review of the code and screenshots, then fixes. Each round changed only what was asked. The reviewer checked every claim against the code, which caught a surprising number of bugs the builder had reported as fixed.

**Tech:** [Vite](https://vite.dev/) and [Three.js](https://threejs.org/). All geometry is procedural, faceted low-poly with vertex colours, and the physics is a small simulation written for the game, with a fixed time step (a circle in a 2D plane, with real collisions against the glass, the rim, the cushion and the pedestal).

## Run it locally

```bash
npm install
npm run dev
```

Open the address Vite prints. `npm run build` makes a static site in `dist/`.

While developing, add `?tune` to the address to open a live panel for the colours, lights and placements (it is not part of the production build).

## License

**Space Bunny** by **Agata Poniatowska-Ormicka** is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). You are free to share and adapt it, including commercially, as long as you give appropriate credit. If you build on it, a tag or a link back would make my day.

Three.js is MIT-licensed and keeps its own terms.
