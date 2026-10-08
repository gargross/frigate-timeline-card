import asyncio, sys, subprocess, time, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1]

async def main():
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'test', 'server.py'), '8765'], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    errors = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            for name, w, theme in [('desktop-dark', 1440, 'dark'), ('desktop-light', 1440, 'light'), ('phone-dark', 390, 'dark')]:
                page = await b.new_page(viewport={'width': w, 'height': 900})
                page.on('console', lambda m: errors.append(f'[{name}] {m.type}: {m.text}') if m.type in ('error', 'warning') else None)
                page.on('pageerror', lambda e: errors.append(f'[{name}] pageerror: {e}'))
                await page.goto('http://127.0.0.1:8765/test/harness.html')
                await page.evaluate(f"document.body.className = '{theme}'")
                await page.wait_for_timeout(1500)
                if name == 'desktop-dark':
                    # interactions: expand drive, click a block, mark reviewed, push a live review
                    await page.evaluate("""() => {
                      const r = __card.shadowRoot;
                      r.querySelectorAll('.expander')[3].click();
                    }""")
                    await page.wait_for_timeout(300)
                    await page.evaluate("""() => {
                      const r = __card.shadowRoot;
                      const b = [...r.querySelectorAll('.block')].find(x => x.title.startsWith('Alex') && x.title.includes('Outdoor'));
                      b && b.click();
                    }""")
                    await page.wait_for_timeout(500)
                    await page.evaluate("""() => __push && __push(JSON.stringify({type:'new', after:{id:'live1', camera:'side_gate', start_time: Date.now()/1000-30, end_time:null, severity:'alert', thumb_path:'/media/frigate/clips/review/x.webp', data:{objects:['person'], sub_labels:[], zones:[], detections:[]}}}))""")
                    await page.wait_for_timeout(400)
                if name == 'desktop-dark':
                    # navigation + sync checks
                    res = await page.evaluate("""async () => {
                      const r = __card.shadowRoot; const out = {};
                      const pos = () => r.querySelector('.nav-pos')?.textContent.trim();
                      out.before = pos();
                      const next = [...r.querySelectorAll('.controls .icon-btn')].find(b => b.textContent.includes('Next event'));
                      next.click(); await new Promise(x => setTimeout(x, 300));
                      out.afterNext = pos();
                      const prev = [...r.querySelectorAll('.controls .icon-btn')].find(b => b.textContent.includes('Prev event'));
                      prev.click(); prev.click(); await new Promise(x => setTimeout(x, 300));
                      out.afterPrev2 = pos();
                      const mark = [...r.querySelectorAll('.toolbar .icon-btn')].find(b => b.textContent.includes('reviewed'));
                      out.markLabel = mark.textContent.trim();
                      mark.click(); await new Promise(x => setTimeout(x, 300));
                      out.undo = r.querySelector('.undo-bar span')?.textContent;
                      out.outlined = r.querySelectorAll('.block.reviewed').length;
                      r.querySelector('.undo-bar .icon-btn').click(); await new Promise(x => setTimeout(x, 300));
                      out.outlinedAfterUndo = r.querySelectorAll('.block.reviewed').length;
                      const sync = [...r.querySelectorAll('.moment-head .chip')][0];
                      sync.click(); await new Promise(x => setTimeout(x, 4000));
                      const m = r.querySelector('ftc-player.master').video;
                      const fs = [...r.querySelectorAll('ftc-player.follower')].map(p => p.video);
                      out.followers = fs.length;
                      out.masterT = m.currentTime.toFixed(2);
                      out.followerT = fs.map(v => v.currentTime.toFixed(2));
                      m.currentTime = 30; await new Promise(x => setTimeout(x, 2500));
                      out.afterSeekMaster = m.currentTime.toFixed(2);
                      out.afterSeekFollowers = fs.map(v => v.currentTime.toFixed(2));
                      m.pause(); await new Promise(x => setTimeout(x, 800));
                      out.followersPaused = fs.every(v => v.paused);
                      const tile = r.querySelector('.sync-tile'); out.promoteTo = tile.querySelector('.name').textContent.trim();
                      tile.click(); await new Promise(x => setTimeout(x, 3000));
                      out.newMaster = r.querySelector('.player-head .title').textContent + r.querySelector('.player-head .muted').textContent.replace(/\\s+/g,' ');
                      out.newMasterT = r.querySelector('ftc-player.master').video.currentTime.toFixed(2);
                      return out;
                    }""")
                    for k, v in res.items(): print(f'  {k}: {v}')
                if name == 'phone-dark':
                    await page.evaluate("""() => { const b = __card.shadowRoot.querySelector('.feed-item'); b && b.click(); }""")
                    await page.wait_for_timeout(500)
                await page.screenshot(path=f'{OUT}/{name}.png', full_page=True)
                if name == 'desktop-dark':
                    info = await page.evaluate("""() => {
                      const r = __card.shadowRoot;
                      return { blocks: r.querySelectorAll('.block').length, marks: r.querySelectorAll('.sec-interval,.sec-point').length,
                        rows: r.querySelectorAll('.timeline .row').length, detail: r.querySelector('.detail-title')?.textContent.trim().replace(/\\s+/g,' '),
                        face: [...r.querySelectorAll('dd')].map(d=>d.textContent.trim().replace(/\\s+/g,' ')).join(' | '),
                        queue: r.querySelectorAll('.pane-side .list-item').length,
                        calls: __calls.map(c=>c.type) };
                    }""")
                    print(info)
                await page.close()
            await b.close()
    finally:
        srv.terminate()
    print('\n'.join(errors) or 'no console errors')

asyncio.run(main())
