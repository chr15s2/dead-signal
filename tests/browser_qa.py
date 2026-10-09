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


def assert_hit_feedback(page, label):
    card = page.locator('.soldier-card').nth(1)
    border_before = card.evaluate('(el)=>getComputedStyle(el).borderColor')
    damaged = page.evaluate('''() => {
      const soldier=deadSignal.game.soldiers[1];
      deadSignal.game.damage(soldier,12,'enemy');
      return {id:soldier.id,hp:soldier.hp};
    }''')
    page.wait_for_function('document.querySelectorAll(".soldier-card")[1].classList.contains("hurt")')
    check(f'{label} hit feedback marks only the damaged soldier', card.evaluate('(el)=>el.classList.contains("hurt") && !el.classList.contains("critical")') and card.evaluate('(el)=>getComputedStyle(el).borderColor') != border_before and page.locator('.soldier-card.hurt').count() == 1)
    page.wait_for_timeout(750)
    check(f'{label} damage flash ends without hiding remaining health', not card.evaluate('(el)=>el.classList.contains("hurt")') and str(int(damaged['hp'])) in card.get_attribute('aria-label'))
    page.evaluate('''() => {
      const soldier=deadSignal.game.soldiers[1];
      deadSignal.game.damage(soldier,soldier.hp-soldier.maxHp*.3,'enemy');
    }''')
    page.wait_for_function('document.querySelectorAll(".soldier-card")[1].classList.contains("critical")')
    page.wait_for_timeout(750)
    check(f'{label} exactly thirty percent health retains critical warning', card.evaluate('(el)=>el.classList.contains("critical") && !el.classList.contains("hurt")') and 'critical' in card.get_attribute('aria-label') and card.locator('.soldier-name small').inner_text().startswith('!'))


def assert_noise_feedback(page, label, width, height):
    states = []
    for value, expected in [(45, 'HEARD'), (90, 'HORDE ALERT'), (0, 'QUIET')]:
        page.evaluate('value=>deadSignal.state.noise=value', value)
        page.wait_for_function('expected=>document.getElementById("noise-label").textContent===expected', arg=expected)
        visible = page.locator('#noise-label').evaluate('''el=>{
          const style=getComputedStyle(el);
          return style.display!=='none' && style.visibility!=='hidden' && Number(style.opacity)>0
            && parseFloat(style.fontSize)>=8 && el.clientHeight>0 && el.scrollWidth<=el.clientWidth+1;
        }''')
        inside, bounds = box_inside(page, '#noise-label', width, height)
        states.append({'state': expected, 'visible': visible, 'inside': bool(inside), 'bounds': bounds})
    check(f'{label} noise state stays readable without relying on color', all(item['visible'] and item['inside'] for item in states), states)


def assert_order_feedback(page, label, touch):
    before = page.evaluate('deadSignal.state.events.at(-1)?.id??0')
    point = page.evaluate('deadSignal.renderer.worldToScreen(400,900)')
    if touch:
        page.touchscreen.tap(point['x'], point['y'])
    else:
        page.mouse.click(point['x'], point['y'])
    page.wait_for_function('before=>deadSignal.state.events.some(e=>e.type==="order"&&e.id>before)', arg=before)
    event_id = page.evaluate('before=>deadSignal.state.events.find(e=>e.type==="order"&&e.id>before).id', before)
    page.wait_for_function('id=>deadSignal.renderer.effects.some(e=>e.type==="order"&&e.id===id)', arg=event_id)
    pulse_count = page.evaluate('id=>deadSignal.renderer.effects.filter(e=>e.type==="order"&&e.id===id).length', event_id)
    check(f'{label} accepted terrain order produces exactly one confirmation pulse', pulse_count == 1 and page.evaluate('deadSignal.state.target !== null'))
    page.emulate_media(reduced_motion='reduce')
    page.evaluate('''id=>{
      const renderer=deadSignal.renderer,event=renderer.effects.find(e=>e.id===id);
      const context=renderer.ctx,original=context.arc;
      window.qaOrderArcOriginal=original;window.qaOrderRadii=[];
      context.arc=function(x,y,r,...rest){
        if(Math.abs(x-event.x)<.000001&&Math.abs(y-event.y)<.000001){
          const field=renderer.canvas.getBoundingClientRect();
          qaOrderRadii.push(r*renderer.camera.zoom*field.width/renderer.width);
        }
        return original.call(context,x,y,r,...rest);
      };
    }''', event_id)
    page.wait_for_timeout(150)
    reduced = page.evaluate('''() => {
      deadSignal.renderer.ctx.arc=qaOrderArcOriginal;
      return {count:qaOrderRadii.length,spread:qaOrderRadii.length?Math.max(...qaOrderRadii)-Math.min(...qaOrderRadii):null,
        radii:qaOrderRadii,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,shake:deadSignal.renderer.shake};
    }''')
    check(f'{label} reduced motion keeps the live order confirmation static', reduced['reduced'] and reduced['count'] >= 2 and reduced['spread'] < .01 and reduced['shake'] == 0, reduced)
    page.emulate_media(reduced_motion='no-preference')
    page.wait_for_timeout(850)
    check(f'{label} order confirmation expires after the accepted move', page.evaluate('id=>!deadSignal.renderer.effects.some(e=>e.type==="order"&&e.id===id)', event_id))


