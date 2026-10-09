# Dead Signal

A small, original, mobile-first squad tactics game inspired by the feel of classic action games. Lead a named squad through three different missions—rescue, sabotage, and a radio holdout—while enemy soldiers and zombies fight each other. Gunfire attracts the undead.

[Play Dead Signal online](https://chr15s2.github.io/dead-signal/)

This is a playable browser demo, not a commercial remake. It contains no Cannon Fodder code, artwork, maps, music, or other assets.

## Play locally

For an immediate desktop play session, open `PLAY.html` in a browser. It bundles the game and fonts into one file and works offline. The source ZIP also includes the editable project.

For mobile testing or static hosting, use the files in `dist/`. You need Python 3 for this local-server option. No build step or dependency installation is required.

```sh
python3 scripts/package-release.py
python3 -m http.server 8080 --directory dist
```

The packaging command generates the source download offered by the game's footer.

Open <http://localhost:8080>. To try it on a phone on the same Wi-Fi, open `http://<your-computer's-local-IP>:8080` and allow the local server through your computer's firewall if necessary.

## Controls

| Action | Touch | Desktop |
| --- | --- | --- |
| Move the squad | Drag the movement joystick or tap the battlefield | WASD / arrow keys or left-click the battlefield |
| Aim and fire | Squad automatically shoots nearby targets | Hold right-click to aim and fire |
| Hold fire | Tap the hold-fire button | H |
| Throw a grenade | Tap the grenade button | G |
| Pause | Tap pause | Esc |

Keep soldiers near cover and choose when to fire: noise brings zombies. Stop moving for more accurate fire. Enemy soldiers and zombies can damage each other. First Contact rescues a radio operator. Bad Frequency sends you after two signal jammers: your squad shoots them when nearby enemies are dealt with, and grenades work too. Last Transmission asks you to hold the relay circle for 25 cumulative seconds while three finite infected waves arrive. Step outside to dodge and the uplink pauses; return to continue. Finishing the transmission opens extraction even if hostiles remain. Bring every living squad member and rescued survivor to the extraction circle, then hold position while the timer finishes. The HUD shows when followers need to regroup. Named soldiers can die, so surviving with the whole squad takes care.

The game pauses when you leave the tab or open the field manual. Returning to the tab requires an explicit resume. Use squad cards, or desktop keys 1–3, to change the leader.

## Privacy and sound

Campaign progress is saved in this browser's `localStorage`. The game sends no gameplay data to a server and needs no account. Clear the site's browser storage to remove the saved progress. Sound is optional and synthesized with Web Audio after you enable it.

## Source and checks

The game uses browser APIs and buildless HTML, CSS, and JavaScript:

- `dist/engine.js`: deterministic 60 Hz simulation, missions, combat, and objectives. A bounded event journal supplies sound and visual feedback.
- `dist/navigation.js`: collision-aware routes shared by the leader, followers, and survivors.
- `dist/renderer.js`: original canvas graphics, camera, coordinate projection, and cached terrain.
- `dist/input.js`: keyboard, mouse, captured touch joystick, and action buttons.
- `dist/audio.js`: gesture-activated procedural sound and bounded audio voices.
- `dist/session.js`: validated browser saves and objective presentation.
- `dist/app.js`: interface and scene lifecycle, coordinating the systems above.
- `dist/index.html` and `dist/style.css`: page and responsive layout.

With Node.js installed, run the simulation tests with:

```sh
node --test tests/*.test.mjs
```

The equivalent convenience commands are `npm test`, `npm run package`, and `npm run serve`; none needs `npm install`.

The Node checks cover deterministic simulation, collisions, routing, whole-squad extraction, input normalization, corrupt saves, and sound lifecycle. Browser regressions also exercise portrait, landscape, desktop, genuine multitouch, pause/restart, sound, and persistence. With Python Playwright and Chromium already installed, serve `dist/`, then run:

```sh
python3 tests/browser_qa.py --url http://127.0.0.1:8080/
```

The browser suite uses controlled fixtures for isolated behaviours. Complete each mission using ordinary controls as a separate gameplay check. Emulation does not establish performance or Safari compatibility on a physical phone.

Version 0.2.0 keeps the same three missions and improves the foundations: stable formations, physical regrouping, local combat activation, clearer feedback, mobile controls, and reliable scene resets. The first two missions are deliberately brief; balance, artwork, and real-device coverage can still improve before adding more content.

Version 0.3.0 gives the island and field interface a more distinctive art direction, with lush pixel scenery, turquoise coastlines, detailed buildings and soldiers, and a sun-bleached field-journal interface. It also fixes repeated automatic pauses in embedded mobile browsers: temporary focus changes clear held input, while automatic pause follows actual page visibility or navigation away. The three missions and their simulation rules are unchanged.

Version 0.4.0 refines existing play: followers respond to turns without chasing stale positions, companions yield to the controlled soldier, and enemies can approach physically reachable targets beside cover. Damage and critical health are clearer in the squad cards, grenade landing markers show the actual blast footprint, terrain orders receive visible confirmation, and friendly identification remains readable behind foliage. Smaller phone viewports retain clear movement hints, noise status, and firing-state icons. No missions, weapons, enemies, or progression systems are added.

Version 0.5.0 gives the existing three missions distinct objectives: rescue the radio operator, sabotage two signal jammers, and defend a relay during its transmission. Mission markers, briefings, counters, progress, and results follow each objective. Rifles can always finish sabotage, relay progress pauses outside its zone, and holdout extraction no longer requires clearing the whole map. Legacy best times for the two redesigned missions reset once; completions, mission-one times, difficulty, and sound preferences remain.

## Hosting and licensing

Publish the contents of `dist/` to any static host, including GitHub Pages. No server, API keys, or secrets are required. Keep checkout-specific `.openai/` hosting metadata out of public distributions.

This repository uses GitHub Pages with the contents of `dist/` published to the root of the `gh-pages` branch. Run the release packaging command before republishing, include the generated source ZIP, and add `.nojekyll` to the published branch. The `main` branch contains the editable project.

Code and original game artwork are MIT licensed; see [LICENSE](LICENSE). Bundled font files retain their included SIL Open Font License notice. See [CONTRIBUTING.md](CONTRIBUTING.md) for contributing.

## Package a release

Run `python3 scripts/package-release.py` to regenerate `PLAY.html` and `dead-signal-source.zip` from the current source. The ZIP excludes checkout metadata, credentials, and existing archives.
