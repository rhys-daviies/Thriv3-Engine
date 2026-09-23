#!/bin/zsh
set -u
cd "${0:a:h}"
export RB_SEASON=2026 RB_REF=2025 RB_CURRENT=1
for i in 0 1 2 3; do python3 -u browse.py --keys shb2026_$i.txt --variants 8 --strict-season --out st_br2_$i.json > log_br2_$i.txt 2>&1 & done
wait
for i in 0 1 2 3; do echo "  shard$i ok=$(grep -c 'OK ' log_br2_$i.txt) fail=$(grep -c 'FAIL ' log_br2_$i.txt)"; done
# Was the exact four-line merge L7J's docstring calls out as wrong in three of
# its four cases, and unscoped besides. One merge owner, one run scope.
python3 - <<'PY'
import sys; sys.path.insert(0,'.')
import state
scope = state.run_scope()
c = state.absorb('st_br2_*.json', scope)
done = sum(1 for v in state.load().values() if v.get('status') == 'done')
print('  absorbed %s; %d done   scope %d key(s), %d out-of-scope refused'
      % (dict(c) or 'nothing', done, len(scope), c.get('out-of-scope', 0)))
PY
echo "===== writing CSVs ====="
python3 -u write_out.py 2>&1 | grep -E 'players|schools done|schools failed|player rows'
echo "===== BROWSER PASS COMPLETE ====="
