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
S=$1; R=$2; shift 2
cd "${0:a:h}"   # the pipeline's own directory, wherever it lives
export RB_SEASON=$S RB_REF=$R RB_CURRENT=1

# RUN SCOPE, which is not target membership. --keys takes a file of
# 'School||Sport' lines and --divisions a comma list matching the Division
# column verbatim; both together intersect. A target excluded here is simply
# not attempted -- nothing is written to state and _targets.csv is untouched,
# so it stays eligible next run. Exported rather than passed along, because the
# stages below are separate processes and a forgotten flag would silently widen
# the run back to everything.
while [ $# -gt 0 ]; do
  case "$1" in
    --keys)      export RB_KEYS="$2"; shift 2 ;;
    --divisions) export RB_DIVISIONS="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "${RB_KEYS:-}${RB_DIVISIONS:-}" ] && python3 -u plan.py

remaining () {
  python3 - "$S" <<'PY'
import sys; sys.path.insert(0,'.')
import state
st=state.load(); tg=[state.key(r) for r in state.attempt_targets()]
done={k for k,v in st.items() if v.get('status')=='done'}
rem=sorted(set(tg)-done)
open(f'rem{sys.argv[1]}.txt','w').write('\n'.join(rem))
print(f'  {len(done)} done, {len(rem)} remaining')
PY
}
absorb () {
  # The merge policy lives in state.merge_attempt, not here. It used to be four
  # lines of heredoc, and three of its four cases were wrong -- see state.py.
  #
  # The SCOPE comes from state.run_scope(), the same RB_KEYS/RB_DIVISIONS
  # narrowing plan.py prints as TO ATTEMPT. Stage files are resumable and so
  # they accumulate across runs; without a scope a seven-programme run merges
  # records belonging to twenty-three programmes it never attempted, which is
  # how L7R moved Bentley's history from outside its own run.
  python3 - "$1" <<'PY'
import sys; sys.path.insert(0,'.')
import state
scope = state.run_scope()
c = state.absorb(sys.argv[1], scope)
print('  absorbed from %s  %s   scope %d key(s), %d out-of-scope record(s) refused'
      % (sys.argv[1], dict(c) or 'nothing', len(scope), c.get('out-of-scope', 0)))
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

# Only as many shards as there are keys. An empty shard file used to be handed
# to browse.py, where an empty key set read as "no restriction" and the stage
# walked the whole universe -- seen on a six-programme run where two of the four
# shards were empty. browse.py now treats an empty file as an empty scope, and
# this stops creating the file at all.
echo "===== $S : browser, 4 shards ====="
python3 - "$S" <<'PY'
import sys
keys=[l.strip() for l in open(f'rem{sys.argv[1]}.txt') if l.strip()]
n=min(4, len(keys))
for i in range(n): open(f'shb{sys.argv[1]}_{i}.txt','w').write('\n'.join(keys[i::n]))
open(f'shards{sys.argv[1]}.txt','w').write(str(n))
print(f'  sharded {len(keys)} across {n}')
PY
NSH=$(cat shards${S}.txt)
if [ "$NSH" -gt 0 ]; then
  for i in $(seq 0 $((NSH-1))); do python3 -u browse.py --keys shb${S}_$i.txt --variants 8 --strict-season --out st_br${S}_$i.json > log_br${S}_$i.txt 2>&1 & done
  wait
  for i in $(seq 0 $((NSH-1))); do echo "  shard$i ok=$(grep -cE '^  OK' log_br${S}_$i.txt) fail=$(grep -cE '^  FAIL' log_br${S}_$i.txt)"; done
fi
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
