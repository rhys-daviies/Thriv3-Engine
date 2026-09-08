#!/bin/zsh
# End-to-end acquisition for one season. Usage: ./run_season.sh 2022
#
# Lessons from 2023 and 2024, all load-bearing:
#  * every stage writes a season-named file -- state keys are School||sport and
#    identical across years, so a stale file merges silently
#  * remaining work is derived from the TARGETS, not from the state's keys; a
#    target never attempted is not in state and was being skipped entirely
#  * no `pgrep` waits -- the pattern also matches the shell that launched it
#  * exactly one writer per checkpoint file; two concatenated JSON documents
#    corrupted the 2023 minutes file
set -u
S=$1
cd "${0:a:h}"   # the pipeline's own directory, wherever it lives
export RB_SEASON=$S

remaining () {  # targets minus done -> rem<season>.txt, echoes the count
  python3 - "$S" <<'PY'
import sys; sys.path.insert(0,'.')
import state
st=state.load(); tg=[state.key(r) for r in state.targets()]
done={k for k,v in st.items() if v.get('status')=='done'}
rem=sorted(set(tg)-done)
open(f'rem{sys.argv[1]}.txt','w').write('\n'.join(rem))
print(f'{len(done)} done, {len(rem)} remaining')
PY
}
absorb () {  # merge a stage's output into the season state
  python3 - "$1" <<'PY'
import sys,json,os,glob; sys.path.insert(0,'.')
import state
main=state.load(); n=0
for f in sorted(glob.glob(sys.argv[1])):
    for k,v in json.load(open(f,encoding='utf-8')).items():
        if v.get('status')=='done' and main.get(k,{}).get('status')!='done': main[k]=v; n+=1
        # merge FAILURES too. Absorbing only successes meant a target that the
        # direct stage never touched, and no ladder resolved, had no entry at
        # all -- it read as never-attempted when its reason was sitting in the
        # stage file. 54 rows looked like a coverage gap and were a reporting one.
        elif v.get('status')!='done' and k not in main: main[k]=v
state.save(main); print(f'  absorbed +{n} from {sys.argv[1]}')
PY
}

echo "===== $S : direct ====="
python3 -u run.py direct --workers 12 2>&1 | grep -E '\[direct\]|^\{' | tail -3
remaining

echo "===== $S : live URL variants ====="
python3 -u variants.py --workers 10 2>&1 | grep -E '^  \d+/|^variants done' | tail -3
absorb "state_variants_$S.json"; remaining

echo "===== $S : season selector ====="
python3 -u selector.py --keys rem$S.txt --out st_sel_$S.json 2>&1 | grep -cE '^  OK' | sed 's/^/  selector resolved /'
absorb "st_sel_$S.json"; remaining

echo "===== $S : browser, 4 shards ====="
python3 - "$S" <<'PY'
import sys
keys=[l.strip() for l in open(f'rem{sys.argv[1]}.txt') if l.strip()]
for i in range(4): open(f'shb{sys.argv[1]}_{i}.txt','w').write('\n'.join(keys[i::4]))
print(f'  sharded {len(keys)}')
PY
for i in 0 1 2 3; do python3 -u browse.py --keys shb${S}_$i.txt --variants 8 --strict-season --out st_br${S}_$i.json > log_br${S}_$i.txt 2>&1 & done
wait
for i in 0 1 2 3; do echo "  shard$i ok=$(grep -cE '^  OK' log_br${S}_$i.txt) fail=$(grep -cE '^  FAIL' log_br${S}_$i.txt)"; done
absorb "st_br${S}_*.json"; remaining

echo "===== $S : archive ====="
python3 -u wayback2.py --keys rem$S.txt --out st_wb_$S.json --sleep 1.5 2>&1 | grep -cE '^  OK' | sed 's/^/  archive resolved /'
absorb "st_wb_$S.json"; remaining

echo "===== $S : writing roster CSVs ====="
python3 -u write_out.py 2>&1 | grep -E 'players|schools done|schools failed|player rows'

echo "===== $S : minutes (one writer, resumable passes) ====="
prev=-1
for pass in 1 2 3 4 5 6 7 8; do
  n=$(python3 -c "import json;print(len(json.load(open('minutes$S.json'))))" 2>/dev/null || echo 0)
  echo "  pass $pass: have $n"
  [ "$n" = "$prev" ] && { echo "  no progress, stopping"; break; }
  prev=$n
  python3 -u backfill_minutes.py --workers 8 2>&1 | grep -E '^done:|already done' | tail -2
done

echo "===== $S : merging minutes ====="
python3 -u merge_minutes.py --write 2>&1 | grep -E 'rows now carry|filled|rejected'
echo "===== $S COMPLETE ====="
