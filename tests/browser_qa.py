"""Optional UI smoke test. Uses installed Playwright and Chromium; no downloads.

Run a server for dist/, then:
  python tests/browser_qa.py --url http://127.0.0.1:4173/
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:4173/')
parser.add_argument('--artifacts', default='/tmp/dead-signal-qa')
args = parser.parse_args()
artifacts = Path(args.artifacts)
artifacts.mkdir(parents=True, exist_ok=True)
checks = []


def check(name, result, details=None):
    checks.append({'name': name, 'passed': bool(result), 'details': details})
    print(('PASS ' if result else 'FAIL ') + name + (f' {details}' if details else ''), flush=True)


def state(page):
    return page.evaluate('({status:deadSignal.state.status, mission:deadSignal.state.mission, x:deadSignal.game.leader?.x, y:deadSignal.game.leader?.y, time:deadSignal.state.time, grenades:deadSignal.state.grenades, hold:deadSignal.state.holdFire})')


def box_inside(page, selector, width, height):
    box = page.locator(selector).bounding_box()
    return box and box['x'] >= -.5 and box['y'] >= -.5 and box['x'] + box['width'] <= width + .5 and box['y'] + box['height'] <= height + .5, box


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    for width, height, touch in [(390, 844, True), (360, 740, True), (844, 390, True), (1440, 1000, False)]:
        label = f'{width}x{height}'
        context = browser.new_context(viewport={'width': width, 'height': height}, is_mobile=touch, has_touch=touch, device_scale_factor=1)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(args.url)
        page.wait_for_function('window.deadSignal && window.deadSignal.renderer')
        page.screenshot(path=str(artifacts / f'{label}-base.png'), full_page=True)
        check(f'{label} no horizontal page overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth'), page.evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})'))
        deploy_box = page.locator('#start-btn').bounding_box()
        check(f'{label} deploy button within width', deploy_box['x'] + deploy_box['width'] <= width, deploy_box)
        page.locator('#manual-btn').click()
        check(f'{label} field manual opens', page.locator('#manual').evaluate('(el)=>el.open'))
        page.locator('#manual-done').click()
        check(f'{label} field manual closes', not page.locator('#manual').evaluate('(el)=>el.open'))
        page.locator('#start-btn').click()
        page.wait_for_function('deadSignal.state.status === "playing"')
        page.wait_for_timeout(200)
        page.screenshot(path=str(artifacts / f'{label}-playing.png'), full_page=True)
        for selector in ['#field', '#joystick', '#grenade-btn', '#hold-btn', '#pause-btn']:
            good, box = box_inside(page, selector, width, height)
            check(f'{label} {selector} inside viewport', good, box)
        # Disable enemies for control tests so deaths do not hide the tested UI.
        page.evaluate('deadSignal.state.enemies=[];deadSignal.state.wavesRemaining=0;')
        page.locator('#hold-btn').click()
        check(f'{label} hold-fire toggles', state(page)['hold'] and page.locator('#hold-btn').get_attribute('aria-pressed') == 'true')
        before = state(page)['grenades']
        page.locator('#grenade-btn').click()
        check(f'{label} grenade consumes one', state(page)['grenades'] == before - 1)
        # A field tap creates a destination; direct input must cancel that order.
        box = page.locator('#field').bounding_box()
        page.mouse.click(box['x'] + box['width'] * .7, box['y'] + box['height'] * .5)
        check(f'{label} terrain click sets move target', page.evaluate('deadSignal.state.target !== null'))
        page.evaluate('deadSignal.state.target=null;deadSignal.game.leader.x=220;deadSignal.game.leader.y=970;')
        if touch:
            cdp = context.new_cdp_session(page)
            joy = page.locator('#joystick').bounding_box()
            point = {'x': joy['x'] + joy['width'] * .83, 'y': joy['y'] + joy['height'] * .5, 'id': 1}
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point]})
            page.wait_for_timeout(500)
            moved = state(page)['x']
            check(f'{label} actual touch joystick moves leader', moved > 270, {'leaderX': moved})
            grenade = page.locator('#grenade-btn').bounding_box()
            second = {'x': grenade['x'] + grenade['width'] / 2, 'y': grenade['y'] + grenade['height'] / 2, 'id': 2}
            before = state(page)['grenades']
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point, second]})
            page.wait_for_timeout(70)
            # CDP names the ending pointer here; the joystick pointer stays down.
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': [second]})
            page.wait_for_timeout(300)
            check(f'{label} second thumb throws while joystick held', state(page)['grenades'] == before - 1)
            check(f'{label} joystick continues after second touch', state(page)['x'] > moved + 25)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            page.wait_for_timeout(100)
            released = state(page)['x']
            page.wait_for_timeout(200)
            check(f'{label} releasing joystick stops movement', abs(state(page)['x'] - released) < 1)
        else:
            before = state(page)['x']
            page.keyboard.down('d'); page.wait_for_timeout(500); page.keyboard.up('d')
            check(f'{label} keyboard steering moves leader', state(page)['x'] > before + 50)
            page.locator('#manual-btn').click()
            check(f'{label} manual pauses live game', state(page)['status'] == 'paused')
            page.locator('#close-manual').click()
            check(f'{label} manual resumes live game', state(page)['status'] == 'playing')
        page.locator('#pause-btn').click()
        paused = state(page)
        page.wait_for_timeout(200)
        check(f'{label} pause freezes mission time', paused['status'] == 'paused' and state(page)['time'] == paused['time'])
        page.screenshot(path=str(artifacts / f'{label}-paused.png'), full_page=True)
        page.locator('#resume-btn').click()
        check(f'{label} resume works', state(page)['status'] == 'playing')
        page.locator('#pause-btn').click()
        page.locator('#restart-btn').click()
        check(f'{label} restart resets mission', state(page)['status'] == 'playing' and state(page)['time'] < 1 and state(page)['grenades'] == 4)
        check(f'{label} restart resets pause button label', page.locator('#pause-btn').get_attribute('aria-label') == 'Pause game')
        page.locator('#pause-btn').click()
        page.locator('#exit-btn').click()
        check(f'{label} return to base restores selection', state(page)['status'] == 'ready' and page.locator('#start-btn').is_visible())
        page.locator('.mission-card').nth(2).click()
        page.locator('#start-btn').click()
        check(f'{label} mission three selection deploys', state(page)['mission'] == 2 and state(page)['status'] == 'playing')
        # Fixture: keep one surviving soldier in the secure final extraction.
        # This checks real win detection, overlay, progression, and persisted UI.
        page.evaluate('''() => {
          const g=deadSignal.game;
          for(const enemy of g.enemies)g.damage(enemy,1000);
          g.state.wavesRemaining=0;
          for(const soldier of g.soldiers.slice(1))g.damage(soldier,1000);
          g.leader.x=g.extraction.x;g.leader.y=g.extraction.y;
          g.setHoldFire(true);
        }''')
        page.wait_for_function('deadSignal.state.status === "won"', timeout=6000)
        page.wait_for_function('!document.getElementById("result-overlay").hidden')
        check(f'{label} win result shows final mission', 'OPERATION COMPLETE' in page.locator('#result-label').inner_text())
        check(f'{label} casualty memorial records lost squad', 'ROOK' in page.locator('#memorial').inner_text() and 'JUNE' in page.locator('#memorial').inner_text())
        page.screenshot(path=str(artifacts / f'{label}-won.png'), full_page=True)
        page.locator('#next-btn').click()
        check(f'{label} final mission replay returns to mission one', state(page)['mission'] == 0 and state(page)['status'] == 'playing')
        page.evaluate('''() => {
          const g=deadSignal.game;g.state.enemies=[];g.state.wavesRemaining=0;
          for(const civilian of g.civilians)civilian.rescued=true;
          g.state.rescueCount=g.state.rescueTarget;
          g.leader.x=g.extraction.x;g.leader.y=g.extraction.y;
        }''')
        page.wait_for_function('deadSignal.state.status === "won"', timeout=6000)
        page.wait_for_function('!document.getElementById("result-overlay").hidden')
        page.locator('#next-btn').click()
        check(f'{label} next mission advances to two', state(page)['mission'] == 1)
        page.evaluate('for(const soldier of deadSignal.game.soldiers)deadSignal.game.damage(soldier,1000)')
        page.wait_for_function('deadSignal.state.status === "lost"')
        page.wait_for_function('!document.getElementById("result-overlay").hidden')
        check(f'{label} squad loss shows retry', 'TRY AGAIN' in page.locator('#next-btn').inner_text())
        page.locator('#next-btn').click()
        check(f'{label} retry repeats failed mission', state(page)['mission'] == 1 and state(page)['status'] == 'playing')
        page.locator('#pause-btn').click(); page.locator('#exit-btn').click()
        check(f'{label} completions persist in mission cards', 'COMPLETE' in page.locator('.mission-card').nth(0).inner_text() and 'COMPLETE' in page.locator('.mission-card').nth(2).inner_text())
        check(f'{label} no JavaScript errors', not errors, errors)
        context.close()
    browser.close()

(artifacts / 'report.json').write_text(json.dumps(checks, indent=2))
failures = [c for c in checks if not c['passed']]
print(f'{len(checks) - len(failures)}/{len(checks)} checks passed; screenshots and report: {artifacts}')
raise SystemExit(bool(failures))
