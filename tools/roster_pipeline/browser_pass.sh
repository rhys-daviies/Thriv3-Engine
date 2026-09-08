#!/bin/zsh
set -u
cd "${0:a:h}"
export RB_SEASON=2026 RB_REF=2025 RB_CURRENT=1
for i in 0 1 2 3; do python3 -u browse.py --keys shb2026_$i.txt --variants 8 --strict-season --out st_br2_$i.json > log_br2_$i.txt 2>&1 & done
wait
for i in 0 1 2 3; do echo "  shard$i ok=$(grep -c 'OK ' log_br2_$i.txt) fail=$(grep -c 'FAIL ' log_br2_$i.txt)"; done
python3 - <<'PY'
import sys,json,glob; sys.path.insert(0,'.')
import state
main=state.load(); n=f=0
for fl in sorted(glob.glob('st_br2_*.json')):
    for k,v in json.load(open(fl,encoding='utf-8')).items():
        if v.get('status')=='done' and main.get(k,{}).get('status')!='done': main[k]=v; n+=1
        elif v.get('status')!='done' and k not in main: main[k]=v; f+=1
state.save(main)
print(f'  absorbed +{n} done, +{f} failures; {sum(1 for x in main.values() if x.get("status")=="done")} done of 1722')
PY
echo "===== writing CSVs ====="
python3 -u write_out.py 2>&1 | grep -E 'players|schools done|schools failed|player rows'
echo "===== BROWSER PASS COMPLETE ====="
