# Dead Signal

A small, original, mobile-first squad tactics game inspired by the feel of classic action games. Lead a named squad through three different missions—a village rescue operation, sabotage, and a radio holdout—while enemy soldiers and zombies fight each other. Gunfire attracts the undead.

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
| Move the squad | Drag the movement joystick or tap clear ground | WASD / arrow keys or left-click clear ground |
| Focus fire | Tap an enemy or signal jammer | Left-click an enemy or signal jammer |
| Aim and fire | Squad automatically shoots nearby targets | Hold right-click to aim and fire |
| Hold fire | Tap the hold-fire button | H |
| Throw a grenade | Tap for a quick throw; drag from the button to aim, then release | G at the cursor, or use the grenade button |
| Cancel grenade aim | Drag back onto the button, then lift | Drag back onto the button, or press Esc to pause |
| Pause | Tap pause | Esc |

Keep soldiers near cover and choose when to fire: noise brings zombies. Stop moving for more accurate fire. Tap a hostile or jammer to mark it for the squad for six seconds; soldiers concentrate on it when their range and line of sight allow. Hold Fire still prevents automatic shooting. Quick grenades prefer the marked target or a useful cluster; dragging lets you choose cover, a barrel, or a particular enemy. The aiming ring shows the actual blast footprint and range-clamped landing point. Grenades cannot hurt your squad or survivors. Zombies wind up before biting: moving out of reach or breaking contact lets you evade the bite.

First Contact starts at the village entrance, then sends you to rescue the clinic medic and school radio operator in either order. Clear the local defenders counted in the HUD, secure the harbour, and escort everyone through an infected escape encounter. Exposed streets offer shorter routes; covered lanes offer another approach. Near a defended site, the objective bearing points toward its remaining guards.

Bad Frequency sends you through an industrial coastal district to destroy the warehouse receiver and fuel-yard jammer, in either order. Warehouse lanes offer covered approaches; the fuel yard is more exposed, with barrels that reward a careful throw. Focus fire can prioritize devices, rifles can finish the job, and grenades work too. Destroying each jammer triggers a warned, finite infected response. The first can intercept the route to the other compound; the second pursues your evacuation to the western beach. Choosing the order changes the approach and escape route. Destroying the devices is enough: clearing every guard is optional.

Last Transmission crosses a separate village and ridge map. Hold the village repeater for 12 cumulative seconds, move to the ridge mast, then transmit for another 13 seconds. The total remains 25 seconds. Its three finite infected waves follow total uplink milestones, with warning bearings before they arrive; announced enemies keep pursuing during the transfer. Step outside to dodge and the active site's progress pauses; return to continue. The completed repeater cannot advance the ridge transmission. Finishing both links opens extraction even if hostiles remain. Bring every living squad member and rescued survivor to the extraction circle, then hold position while the timer finishes. The HUD shows when followers need to regroup. Named soldiers can die, so surviving with the whole squad takes care.

The game pauses when you leave the tab or open the field manual. Returning to the tab requires an explicit resume. Use squad cards, or desktop keys 1–3, to change the leader.

## Privacy and sound

Campaign progress is saved in this browser's `localStorage`. First Contact also saves checkpoints after securing the entrance, each rescue, and securing the harbour. Return to base or reload and choose Continue Checkpoint; after losing, choose Retry Checkpoint. Continuing preserves casualties, supplies, destroyed cover, and the escape response. It requires an explicit start and resumes in the saved difficulty. Start Fresh or Restart Mission clears that mission's checkpoint; victory clears it too. Checkpoint victories count as completions, while best times require a fresh run. Storage must be available for saves to work.

The game sends no gameplay data to a server and needs no account. Clear the site's browser storage to remove the saved progress. Sound is optional and synthesized with Web Audio after you enable it.

## Source and checks

The game uses browser APIs and buildless HTML, CSS, and JavaScript:

- `dist/engine.js`: deterministic 60 Hz simulation, missions, combat, and objectives. A bounded event journal supplies sound and visual feedback.
- `dist/mission-data.js`: the authored First Contact village, encounter groups, roads, cover and rescue sites.
- `dist/field-missions.js`: distinct authored sabotage and relay districts, compound defenders, roads and fixed relay sites.
- `dist/checkpoint.js`: bounded, validated First Contact snapshots and explicit paused restoration.
- `dist/navigation.js`: collision-aware routes shared by the leader, followers, and survivors.
- `dist/renderer.js`: original canvas graphics, camera, coordinate projection, and cached terrain.
- `dist/actors.js`, `dist/effects.js`, `dist/lighting.js`, and `dist/scenery.js`: bounded, renderer-only character poses, combat feedback, cached sunlight and shadows, and original environmental details.
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

Version 0.6.0 polishes the existing art: warm afternoon light and cool projected shadows, more detailed characters with faction-specific movement and recoil, restrained material-aware combat effects, sparse roadside equipment and weathered buildings, and clearer squad portraits, health, noise status, and field dispatches. Visual effects use their own deterministic randomness and bounded caches; they do not change the simulation, mission rules, or saves. Pausing freezes simulation-clock animation, and reduced motion removes decorative movement and interface transitions. Small phone results keep both action buttons visible.

Version 0.7.0 rebuilds First Contact as a four-stage operation across an authored 2800×2200 village: secure the entrance, rescue two people in either order, secure the harbour, and evacuate through one finite infected response. Local garrisons guard their own districts, with connecting-road encounters and several approaches around cover. Navigation and rendering support mission-specific world sizes. Milestone checkpoints preserve the full run and never automatically start after a reload. Old First Contact best times reset once because the mission changed; other mission records, completions, and preferences remain. Bad Frequency and Last Transmission retain their existing layouts and rules. Mission duration depends on route and tactics; there is no enforced minimum.

Version 0.8.0 adds tactical control across the existing missions: tap to focus fire, drag to aim a grenade with a live landing preview, smarter quick throws, and a readable zombie bite wind-up that can be evaded. Bad Frequency's two jammer destructions each trigger a finite, telegraphed response; Last Transmission's waves follow uplink milestones instead of time spent outside the relay. Warning bearings, focus markers, and optional procedural sound explain these events. The existing three maps, touch layout, and named squad remain central. Revision 2 First Contact records and checkpoints remain compatible; revised sabotage and relay best times reset once, while completions and preferences remain.

Version 0.9.0 gives the other two missions their own authored maps. Bad Frequency has a 2300×1750 industrial district with two guarded compounds, alternate approaches and useful barrel placements. Last Transmission has a 2200×1800 village-to-ridge route, splitting the existing 25-second uplink into 12 seconds at the village repeater and 13 at the ridge mast. Site markers, props, shadows, minimap bearings, stage badges and progress meters follow the handoff. All ordinary controls, weapon rates and movement speeds remain. First Contact's layout, rules, records and existing checkpoints are unchanged; the redesigned sabotage and relay best times reset once, while completions and preferences remain. Relay progress is preserved when moving outside a site during the current run; persistent checkpoints still apply to First Contact only.

## Hosting and licensing

Publish the contents of `dist/` to any static host, including GitHub Pages. No server, API keys, or secrets are required. Keep checkout-specific `.openai/` hosting metadata out of public distributions.

This repository uses GitHub Pages with the contents of `dist/` published to the root of the `gh-pages` branch. Run the release packaging command before republishing, include the generated source ZIP, and add `.nojekyll` to the published branch. The `main` branch contains the editable project.

Code and original game artwork are MIT licensed; see [LICENSE](LICENSE). Bundled font files retain their included SIL Open Font License notice. See [CONTRIBUTING.md](CONTRIBUTING.md) for contributing.

## Package a release

Run `python3 scripts/package-release.py` to regenerate `PLAY.html` and `dead-signal-source.zip` from the current source. The ZIP excludes checkout metadata, credentials, and existing archives.
