#!/bin/zsh
# Resume the 2026 run at the browser stage. Detached with setsid: two earlier
# launches were killed when their parent task's process group was torn down.
set -u
S=2026
cd "${0:a:h}"   # the pipeline's own directory, wherever it lives
export RB_SEASON=$S RB_REF=2025 RB_CURRENT=1

python3 - <<'PY'
import sys; sys.path.insert(0,'.')
import state
st=state.load(); tg=[state.key(r) for r in state.targets()]
done={k for k,v in st.items() if v.get('status')=='done'}
rem=sorted(set(tg)-done)
open('rem2026.txt','w').write('\n'.join(rem))
for i in range(4): open(f'shb2026_{i}.txt','w').write('\n'.join(rem[i::4]))
print(f'{len(done)} done, {len(rem)} remaining -> 4 shards')
PY

echo "===== browser, 4 shards ====="
for i in 0 1 2 3; do python3 -u browse.py --keys shb${S}_$i.txt --variants 8 --strict-season --out st_br${S}_$i.json > log_br${S}_$i.txt 2>&1 & done
wait
for i in 0 1 2 3; do echo "  shard$i ok=$(grep -cE '^  OK' log_br${S}_$i.txt) fail=$(grep -cE '^  FAIL' log_br${S}_$i.txt)"; done

# Was an inlined merge of its own: two cases, pre-L7J, and unscoped. It is the
# same substitution L7J made in run_season_current.sh, applied to the script it
# missed -- one merge owner, and a run that can only touch its own keys.
python3 - <<'PY'
import sys; sys.path.insert(0,'.')
import state
scope = state.run_scope()
c = state.absorb('st_br2026_*.json', scope)
done = sum(1 for v in state.load().values() if v.get('status') == 'done')
print('  absorbed %s; %d done   scope %d key(s), %d out-of-scope refused'
      % (dict(c) or 'nothing', done, len(scope), c.get('out-of-scope', 0)))
PY

echo "===== writing roster CSVs (no minutes -- season unplayed) ====="
python3 -u write_out.py 2>&1 | grep -E 'players|schools done|schools failed|player rows'
echo "===== 2026 COMPLETE ====="
