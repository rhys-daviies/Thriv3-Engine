#!/bin/zsh
# Acquire the CURRENT season's rosters. Usage: ./run_season_current.sh 2026 2025
#
# Differs from run_season.sh (the backfill runner) in three ways, all forced by
# the season being live rather than archived:
#   * the reference season is the one BEFORE, not after -- there is nothing after
#   * a page need not name its season; it must instead show a turned-over squad
#     (RB_CURRENT, gate in run.evaluate)
#   * no Wayback stage and no minutes stage -- the season has not been played
set -u
S=$1; R=$2
cd "${0:a:h}"   # the pipeline's own directory, wherever it lives
export RB_SEASON=$S RB_REF=$R RB_CURRENT=1

remaining () {
  python3 - "$S" <<'PY'
import sys; sys.path.insert(0,'.')
import state
st=state.load(); tg=[state.key(r) for r in state.targets()]
done={k for k,v in st.items() if v.get('status')=='done'}
rem=sorted(set(tg)-done)
open(f'rem{sys.argv[1]}.txt','w').write('\n'.join(rem))
print(f'  {len(done)} done, {len(rem)} remaining')
PY
}
absorb () {
  python3 - "$1" <<'PY'
import sys,json,glob; sys.path.insert(0,'.')
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

echo "===== $S : direct (year-swapped URL) ====="
python3 -u run.py direct --workers 12 2>&1 | grep -E '\[direct\]|^\{' | tail -3
remaining

echo "===== $S : live URL variants (incl. the bare current-season path) ====="
python3 -u variants.py --workers 10 2>&1 | grep -E '^  [0-9]+/|^variants done' | tail -3
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

# A stage file is a cache that outlives the code that filled it, and absorb
# trusts every done entry it finds. Re-measure the shipped rows against the gate
# in force NOW, before anything is written -- see verify_gate.py.
echo "===== $S : re-applying the turnover gate to everything absorbed ====="
python3 -u verify_gate.py --apply 2>&1 | grep -vE 'NotOpenSSLWarning|warnings.warn' | tail -20
remaining

echo "===== $S : writing roster CSVs (no minutes -- season unplayed) ====="
python3 -u write_out.py 2>&1 | grep -E 'players|schools done|schools failed|player rows'
echo "===== $S COMPLETE ====="
