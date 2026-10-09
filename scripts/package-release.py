#!/usr/bin/env python3
"""Create a self-contained playable HTML and a clean source ZIP. No dependencies."""
import base64
import pathlib
import re
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'

def bundle_modules(entry='app.js'):
    """Bundle our named ES modules in dependency order for offline PLAY.html.

    Browser source stays ordinary ES modules. Unsupported import/export forms
    fail packaging instead of quietly generating a broken downloadable game.
    """
    modules = {}
    visiting = set()
    blocks = ['const __modules = Object.create(null);']
    pattern = re.compile(r'^import\s+\{([^}]+)\}\s+from\s+[\'"]([^\'"]+)[\'"];?', re.MULTILINE)

    def visit(name):
        if name in modules:
            return
        if name in visiting:
            raise ValueError(f'Circular module dependency: {name}')
        visiting.add(name)
        source = (DIST / name).read_text()
        for match in list(pattern.finditer(source)):
            dependency = pathlib.Path(match.group(2).split('?')[0]).name
            if not match.group(2).startswith('./'):
                raise ValueError('Only local named imports are supported.')
            visit(dependency)
        def imported(match):
            dependency = pathlib.Path(match.group(2).split('?')[0]).name
            bindings = re.sub(r'\s+as\s+', ': ', match.group(1).strip())
            return f'const {{ {bindings} }} = __modules["{dependency}"];'
        source = pattern.sub(imported, source)
        exports = re.findall(r'^export\s+(?:class|function|const)\s+(\w+)', source, re.MULTILINE)
        source = re.sub(r'^export\s+(?=class|function|const)', '', source, flags=re.MULTILINE)
        if re.search(r'^(?:import|export)\s', source, re.MULTILINE):
            raise ValueError(f'Unsupported module syntax: {name}')
        blocks.append(f'__modules["{name}"] = (() => {{\n{source}\nreturn {{ {", ".join(exports)} }};\n}})();')
        modules[name] = True
        visiting.remove(name)
    visit(entry)
    return '\n'.join(blocks), list(modules)

def standalone():
    fonts = (DIST / 'fonts.css').read_text()
    def embed(match):
        font = DIST / match.group(1)
        data = base64.b64encode(font.read_bytes()).decode('ascii')
        return f'url(data:font/ttf;base64,{data})'
    fonts = re.sub(r'url\((fonts/[^)]+)\)', embed, fonts)
    css = (DIST / 'style.css').read_text().replace("@import url('./fonts.css');", fonts)
    javascript, _ = bundle_modules()
    html = (DIST / 'index.html').read_text()
    html = re.sub(r'<link rel="stylesheet" href="style\.css[^\"]*">', lambda _: '<style>' + css + '</style>', html)
    icon = base64.b64encode((DIST / 'icon.svg').read_bytes()).decode('ascii')
    html = html.replace('href="icon.svg"', f'href="data:image/svg+xml;base64,{icon}"')
    html = re.sub(r'<script type="module" src="app\.js[^\"]*"></script>', lambda _: '<script>\n' + javascript.replace('</script', '<\\/script') + '\n</script>', html)
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
        'dist/icon.svg',
        'scripts/package-release.py', 'tests/browser_qa.py',
    ]]
    _, modules = bundle_modules()
    files.extend(DIST / name for name in modules)
    files.extend((ROOT / 'tests').glob('*.test.mjs'))
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
