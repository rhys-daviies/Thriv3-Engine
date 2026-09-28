#!/bin/zsh
cd "${0:a:h}"   # the pipeline's own directory, wherever it lives
export RB_SEASON=2023
python3 - <<'PY'
keys=[l.strip() for l in open('rem23.txt') if l.strip()]
for i in range(4): open(f'sh23_{i}.txt','w').write('\n'.join(keys[i::4]))
print(f"browser: sharded {len(keys)}")
PY
for i in 0 1 2 3; do python3 -u browse.py --keys sh23_$i.txt --variants 8 --strict-season --out st23_br$i.json > log23_br$i.txt 2>&1 & done
wait
for i in 0 1 2 3; do echo "  shard$i ok=$(grep -cE '^  OK' log23_br$i.txt) fail=$(grep -cE '^  FAIL' log23_br$i.txt)"; done
python3 - <<'PY'
import sys,json,glob; sys.path.insert(0,'.'); import state
main=state.load()
for f in sorted(glob.glob('st23_br*.json')):
    for k,v in json.load(open(f,encoding='utf-8')).items():
        if v.get('status')=='done' and main.get(k,{}).get('status')!='done': main[k]=v
state.save(main)
tg=[state.key(r) for r in state.targets()]
dk={k for k,v in main.items() if v.get('status')=='done'}
rem=sorted(set(tg)-dk); open('rem23.txt','w').write('\n'.join(rem))
print(f"after browser: {len(dk)} done, {len(rem)} remaining")
PY
echo "== wayback (serialised, the archive rate-limits) =="
python3 -u wayback2.py --keys rem23.txt --out st23_wb.json --sleep 1.5 2>&1 | grep -E '^  (OK|FAIL|ARCHIVE)|done:' | tail -30
python3 - <<'PY'
import sys,json,os; sys.path.insert(0,'.'); import state
main=state.load()
if os.path.exists('st23_wb.json'):
    for k,v in json.load(open('st23_wb.json',encoding='utf-8')).items():
        if v.get('status')=='done' or main.get(k,{}).get('status')!='done': main[k]=v
state.save(main)
tg=[state.key(r) for r in state.targets()]
dk={k for k,v in main.items() if v.get('status')=='done'}
print(f"ROSTER LADDER COMPLETE: {len(dk)} of {len(tg)} done, {len(set(tg)-dk)} unresolved")
PY
