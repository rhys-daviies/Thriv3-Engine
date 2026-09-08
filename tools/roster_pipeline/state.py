import csv, json, os, re, threading, collections
HERE=os.path.dirname(os.path.abspath(__file__))
SEASON=int(os.environ.get('RB_SEASON','2024'))
# The verified season we compare against. For a backfill that is the season
# AFTER the target (2024 checks itself against 2025). For the CURRENT season
# there is no later season to hold, so RB_REF points at the one before.
REF=int(os.environ.get('RB_REF', SEASON+1))
T24=os.path.expanduser(f'~/Documents/Thriv3/{SEASON} Roster Sheets/_targets.csv')
D25=os.path.expanduser(f'~/Documents/Thriv3/{REF} Roster Sheets')
# NOT in the scratchpad: a session restart wipes that directory, and this file
# is the only record of work already done.
DURABLE=os.path.expanduser(f'~/Documents/Thriv3/{SEASON} Roster Sheets/_state')
os.makedirs(DURABLE,exist_ok=True)
STATE=os.path.join(DURABLE,f'state{SEASON}.json')
_lock=threading.Lock()

def key(r): return r['School']+'||'+r['Sport']

def fix_url(u):
    """Repair the year-swap generator's YYYY-26 span bug -> YYYY-25."""
    if not u: return u
    return re.sub(r'/(20\d\d)-26/', lambda m: f'/{m.group(1)}-{str(int(m.group(1))+1)[-2:]}/', u)

def targets():
    rows=list(csv.DictReader(open(T24,encoding='utf-8')))
    for r in rows:
        r['_cand']=fix_url(r[f'Roster URL {SEASON} (candidate)'].strip())
    return rows

def load():
    if os.path.exists(STATE):
        return json.load(open(STATE,encoding='utf-8'))
    return {}

def save(st):
    # The tmp name must be unique per writer. A shared '.tmp' is safe against
    # threads (the lock covers them) but not against PROCESSES: the runner's
    # absorb step and a stage's last write raced, one replaced the file the
    # other was about to replace, and the loser died on FileNotFoundError.
    with _lock:
        tmp='%s.%d.%d.tmp'%(STATE,os.getpid(),threading.get_ident())
        json.dump(st,open(tmp,'w',encoding='utf-8'),ensure_ascii=False)
        os.replace(tmp,STATE)

FILEMAP={('NCAA D1','mens-soccer'):f'ncaa_d1_mens_soccer_{REF}_rosters.csv',
         ('NCAA D1','womens-soccer'):f'ncaa_d1_womens_soccer_{REF}_rosters.csv',
         ('NCAA D2','mens-soccer'):f'ncaa_d2_mens_soccer_{REF}_rosters.csv',
         ('NCAA D2','womens-soccer'):f'ncaa_d2_womens_soccer_{REF}_rosters.csv',
         ('NCAA D3','mens-soccer'):f'ncaa_d3_mens_soccer_{REF}_rosters.csv',
         ('NCAA D3','womens-soccer'):f'ncaa_d3_womens_soccer_{REF}_rosters.csv',
         # NAIA joined the worklist for 2026. names25() keys on School||Sport
         # with no division, so this is only safe because no NAIA school shares
         # a name with an NCAA one in the same sport -- checked, 0 collisions.
         ('NAIA','mens-soccer'):f'naia_mens_soccer_{REF}_rosters.csv',
         ('NAIA','womens-soccer'):f'naia_womens_soccer_{REF}_rosters.csv',
         ('USCAA','mens-soccer'):f'uscaa_mens_soccer_{REF}_rosters.csv',
         ('USCAA','womens-soccer'):f'uscaa_womens_soccer_{REF}_rosters.csv'}

def names25():
    """(school,sport) -> set of lowercased 2025 player names."""
    out=collections.defaultdict(set)
    for (div,sp),f in FILEMAP.items():
        p=os.path.join(D25,f)
        if not os.path.exists(p): continue
        for r in csv.DictReader(open(p,encoding='utf-8')):
            out[r['School']+'||'+sp].add(re.sub(r'[^a-z]','',r['Player Name'].lower()))
    return out
