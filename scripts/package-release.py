#!/usr/bin/env python3
"""Create a self-contained playable HTML and a clean source ZIP. No dependencies."""
import base64
import pathlib
import re
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'

def standalone():
    fonts = (DIST / 'fonts.css').read_text()
    def embed(match):
        font = DIST / match.group(1)
        data = base64.b64encode(font.read_bytes()).decode('ascii')
        return f'url(data:font/ttf;base64,{data})'
    fonts = re.sub(r'url\((fonts/[^)]+)\)', embed, fonts)
    css = (DIST / 'style.css').read_text().replace("@import url('./fonts.css');", fonts)
    engine = (DIST / 'engine.js').read_text().replace('export const ', 'const ').replace('export class ', 'class ')
    renderer = (DIST / 'renderer.js').read_text().replace('export class ', 'class ')
    app = re.sub(r'^import .*?;\s*', '', (DIST / 'app.js').read_text(), flags=re.MULTILINE)
    javascript = '\n'.join([
        'const {Game,MISSIONS} = (() => {', engine, 'return {Game,MISSIONS};})();',
        'const {Renderer} = (() => {', renderer, 'return {Renderer};})();', app
    ])
    html = (DIST / 'index.html').read_text()
    html = html.replace('<link rel="stylesheet" href="style.css">', '<style>' + css + '</style>')
    icon = base64.b64encode((DIST / 'icon.svg').read_bytes()).decode('ascii')
    html = html.replace('href="icon.svg"', f'href="data:image/svg+xml;base64,{icon}"')
    html = html.replace('<script type="module" src="app.js"></script>', '<script>\n' + javascript.replace('</script', '<\\/script') + '\n</script>')
    readme = base64.b64encode((ROOT / 'README.md').read_bytes()).decode('ascii')
    html = html.replace('<a href="dead-signal-source.zip" download>GET THE SOURCE ↗</a>', f'<a href="data:text/markdown;base64,{readme}" download="Dead-Signal-README.md">PROJECT README ↗</a>')
    html = html.replace('3 MISSIONS · NO DOWNLOAD', '3 MISSIONS · OFFLINE READY')
    # Preserve the third-party notices in this standalone distribution too.
    notices = '\n'.join(path.read_text() for path in sorted((DIST / 'fonts').glob('*OFL.txt')))
    html = html.replace('</html>', '<!--\nDead Signal original art and code: MIT.\n' + (ROOT / 'LICENSE').read_text() + '\nBundled typefaces:\n' + notices + '\n-->\n</html>')
    (ROOT / 'PLAY.html').write_text(html)

def source_zip():
    archive = ROOT / 'dead-signal-source.zip'
    # An explicit list keeps local configuration and credentials out of releases.
    files = [ROOT / name for name in [
        '.gitignore', 'README.md', 'CONTRIBUTING.md', 'LICENSE', 'package.json',
        'PLAY.html', 'dist/index.html', 'dist/style.css', 'dist/fonts.css',
        'dist/icon.svg', 'dist/app.js', 'dist/engine.js', 'dist/renderer.js',
        'scripts/package-release.py', 'tests/engine.test.mjs', 'tests/browser_qa.py',
    ]]
    files.extend((DIST / 'fonts').glob('*.ttf'))
    files.extend((DIST / 'fonts').glob('*-OFL.txt'))
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:
        for path in sorted(files):
            relative = path.relative_to(ROOT)
            output.write(path, 'dead-signal/' + str(relative))
    # The hosted static version offers the same clean source download.
    (DIST / 'dead-signal-source.zip').write_bytes(archive.read_bytes())
    print(f'Playable HTML: {ROOT / "PLAY.html"}')
    print(f'Source archive: {archive} ({archive.stat().st_size:,} bytes)')

if __name__ == '__main__':
    standalone()
    source_zip()
