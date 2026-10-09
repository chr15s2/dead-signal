# Contributing

Dead Signal is a small, mobile-first game with three missions. Contributions that improve touch controls, accessibility, performance, balance, and browser compatibility are welcome.

1. Run the game locally using the command in [README.md](README.md).
2. Keep simulation changes in `dist/engine.js`, routing in `dist/navigation.js`, drawing in `dist/renderer.js`, input in `dist/input.js`, sound in `dist/audio.js`, and save validation in `dist/session.js`. `dist/app.js` coordinates their lifecycle.
3. Run `node --test tests/*.test.mjs` for relevant gameplay or lifecycle changes. For interface changes, check a small portrait viewport, landscape, and desktop; test touch controls on a real device when available. The optional browser suite is documented in [README.md](README.md).
4. Describe the problem, your change, and what you checked in your pull request. Include browser/device information and reproduction steps for bugs.

Keep the game buildless and usable without an account or network connection after its files load. Do not add tracking, secrets, generated archives, or checkout-specific `.openai/` metadata.

Keep movement deterministic and followers physical; do not fix routing failures by teleporting actors. Emit feedback through the bounded simulation event journal, and reset scene-specific state on restart. Run `python3 scripts/package-release.py` before a release and verify the generated `PLAY.html` offline. When changing browser modules, update the version query in `dist/index.html` and the local module imports so existing players receive a consistent deployment.

Use original or permissively licensed assets, include their license notices, and record their source. Do not contribute Cannon Fodder assets or code. Contributions to original code and artwork are licensed under the project's MIT license; existing third-party assets retain their own licenses.
