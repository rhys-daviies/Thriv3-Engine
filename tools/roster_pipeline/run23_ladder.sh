#!/bin/zsh
# Remaining 2023 ladder, in order of confidence: live URL variants, then the
# site's own season selector, then a rendered browser, then the archive.
cd "${0:a:h}"   # the pipeline's own directory, wherever it lives
export RB_SEASON=2023
# No wait loop here. A pgrep on a command string also matches the shell wrapper
# that launched it, so the loop never exits -- variants is run to completion
# before this script starts instead.
echo "== merging variants =="; tail -2 log23_var.txt
python3 - <<'PY'
import sys,json; sys.path.insert(0,'.'); import state
main=state.load()
try: d=json.load(open('state_variants_2023.json',encoding='utf-8'))
except Exception: d={}
n=0
for k,v in d.items():
    if v.get('status')=='done' and main.get(k,{}).get('status')!='done': main[k]=v; n+=1
state.save(main)
rem=[k for k,v in main.items() if v.get('status')!='done']
tg={state.key(r) for r in state.targets()}
rem+= [k for k in tg if k not in main]
open('rem23.txt','w').write('\n'.join(sorted(set(rem))))
print(f"merged +{n}; remaining {len(set(rem))}")
PY
echo "== selector =="
python3 -u selector.py --keys rem23.txt --out st23_sel.json 2>&1 | tail -20
python3 - <<'PY'
import sys,json,os; sys.path.insert(0,'.'); import state
main=state.load()
for f in ('st23_sel.json',):
    if os.path.exists(f):
        for k,v in json.load(open(f,encoding='utf-8')).items():
            if v.get('status')=='done' and main.get(k,{}).get('status')!='done': main[k]=v
state.save(main)
tg=[state.key(r) for r in state.targets()]
done={k for k,v in main.items() if v.get('status')=='done'}
rem=sorted(set(tg)-done)
open('rem23.txt','w').write('\n'.join(rem))
print(f"remaining before browser: {len(rem)}")
PY
echo "== browser (4 shards) =="
python3 - <<'PY'
keys=[l.strip() for l in open('rem23.txt') if l.strip()]
for i in range(4): open(f'sh23_{i}.txt','w').write('\n'.join(keys[i::4]))
print(f"sharded {len(keys)}")
PY
for i in 0 1 2 3; do python3 -u browse.py --keys sh23_$i.txt --variants 8 --strict-season --out st23_br$i.json > log23_br$i.txt 2>&1 & done
wait
for i in 0 1 2 3; do echo "  shard$i ok=$(grep -cE '^  OK' log23_br$i.txt) fail=$(grep -cE '^  FAIL' log23_br$i.txt)"; done
python3 - <<'PY'
import sys,json,os,glob; sys.path.insert(0,'.'); import state
main=state.load()
for f in sorted(glob.glob('st23_br*.json')):
    for k,v in json.load(open(f,encoding='utf-8')).items():
        if v.get('status')=='done' and main.get(k,{}).get('status')!='done': main[k]=v
state.save(main)
tg=[state.key(r) for r in state.targets()]
dk={k for k,v in main.items() if v.get('status')=='done'}
rem=sorted(set(tg)-dk)
open('rem23.txt','w').write('\n'.join(rem))
print(f"after browser: {len(dk)} done, {len(rem)} remaining")
PY
echo "== wayback (serialised) =="
python3 -u wayback2.py --keys rem23.txt --out st23_wb.json --sleep 1.5 2>&1 | tail -25
python3 - <<'PY'
import sys,json,os; sys.path.insert(0,'.'); import state
main=state.load()
if os.path.exists('st23_wb.json'):
    for k,v in json.load(open('st23_wb.json',encoding='utf-8')).items():
        if v.get('status')=='done' and main.get(k,{}).get('status')!='done': main[k]=v
        elif main.get(k,{}).get('status')!='done': main[k]=v
state.save(main)
done=sum(1 for v in main.values() if v.get('status')=='done')
print(f"LADDER COMPLETE: {done} done / {len(main)}")
PY