def assert_objective_readability(page, label, width, height):
    presentation = {}
    for selector in ['#mission-goal', '#mission-detail', '#mission-counter']:
        inside, bounds = box_inside(page, selector, width, height)
        text_state = page.locator(selector).evaluate('''el=>{
          const style=getComputedStyle(el);
          return {text:el.textContent.trim(),visible:style.display!=='none' && style.visibility!=='hidden',
            fits:el.scrollWidth<=el.clientWidth+1 && el.scrollHeight<=el.clientHeight+1};
        }''')
        presentation[selector] = {**text_state, 'inside': bool(inside), 'bounds': bounds}
    check(f'{label} objective instructions and count fit without clipping',
          all(item['text'] and item['visible'] and item['fits'] and item['inside'] for item in presentation.values()), presentation)


def objective_bearings(page):
    # Observe the objective selected for one canvas draw without depending on
    # random terrain pixels or changing the camera's ongoing behavior.
    return page.evaluate('''() => {
      const r=deadSignal.renderer,original=r.drawEdgeMarker,targets=[];
      r.drawEdgeMarker=function(...args){
        const target=args[1];
        if(args[5])targets.push({x:target.x,y:target.y,id:target.id??null});
        return original.apply(this,args);
      };
      try{r.drawObjectiveDirection(r.ctx,deadSignal.state,deadSignal.game.leader);}
      finally{r.drawEdgeMarker=original;}
      return targets;
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
        assert_hit_feedback(page, label)
        assert_noise_feedback(page, label, width, height)
        assert_order_feedback(page, label, touch)
        quiet_control_fixture(page)
        auto_icon = page.locator('#hold-btn .fire-slash').evaluate('(el)=>getComputedStyle(el).display === "none"')
        page.locator('#hold-btn').click()
        check(f'{label} hold-fire toggles', state(page)['hold'] and page.locator('#hold-btn').get_attribute('aria-pressed') == 'true')
        check(f'{label} fire glyph and accessible label agree with hold-fire mode', auto_icon and page.locator('#hold-btn .fire-slash').evaluate('(el)=>getComputedStyle(el).display !== "none"') and page.locator('#fire-label').inner_text() == 'FIRE OFF' and page.locator('#hold-btn').get_attribute('aria-label') == 'Resume automatic fire')
        page.locator('#hold-btn').click()
        check(f'{label} automatic fire removes the crossed-out glyph', not state(page)['hold'] and page.locator('#hold-btn .fire-slash').evaluate('(el)=>getComputedStyle(el).display === "none"') and page.locator('#fire-label').inner_text() == 'AUTO FIRE')
        page.locator('#hold-btn').click()
        before = state(page)['grenades']
        page.locator('#grenade-btn').click()
        check(f'{label} grenade consumes one', state(page)['grenades'] == before - 1)
        footprint = page.evaluate('''async () => {
          const grenade=structuredClone(deadSignal.state.thrownGrenades.at(-1));
          const {CONFIG}=await import(new URL('engine.js',location.href));
          const context=document.createElement('canvas').getContext('2d');
          const arcs=[],arc=context.arc.bind(context);
          context.arc=(x,y,r,...rest)=>{arcs.push({x,y,r});return arc(x,y,r,...rest)};
          deadSignal.renderer.drawGrenadeFootprint(context,grenade,true);
          return {arcs,radius:CONFIG.grenadeRadius,target:{x:grenade.tx,y:grenade.ty}};
        }''')
        check(f'{label} visible grenade footprint matches actual blast radius', any(abs(arc['r'] - footprint['radius']) < .000001 and abs(arc['x'] - footprint['target']['x']) < .000001 and abs(arc['y'] - footprint['target']['y']) < .000001 for arc in footprint['arcs']), footprint)
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
        check(f'{label} restart clears damage and critical HUD states', page.locator('.soldier-card.hurt,.soldier-card.critical').count() == 0 and page.evaluate('deadSignal.game.soldiers.every(s=>s.hp===s.maxHp)') and all('critical' not in card.get_attribute('aria-label') for card in page.locator('.soldier-card').all()))
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
        if width == 390 or not touch:
            # Isolated objective presentation checks. Objective damage and actor
            # placement are deliberate fixtures; mission balance is playtested
            # separately without state edits.
            page.locator('.mission-card').nth(1).click()
            page.locator('#start-btn').click()
            page.wait_for_function('deadSignal.state.status === "playing" && deadSignal.state.objective.type === "sabotage"')
            page.wait_for_function('document.getElementById("mission-counter").textContent.includes("0 / 2")')
            check(f'{label} mission two explains sabotage rather than survivor rescue',
                  'JAMMER' in (page.locator('#mission-goal').inner_text() + page.locator('#mission-detail').inner_text()).upper()
                  and 'SAFE' not in page.locator('#mission-counter').inner_text()
                  and page.locator('#mission-progress').evaluate('(el)=>el.hidden'))
            assert_objective_readability(page, f'{label} sabotage', width, height)
            nearest_jammer = page.evaluate('''() => {
              const leader=deadSignal.game.leader;
              return [...deadSignal.state.objective.targets].sort((a,b)=>Math.hypot(a.x-leader.x,a.y-leader.y)-Math.hypot(b.x-leader.x,b.y-leader.y))[0].id;
            }''')
            check(f'{label} sabotage bearing points at the nearest live objective',
                  [target['id'] for target in objective_bearings(page)] == [nearest_jammer])
            page.screenshot(path=str(artifacts / f'{label}-sabotage.png'), full_page=True)
            page.evaluate('deadSignal.game.damage(deadSignal.state.objective.targets[0],1000,"player")')
            page.wait_for_function('document.getElementById("mission-counter").textContent.includes("1 / 2")')
            check(f'{label} destroying one jammer updates objective counter without opening extraction',
                  page.evaluate('!deadSignal.state.objective.targets[0].alive && deadSignal.state.objective.targets[1].alive && !deadSignal.state.extraction.active'))
            check(f'{label} sabotage bearing moves to the remaining live jammer',
                  [target['id'] for target in objective_bearings(page)] == [page.evaluate('deadSignal.state.objective.targets[1].id')])
            page.locator('#pause-btn').click()
            page.locator('#restart-btn').click()
            page.wait_for_function('document.getElementById("mission-counter").textContent.includes("0 / 2")')
            check(f'{label} sabotage restart restores both devices and initial guidance',
                  page.evaluate('deadSignal.state.objective.targets.length===2 && deadSignal.state.objective.targets.every(target=>target.alive && target.hp===target.maxHp) && !deadSignal.state.extraction.active'))
            page.locator('#pause-btn').click()
            page.locator('#exit-btn').click()
            page.locator('.mission-card').nth(2).click()
            page.locator('#start-btn').click()
            page.wait_for_function('deadSignal.state.status === "playing" && deadSignal.state.objective.type === "holdout"')
            page.wait_for_function('!document.getElementById("mission-progress").hidden')
            check(f'{label} mission three explains the radio holdout with distinct progress',
                  'RELAY' in page.locator('#mission-goal').inner_text().upper()
                  and 'Extraction' not in page.locator('#mission-progress').get_attribute('aria-label'))
            assert_objective_readability(page, f'{label} holdout approach', width, height)
            relay = page.evaluate('({x:deadSignal.state.objective.zone.x,y:deadSignal.state.objective.zone.y,id:null})')
            check(f'{label} holdout bearing directs the squad to the relay rather than roaming hostiles',
                  objective_bearings(page) == [relay])
            page.screenshot(path=str(artifacts / f'{label}-holdout-approach.png'), full_page=True)
            page.evaluate('''() => {
              const g=deadSignal.game,z=g.state.objective.zone;
              g.state.enemies=[];
              for(const [i,soldier] of g.soldiers.entries()){
                soldier.x=z.x-i*24;soldier.y=z.y;soldier.path=null;soldier.pathTimer=0;
              }
              g.moveTo(g.leader.x,g.leader.y);
            }''')
            page.wait_for_function('deadSignal.state.objective.inside && deadSignal.state.objective.held > .4')
            page.wait_for_timeout(120)
            check(f'{label} entering the radio zone updates the live progress display',
                  page.locator('#mission-progress').evaluate('(el)=>!el.hidden && el.value>0 && el.value<1')
                  and 'RETURN' not in page.locator('#mission-goal').inner_text())
            assert_objective_readability(page, f'{label} active holdout', width, height)
            page.screenshot(path=str(artifacts / f'{label}-holdout-active.png'), full_page=True)
            page.locator('#pause-btn').click()
            paused_hold = page.evaluate('({held:deadSignal.state.objective.held,time:deadSignal.state.time})')
            page.wait_for_timeout(250)
            check(f'{label} pause freezes radio objective progress alongside mission time',
                  page.evaluate('({held:deadSignal.state.objective.held,time:deadSignal.state.time})') == paused_hold)
            page.locator('#resume-btn').click()
            page.wait_for_function('held=>deadSignal.state.objective.held > held+.15', arg=paused_hold['held'])
            check(f'{label} resume continues the same accumulated radio progress',
                  page.locator('#mission-progress').evaluate('(el)=>el.value>0') and state(page)['status'] == 'playing')
            page.evaluate('''() => {
              const g=deadSignal.game,z=g.state.objective.zone;
              g.state.enemies=[];
              for(const [i,soldier] of g.soldiers.entries()){
                soldier.x=z.x+z.r+90+i*24;soldier.y=z.y;soldier.path=null;soldier.pathTimer=0;
              }
              g.moveTo(g.leader.x,g.leader.y);
            }''')
            page.wait_for_function('!deadSignal.state.objective.inside')
            left_hold = page.evaluate('deadSignal.state.objective.held')
            page.wait_for_timeout(250)
            check(f'{label} leaving the radio zone preserves progress and tells the player to return',
                  page.evaluate('deadSignal.state.objective.held') == left_hold
                  and 'RETURN' in (page.locator('#mission-goal').inner_text() + page.locator('#mission-detail').inner_text()).upper())
            page.locator('#pause-btn').click()
            page.locator('#restart-btn').click()
            page.wait_for_function('deadSignal.state.objective.held === 0 && !deadSignal.state.objective.started')
            page.wait_for_timeout(120)
            check(f'{label} holdout restart clears timer waves and displayed progress',
                  page.evaluate('deadSignal.state.objective.held===0 && !deadSignal.state.objective.inside && !deadSignal.state.extraction.active && deadSignal.state.objective.elapsed===0')
                  and page.locator('#mission-progress').evaluate('(el)=>!el.hidden && el.value===0'))
            page.locator('#pause-btn').click()
            page.locator('#exit-btn').click()
        page.locator('.mission-card').nth(2).click()
        page.locator('#start-btn').click()
        check(f'{label} mission three selection deploys', state(page)['mission'] == 2 and state(page)['status'] == 'playing')
        # Fixture: keep one surviving soldier in the secure final extraction.
        # This checks real win detection, overlay, progression, and persisted UI.
        page.evaluate('''() => {
          const g=deadSignal.game;
          for(const enemy of g.enemies)g.damage(enemy,1000);
          g.state.wavesRemaining=0;
          g.state.objective.held=g.state.objective.duration;
          g.state.objective.started=true;
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
    for width, height in [(390, 540), (360, 500)]:
        label = f'{width}x{height}'
        context = browser.new_context(viewport={'width': width, 'height': height}, is_mobile=True, has_touch=True)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(args.url)
        page.wait_for_function('window.deadSignal && window.deadSignal.renderer')
        page.locator('#start-btn').click()
        page.wait_for_function('deadSignal.state.status === "playing"')
        page.wait_for_timeout(200)
        boxes = {selector: box_inside(page, selector, width, height) for selector in ['#field', '#joystick', '#grenade-btn', '#hold-btn', '#pause-btn']}
        check(f'{label} compact portrait keeps field and touch controls usable', all(result[0] for result in boxes.values()), boxes)
        hint_inside, hint_bounds = box_inside(page, '#touch-hint', width, height)
        hint_readable = page.locator('#touch-hint').evaluate('''el=>{
          const style=getComputedStyle(el);
          return !el.hidden && style.display!=='none' && style.visibility!=='hidden'
            && parseFloat(style.fontSize)>=8 && el.scrollWidth<=el.clientWidth+1
            && /DRAG/.test(el.textContent) && /AUTO/.test(el.textContent);
        }''')
        check(f'{label} movement hint remains readable within the field', hint_inside and hint_readable, hint_bounds)
        clearance = page.evaluate('''() => {
          const renderer=deadSignal.renderer,leader=deadSignal.game.leader;
          const point=renderer.worldToScreen(leader.x,leader.y),field=document.getElementById('field').getBoundingClientRect();
          const scale=renderer.personScale*renderer.transform.zoom*field.width/renderer.width;
          const actor={left:point.x-12*scale,right:point.x+12*scale,top:point.y-28*scale,bottom:point.y+10*scale};
          const overlap=b=>actor.left<b.right && actor.right>b.left && actor.top<b.bottom && actor.bottom>b.top;
          const obstacles=['touch-hint','joystick','hold-btn','grenade-btn'].map(id=>{
            const b=document.getElementById(id).getBoundingClientRect();
            return {id,left:b.left,right:b.right,top:b.top,bottom:b.bottom,overlap:overlap(b)};
          });
          return {actor,obstacles,inside:actor.left>=field.left && actor.right<=field.right && actor.top>=field.top && actor.bottom<=field.bottom};
        }''')
        check(f'{label} squad leader stays clear of hint and thumb controls', clearance['inside'] and not any(item['overlap'] for item in clearance['obstacles']), clearance)
        page.screenshot(path=str(artifacts / f'{label}-playing.png'), full_page=True)
        quiet_control_fixture(page)
        assert_noise_feedback(page, label, width, height)
        cdp = context.new_cdp_session(page)
        point = touch_point(page, '#joystick', x=.83)
        before = state(page)['x']
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [point]})
        page.wait_for_timeout(300)
        check(f'{label} real thumb movement dismisses the compact hint', state(page)['x'] > before + 20 and page.locator('#touch-hint').evaluate('(el)=>el.hidden'))
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        page.wait_for_timeout(100)
        released = state(page)['x']
        page.wait_for_timeout(150)
        check(f'{label} releasing compact pad stops steering', abs(state(page)['x'] - released) < 1 and page.evaluate('deadSignal.input.sample().moveX===0 && deadSignal.input.sample().moveY===0'))
        if width == 360:
            page.locator('#pause-btn').click()
            page.locator('#exit-btn').click()
            page.locator('.mission-card').nth(1).click()
            page.locator('#start-btn').click()
            page.wait_for_function('document.getElementById("mission-goal").textContent==="SABOTAGE"')
            assert_objective_readability(page, f'{label} compact sabotage', width, height)
            page.screenshot(path=str(artifacts / f'{label}-sabotage.png'), full_page=True)
            page.locator('#pause-btn').click()
            page.locator('#exit-btn').click()
            page.locator('.mission-card').nth(2).click()
            page.locator('#start-btn').click()
            # Isolate the longest return instruction without a lengthy holdout.
            page.evaluate('''() => {
              deadSignal.state.enemies=[];deadSignal.state.wavesRemaining=0;
              Object.assign(deadSignal.state.objective,{started:true,inside:false,held:10});
            }''')
            page.wait_for_function('document.getElementById("mission-goal").textContent==="RE-ENTER THE SIGNAL"')
            assert_objective_readability(page, f'{label} compact relay return', width, height)
            page.screenshot(path=str(artifacts / f'{label}-holdout-return.png'), full_page=True)
        check(f'{label} no JavaScript errors', not errors, errors)
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
