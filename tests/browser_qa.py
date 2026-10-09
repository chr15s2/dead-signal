"""Mobile, lifecycle, persistence and rendering regression checks.

This suite uses deliberate state fixtures only for isolated controls/results;
it does not establish difficulty balance or substitute for unassisted play.
Uses installed Playwright and Chromium; no downloads.

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


def touch_point(page, selector, pointer_id=1, x=.5, y=.5):
    box = page.locator(selector).bounding_box()
    return {'x': box['x'] + box['width'] * x, 'y': box['y'] + box['height'] * y, 'id': pointer_id}


def set_visibility(page, hidden):
    # Emulate the browser's actual visibility contract, including visibilityState.
    page.evaluate('''hidden => {
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});
      document.dispatchEvent(new Event('visibilitychange'));
    }''', hidden)


def quiet_control_fixture(page):
    # Isolate input without altering actor health or formation behavior.
    page.evaluate('''() => {
      const g=deadSignal.game;g.state.enemies=[];g.state.wavesRemaining=0;
      for(const [i,s] of g.soldiers.entries()){
        s.x=220-i*28;s.y=970+i*25;s.path=null;s.pathTimer=0;
      }
      g.moveTo(g.leader.x,g.leader.y);
    }''')


def regroup_at_flare(page):
    page.evaluate('''() => {
      const g=deadSignal.game;
      for(const [i,s] of g.soldiers.entries())if(s.alive){
        s.x=g.extraction.x-i*26;s.y=g.extraction.y;s.path=null;s.pathTimer=0;
      }
      for(const [i,c] of g.civilians.entries())if(c.rescued){
        c.x=g.extraction.x-35-i*26;c.y=g.extraction.y+55;c.path=null;c.pathTimer=0;
      }
      g.moveTo(g.extraction.x,g.extraction.y);
    }''')


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
        check(f'{label} sound begins off without audio context', page.evaluate('!deadSignal.audio.debug.enabled && deadSignal.audio.debug.contextState === "uninitialized"'), page.evaluate('deadSignal.audio.debug'))
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
        page.evaluate('window.qaSpawnCamera={...deadSignal.renderer.camera}')
        check(f'{label} deployment preserves opt-in sound', page.evaluate('deadSignal.audio.debug.contextState === "uninitialized"'))
        check(f'{label} objective HUD visible during play', page.locator('#mission-goal').is_visible() and page.locator('#mission-counter').is_visible())
        page.screenshot(path=str(artifacts / f'{label}-playing.png'), full_page=True)
        for selector in ['#field', '#joystick', '#grenade-btn', '#hold-btn', '#pause-btn']:
            good, box = box_inside(page, selector, width, height)
            check(f'{label} {selector} inside viewport', good, box)
        # Disable enemies for control tests so deaths do not hide the tested UI.
        quiet_control_fixture(page)
        page.locator('#hold-btn').click()
        check(f'{label} hold-fire toggles', state(page)['hold'] and page.locator('#hold-btn').get_attribute('aria-pressed') == 'true')
        before = state(page)['grenades']
        page.locator('#grenade-btn').click()
        check(f'{label} grenade consumes one', state(page)['grenades'] == before - 1)
        # A field tap creates a destination; direct input must cancel that order.
        box = page.locator('#field').bounding_box()
        page.mouse.click(box['x'] + box['width'] * .7, box['y'] + box['height'] * .5)
        check(f'{label} terrain click sets move target', page.evaluate('deadSignal.state.target !== null'))
        quiet_control_fixture(page)
        if touch:
            cdp = context.new_cdp_session(page)
            center = touch_point(page, '#joystick', x=.515)
            x = state(page)['x']
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [center]})
            page.wait_for_timeout(200)
            check(f'{label} joystick deadzone prevents drift', abs(state(page)['x'] - x) < 1 and page.evaluate('deadSignal.input.sample().moveX === 0'))
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            point = touch_point(page, '#joystick', x=.83)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point]})
            page.wait_for_timeout(500)
            moved = state(page)['x']
            check(f'{label} actual touch joystick moves leader', moved > 270, {'leaderX': moved})
            second = touch_point(page, '#grenade-btn', pointer_id=2)
            before = state(page)['grenades']
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point, second]})
            page.wait_for_timeout(70)
            # Chromium CDP names the pointers ending here. Native pointer-event
            # tracing confirms this releases only the action thumb.
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': [second]})
            page.wait_for_timeout(300)
            check(f'{label} second thumb throws while joystick held', state(page)['grenades'] == before - 1)
            check(f'{label} joystick continues after second touch', state(page)['x'] > moved + 25)
            before = state(page)['grenades']
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point, second]})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': [second]})
            check(f'{label} rapid second thumb tap is accepted once', state(page)['grenades'] == before - 1)
            before_hold = state(page)['hold']
            hold = touch_point(page, '#hold-btn', pointer_id=2)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point, hold]})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': [hold]})
            check(f'{label} second thumb hold-fire toggles once', state(page)['hold'] != before_hold and page.evaluate('deadSignal.input.sample().moveX > .9'))
            # A second finger on the same pad must not steal the movement owner.
            pad_second = touch_point(page, '#joystick', pointer_id=3, x=.17)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point, pad_second]})
            check(f'{label} extra joystick pointer cannot steal control', page.evaluate('deadSignal.input.sample().moveX > .9'))
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': [pad_second]})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            page.wait_for_timeout(100)
            released = state(page)['x']
            page.wait_for_timeout(200)
            check(f'{label} releasing joystick stops movement', abs(state(page)['x'] - released) < 1)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point]})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchCancel', 'touchPoints': []})
            check(f'{label} canceled touch clears movement', page.evaluate('deadSignal.input.sample().moveX === 0 && deadSignal.input.sample().moveY === 0'))
            check(f'{label} touch selects tactical grenade auto-aim', page.evaluate('deadSignal.input.aimPoint() === null'))
        else:
            before = state(page)['x']
            page.keyboard.down('d'); page.wait_for_timeout(500); page.keyboard.up('d')
            check(f'{label} keyboard steering moves leader', state(page)['x'] > before + 50)
            page.locator('#manual-btn').click()
            check(f'{label} manual pauses live game', state(page)['status'] == 'paused')
            page.locator('#close-manual').click()
            check(f'{label} manual resumes live game', state(page)['status'] == 'playing')
            # A button/select keeps its normal keyboard behavior without steering.
            page.locator('#hold-btn').focus()
            page.keyboard.down('d'); page.wait_for_timeout(100); page.keyboard.up('d')
            check(f'{label} focused UI does not steer squad', page.evaluate('deadSignal.input.sample().moveX === 0'))
            page.locator('#field').focus()
            field = page.locator('#field').bounding_box()
            aim_x, aim_y = field['x'] + field['width'] * .7, field['y'] + field['height'] * .5
            page.evaluate('''() => {
              const remember=e=>window.qaAimClient={x:e.clientX,y:e.clientY};
              document.getElementById('field').addEventListener('pointermove',remember);
              document.getElementById('field').addEventListener('pointerdown',remember);
            }''')
            page.mouse.move(aim_x, aim_y)
            page.mouse.down(button='right')
            old_aim = page.evaluate('deadSignal.input.sample().aim')
            page.keyboard.down('d'); page.wait_for_timeout(250); page.keyboard.up('d')
            aiming = page.evaluate('({aim:deadSignal.input.sample().aim,projected:deadSignal.renderer.screenToWorld(qaAimClient.x,qaAimClient.y)})')
            aim, projected = aiming['aim'], aiming['projected']
            check(f'{label} held aim follows moving camera', abs(aim['x'] - old_aim['x']) > 1 and abs(aim['x'] - projected['x']) < .000001 and abs(aim['y'] - projected['y']) < .000001, {'old': old_aim, 'aim': aim, 'projected': projected})
            page.mouse.up(button='right')
            check(f'{label} releasing aim stops manual fire', page.evaluate('deadSignal.input.sample().fire !== true'))
        # The manual is available in mobile play and preserves an existing pause.
        page.locator('#manual-btn').click()
        check(f'{label} manual pauses and freezes mission', state(page)['status'] == 'paused')
        page.locator('#close-manual').click()
        check(f'{label} closing live manual resumes mission', state(page)['status'] == 'playing')
        page.locator('#manual-btn').click()
        set_visibility(page, True)
        set_visibility(page, False)
        page.locator('#close-manual').click()
        manual_away = state(page)
        page.wait_for_timeout(150)
        check(f'{label} closing manual after leaving tab keeps mission paused', manual_away['status'] == 'paused' and state(page)['time'] == manual_away['time'] and page.locator('#resume-btn').is_visible())
        page.locator('#resume-btn').click()
        # Embedded phone browsers can lose focus while their page stays visible.
        # Input must stop safely without bringing back the pause overlay.
        if touch:
            point = touch_point(page, '#joystick', x=.83)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point]})
        else:
            page.locator('#field').focus()
            page.keyboard.down('d')
        active_input = page.evaluate('deadSignal.input.sample()')
        page.evaluate('for(let i=0;i<3;i++)window.dispatchEvent(new Event("blur"))')
        cleared_input = page.evaluate('deadSignal.input.sample()')
        check(f'{label} visible blur clears active movement input', active_input['moveX'] > .9 and cleared_input['moveX'] == 0 and cleared_input['moveY'] == 0, {'before': active_input, 'after': cleared_input})
        if touch:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        else:
            page.keyboard.up('d')
        visible_blur = state(page)
        page.wait_for_timeout(200)
        check(f'{label} repeated visible blur keeps mission running', visible_blur['status'] == 'playing' and state(page)['status'] == 'playing' and state(page)['time'] > visible_blur['time'] + .1 and page.locator('#pause-overlay').evaluate('(el)=>el.hidden') and page.evaluate('!document.hidden && document.visibilityState === "visible"'))
        page.locator('#sound-btn').click()
        page.wait_for_function('deadSignal.audio.debug.contextState === "running" && deadSignal.audio.debug.enabled')
        check(f'{label} sound enabled by player gesture', page.locator('#sound-btn').get_attribute('aria-pressed') == 'true')
        page.wait_for_timeout(250)
        voices = page.evaluate('''() => {
          const before=deadSignal.audio.debug;
          for(let i=0;i<20;i++)deadSignal.audio.consume(deadSignal.state);
          const after=deadSignal.audio.debug;
          return {before,after,latest:deadSignal.state.events.at(-1)?.id??0};
        }''')
        check(f'{label} repeated audio consume cannot replay journal', voices['after']['lastEventId'] == voices['before']['lastEventId'] == voices['latest'] and voices['after']['voices'] == voices['before']['voices'] and voices['after']['voices'] <= 18, voices)
        page.locator('#pause-btn').click()
        paused = state(page)
        page.wait_for_timeout(200)
        check(f'{label} pause freezes mission time', paused['status'] == 'paused' and state(page)['time'] == paused['time'])
        page.wait_for_timeout(350)
        check(f'{label} pause stops all sound voices', page.evaluate('deadSignal.audio.debug.paused && deadSignal.audio.debug.voices === 0'), page.evaluate('deadSignal.audio.debug'))
        page.locator('#manual-btn').click()
        page.keyboard.press('Escape')
        check(f'{label} manual escape preserves prior pause', state(page)['status'] == 'paused' and not page.locator('#manual').evaluate('(el)=>el.open'))
        page.screenshot(path=str(artifacts / f'{label}-paused.png'), full_page=True)
        interrupted = page.evaluate('''async () => {
          window.qaInterruptedJournal=structuredClone(deadSignal.state);
          qaInterruptedJournal.status='playing';
          window.qaInterruptedCursor=deadSignal.audio.debug.lastEventId;
          await deadSignal.audio.context.suspend();
          return deadSignal.audio.debug;
        }''')
        check(f'{label} device audio interruption preserves opt-in preference', interrupted['contextState'] == 'suspended' and interrupted['enabled'] and interrupted['paused'], interrupted)
        page.locator('#resume-btn').click()
        page.wait_for_function('deadSignal.audio.debug.contextState === "running" && deadSignal.audio.debug.enabled && !deadSignal.audio.debug.paused')
        check(f'{label} explicit resume restores interrupted sound', state(page)['status'] == 'playing' and page.locator('#sound-btn').get_attribute('aria-pressed') == 'true')
        replay = page.evaluate('''() => {
          const before=deadSignal.audio.debug;
          for(let i=0;i<20;i++)deadSignal.audio.consume(qaInterruptedJournal);
          const after=deadSignal.audio.debug;
          return {before,after,interruptedCursor:qaInterruptedCursor};
        }''')
        check(f'{label} audio recovery cannot replay previously heard events', replay['before']['lastEventId'] >= replay['interruptedCursor'] and replay['after']['lastEventId'] == replay['before']['lastEventId'] and replay['after']['voices'] == replay['before']['voices'], replay)
        if touch:
            point = touch_point(page, '#joystick', x=.83)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point]})
            pause_touch = touch_point(page, '#pause-btn', pointer_id=2)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point, pause_touch]})
            check(f'{label} second thumb pause opens overlay once', state(page)['status'] == 'paused')
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': [pause_touch]})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            page.locator('#resume-btn').click()
            check(f'{label} pausing held pad prevents sticky movement', page.evaluate('deadSignal.input.sample().moveX === 0 && deadSignal.input.sample().moveY === 0'))
        check(f'{label} resume works', state(page)['status'] == 'playing')
        page.locator('#sound-btn').click()
        page.wait_for_timeout(100)
        check(f'{label} muting stops voices immediately', page.evaluate('!deadSignal.audio.debug.enabled && deadSignal.audio.debug.voices === 0'))
        # Simulate the browser lifecycle event deterministically; a tab return
        # must keep the explicit resume overlay rather than running unnoticed.
        set_visibility(page, True)
        check(f'{label} hidden tab pauses automatically', state(page)['status'] == 'paused')
        set_visibility(page, False)
        page.wait_for_timeout(100)
        check(f'{label} tab return waits for explicit resume', state(page)['status'] == 'paused')
        page.locator('#resume-btn').click()
        resumed = state(page)
        page.evaluate('for(let i=0;i<3;i++)window.dispatchEvent(new Event("blur"))')
        page.wait_for_timeout(200)
        check(f'{label} visible blur after resume cannot reopen pause', state(page)['status'] == 'playing' and state(page)['time'] > resumed['time'] + .1 and page.locator('#pause-overlay').evaluate('(el)=>el.hidden'))
        page.locator('#pause-btn').click()
        # A restart must discard a camera left elsewhere in the previous scene.
        page.evaluate('deadSignal.renderer.camera.x=1200;deadSignal.renderer.camera.y=300')
        page.locator('#restart-btn').click()
        check(f'{label} restart resets mission', state(page)['status'] == 'playing' and state(page)['time'] < 1 and state(page)['grenades'] == 4)
        check(f'{label} restart resets pause button label', page.locator('#pause-btn').get_attribute('aria-label') == 'Pause game')
        page.wait_for_timeout(150)
        check(f'{label} restart resets input and stale aim', page.evaluate('deadSignal.input.sample().moveX === 0 && deadSignal.input.aimPoint() === null'))
        camera_reset = page.evaluate('''() => {
          const r=deadSignal.renderer,c=r.camera,l=deadSignal.game.leader;
          const point=r.worldToScreen(l.x,l.y),field=document.getElementById('field').getBoundingClientRect();
          const controls=document.getElementById('joystick').getBoundingClientRect();
          return {matchesFresh:Math.hypot(c.x-qaSpawnCamera.x,c.y-qaSpawnCamera.y)<.01,
            visible:point.x>=field.left&&point.x<=field.right&&point.y>=field.top&&point.y<controls.top,
            camera:{...c},fresh:qaSpawnCamera,leader:point};
        }''')
        check(f'{label} restart restores fresh camera and visible squad', camera_reset['matchesFresh'] and camera_reset['visible'], camera_reset)
        # Resizing preserves the static terrain cache and updates projection.
        page.evaluate('window.qaTerrain=deadSignal.renderer.cache')
        page.set_viewport_size({'width': height if touch else 1200, 'height': width if touch else 800})
        page.evaluate('window.dispatchEvent(new Event("orientationchange"))')
        page.wait_for_timeout(200)
        check(f'{label} orientation/resize keeps terrain cache', page.evaluate('deadSignal.renderer.cache === window.qaTerrain'))
        resized_width, resized_height = (height, width) if touch else (1200, 800)
        for selector in ['#field', '#joystick', '#grenade-btn', '#pause-btn', '#mission-goal']:
            good, bounds = box_inside(page, selector, resized_width, resized_height)
            check(f'{label} resized {selector} stays usable', good, bounds)
        check(f'{label} resized projection roundtrips correctly', page.evaluate('''() => {
          const r=deadSignal.renderer,p=r.worldToScreen(800,600),q=r.screenToWorld(p.x,p.y);
          return Math.hypot(q.x-800,q.y-600)<.000001;
        }'''))
        page.set_viewport_size({'width': width, 'height': height})
        page.wait_for_timeout(100)
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
          g.leader.path=null;g.leader.pathTimer=0;
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
        }''')
        regroup_at_flare(page)
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
        page.reload()
        page.wait_for_function('window.deadSignal && window.deadSignal.renderer')
        check(f'{label} completions survive browser reload', 'COMPLETE' in page.locator('.mission-card').nth(0).inner_text() and 'COMPLETE' in page.locator('.mission-card').nth(2).inner_text())
        check(f'{label} no JavaScript errors', not errors, errors)
        context.close()
    for storage_fixture in ['malformed', 'denied']:
        context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        if storage_fixture == 'malformed':
            context.add_init_script('localStorage.setItem("dead-signal-v1", "{broken-save")')
        else:
            context.add_init_script('''
              Storage.prototype.getItem = function(){throw new DOMException("blocked", "SecurityError")};
              Storage.prototype.setItem = function(){throw new DOMException("blocked", "SecurityError")};
            ''')
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(args.url)
        page.wait_for_function('window.deadSignal && window.deadSignal.renderer')
        check(f'{storage_fixture} storage still renders three missions', page.locator('.mission-card').count() == 3)
        page.locator('#start-btn').click()
        check(f'{storage_fixture} storage still deploys normally', state(page)['status'] == 'playing')
        check(f'{storage_fixture} storage causes no JavaScript errors', not errors, errors)
        context.close()
    # A short viewport represents a phone with substantial in-app browser chrome.
    # Keep this focused on usable play space and every pause-card action.
    context = browser.new_context(viewport={'width': 390, 'height': 650}, is_mobile=True, has_touch=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.url)
    page.wait_for_function('window.deadSignal && window.deadSignal.renderer')
    page.locator('#start-btn').click()
    page.wait_for_function('deadSignal.state.status === "playing"')
    page.wait_for_timeout(200)
    check('390x650 short viewport deploys through lobby UI', state(page)['status'] == 'playing' and page.locator('#field').is_visible())
    good, bounds = box_inside(page, '#field', 390, 650)
    check('390x650 play field fits available content height', good, bounds)
    controls = {selector: box_inside(page, selector, 390, 650) for selector in ['#joystick', '#grenade-btn', '#pause-btn']}
    check('390x650 movement grenade and pause controls fit viewport', all(result[0] for result in controls.values()), controls)
    page.screenshot(path=str(artifacts / '390x650-playing.png'), full_page=True)
    page.locator('#pause-btn').click()
    overlay_ok, overlay_bounds = box_inside(page, '#pause-overlay', 390, 650)
    card_ok, card_bounds = box_inside(page, '#pause-overlay .overlay-card', 390, 650)
    check('390x650 pause card fits viewport with internal scrolling', overlay_ok and card_ok, {'overlay': overlay_bounds, 'card': card_bounds})
    page.screenshot(path=str(artifacts / '390x650-paused.png'), full_page=True)
    accessible = {}
    for selector in ['#resume-btn', '#restart-btn', '#pause-manual-btn', '#exit-btn']:
        page.locator(selector).scroll_into_view_if_needed()
        inside, bounds = box_inside(page, selector, 390, 650)
        hit = page.locator(selector).evaluate('''button => {
          const b=button.getBoundingClientRect();
          const target=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);
          return button===target||button.contains(target);
        }''')
        accessible[selector] = {'inside': bool(inside), 'hit': hit, 'bounds': bounds}
    page.locator('#resume-btn').click()
    resumed = state(page)['status'] == 'playing'
    page.locator('#pause-btn').click()
    page.locator('#restart-btn').click()
    restarted = state(page)['status'] == 'playing' and state(page)['time'] < 1
    page.locator('#pause-btn').click()
    page.locator('#pause-manual-btn').click()
    manual_open = page.locator('#manual').evaluate('(el)=>el.open')
    page.locator('#close-manual').click()
    manual_preserved_pause = state(page)['status'] == 'paused'
    page.locator('#exit-btn').click()
    exited = state(page)['status'] == 'ready'
    check('390x650 all four pause actions remain accessible and work', all(a['inside'] and a['hit'] for a in accessible.values()) and resumed and restarted and manual_open and manual_preserved_pause and exited, {'buttons': accessible, 'resume': resumed, 'restart': restarted, 'manual': manual_open and manual_preserved_pause, 'return': exited})
    check('390x650 no JavaScript errors', not errors, errors)
    context.close()
    browser.close()

(artifacts / 'report.json').write_text(json.dumps(checks, indent=2))
failures = [c for c in checks if not c['passed']]
print(f'{len(checks) - len(failures)}/{len(checks)} checks passed; screenshots and report: {artifacts}')
raise SystemExit(bool(failures))
