from pathlib import Path
path = Path(r'c:/Users/augus/Documents/Codex/2026-04-30/beatmaps-rhythmic-gps-navigation-navigate-to/dist/assets/index-cDCn5JgA.js')
text = path.read_text(encoding='utf-8')
needle = 'ii=Kt[Math.min(mt,Kt.length-1)],It=Kt[Math.min(mt+1,Kt.length-1)]||ii'
idx = text.find(needle)
print('found', idx)
print(text[max(0, idx-200):idx+200].replace('\n', ' '))
print('line', next((i for i, l in enumerate(text.splitlines(), 1) if needle in l), -1))
