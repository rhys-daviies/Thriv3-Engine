# -*- coding: utf-8 -*-
"""Fetch / parse / normalize for a roster acquisition run.

The season is set by RB_SEASON (default 2024) so the same code drives every
year rather than being forked per season."""
import json, os, re, hashlib, time, random, unicodedata
import requests
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
SEASON = int(os.environ.get('RB_SEASON', '2024'))
# Outside the session scratchpad for the same reason as the state file, but in
# Library/Caches rather than Documents -- it is refetchable, not work product.
CACHE = os.path.expanduser('~/Library/Caches/recruitmatch-rb/pages')
os.makedirs(CACHE, exist_ok=True)

UAS = [
 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
]
HDRS = {'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language':'en-US,en;q=0.9','Connection':'keep-alive'}

_tls = {}
def sess():
    import threading
    k = threading.get_ident()
    if k not in _tls:
        s = requests.Session(); s.headers.update(HDRS); _tls[k] = s
    return _tls[k]

def ckey(url): return hashlib.sha1(url.encode()).hexdigest()

def fetch(url, tries=3, timeout=45, use_cache=True, min_size=800):
    """Return (status, text). Caches successful bodies on disk."""
    p = os.path.join(CACHE, ckey(url) + '.html')
    if use_cache and os.path.exists(p):
        try:
            b = open(p, encoding='utf-8', errors='replace').read()
            if len(b) >= min_size: return 200, b
        except Exception: pass
    last = None
    for i in range(tries):
        try:
            h = dict(HDRS); h['User-Agent'] = random.choice(UAS)
            r = sess().get(url, headers=h, timeout=timeout, allow_redirects=True)
            last = r.status_code
            if r.status_code == 200 and len(r.text) >= min_size:
                try: open(p, 'w', encoding='utf-8').write(r.text)
                except Exception: pass
                return 200, r.text
            if r.status_code in (404, 410): return r.status_code, ''
            if r.status_code in (403, 429, 500, 502, 503, 504):
                time.sleep(1.5 * (i + 1) + random.random()); continue
            return r.status_code, r.text if r.status_code == 200 else ''
        except Exception as e:
            last = type(e).__name__
            time.sleep(1.0 * (i + 1) + random.random())
    return last, ''

# ---------------------------------------------------------------- wayback
def cdx(url, frm=None, to=None, limit=40):
    frm = frm or f'{SEASON}0801'
    to = to or f'{SEASON + 1}0228'
    """Return list of wayback timestamps for url in window, newest-relevant first."""
    q = ('https://web.archive.org/cdx/search/cdx?url=' + requests.utils.quote(url, safe='')
         + f'&from={frm}&to={to}&output=json&fl=timestamp,statuscode&filter=statuscode:200'
         + f'&collapse=timestamp:6&limit={limit}')
    for i in range(3):
        try:
            r = sess().get(q, timeout=60, headers={'User-Agent': UAS[0]})
            if r.status_code == 200 and r.text.strip():
                rows = json.loads(r.text)
                return [x[0] for x in rows[1:]]
            if r.status_code in (429, 503): time.sleep(4 * (i + 1)); continue
            return []
        except Exception:
            time.sleep(3 * (i + 1))
    return []

def wb_url(ts, url): return f'https://web.archive.org/web/{ts}id_/{url}'

# ---------------------------------------------------------------- nuxt / devalue
PKEYS = {'lastName', 'firstName'}
PHINT = ('academicYearShort', 'positionShort', 'positionLong', 'academicYearLong', 'jerseyNumber')

def _nuxt(html):
    m = re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m: return None
    try: return json.loads(m.group(1))
    except Exception: return None

def _scal(flat, v, d=0):
    if d > 6: return None
    if isinstance(v, str): return v
    if isinstance(v, bool): return None
    if isinstance(v, int):
        if v < 0 or v >= len(flat): return None
        return _scal(flat, flat[v], d + 1)
    return None

def parse_nuxt(html):
    flat = _nuxt(html)
    if not flat: return None, None
    out = []
    for e in flat:
        if isinstance(e, dict) and PKEYS <= set(e) and any(k in e for k in PHINT):
            p = {}
            for k in ('firstName','lastName','hometown','positionShort','positionLong',
                      'academicYearShort','academicYearLong','jerseyNumber','highSchool','hide'):
                if k in e:
                    s = _scal(flat, e[k])
                    if s is not None: p[k] = s
            if isinstance(e.get('hide'), bool) and e['hide']: continue
            out.append(p)
    title = None
    for e in flat:
        if isinstance(e, dict) and 'displayTitle' in e and 'players' in e:
            t = _scal(flat, e['displayTitle'])
            if isinstance(t, str) and re.search(r'20\d\d', t): title = t; break
    if not title:
        mt = re.search(r'<title[^>]*>(.*?)</title>', html, re.S)
        if mt: title = re.sub(r'\s+', ' ', mt.group(1)).strip()
    if not out: return None, title
    recs = []
    for p in out:
        nm = ' '.join(x for x in [(p.get('firstName') or '').strip(), (p.get('lastName') or '').strip()] if x).strip()
        if not nm: continue
        recs.append({'name': nm,
                     'cls': (p.get('academicYearShort') or p.get('academicYearLong') or '').strip(),
                     'pos': (p.get('positionLong') or p.get('positionShort') or '').strip(),
                     'home': (p.get('hometown') or '').strip()})
    return (recs or None), title

# ---------------------------------------------------------------- legacy sidearm html
def parse_sidearm_html(html):
    soup = BeautifulSoup(html, 'lxml')
    recs = []
    items = soup.select('li.sidearm-roster-player, div.sidearm-roster-player')
    for li in items:
        def g(sel):
            e = li.select_one(sel); return e.get_text(' ', strip=True) if e else ''
        nm = g('.sidearm-roster-player-name a, .sidearm-roster-player-name h3, .sidearm-roster-player-name')
        nm = re.sub(r'\s+', ' ', nm)
        nm = re.sub(r'\s*#?\d+\s*$', '', nm).strip()
        if not nm: continue
        recs.append({'name': nm,
                     'cls': g('.sidearm-roster-player-academic-year'),
                     'pos': (g('.sidearm-roster-player-position-long-short')
                             or g('.sidearm-roster-player-position span')
                             or g('.sidearm-roster-player-position')),
                     'home': g('.sidearm-roster-player-hometown')})
    return recs or None

# ------------------------------------------------- s-person-card (new sidearm SSR)
def _sr_pairs(card):
    """Each field is an `sr-only` label followed by its value in the same item."""
    out = {}
    for item in card.select('[class*="bio-stats-item"], [class*="location-item"], '
                            '[class*="__detail-item"]'):
        lab = item.select_one('.sr-only, [class*="sr-only"]')
        if not lab: continue
        lt = re.sub(r'\s+', ' ', lab.get_text(' ', strip=True)).strip().rstrip(':').lower()
        full = re.sub(r'\s+', ' ', item.get_text(' ', strip=True)).strip()
        lh = re.sub(r'\s+', ' ', lab.get_text(' ', strip=True)).strip()
        val = full[len(lh):].strip(' :') if full.startswith(lh) else full
        if lt and val and lt not in out: out[lt] = val
    return out

def parse_person_cards(html):
    soup = BeautifulSoup(html, 'lxml')
    recs = []
    for c in soup.select('.s-person-card, [class*="s-person-card"]'):
        nm = ''
        e = c.select_one('[class*="personal-single-line"], [class*="__personal"] a, '
                         '[class*="__personal"]')
        if e: nm = re.sub(r'\s+', ' ', e.get_text(' ', strip=True)).strip()
        if not nm:
            for a in c.select('a[aria-label]'):
                m = re.match(r'^(.*?)\s+(?:jersey number|full bio|INFLCR)', a.get('aria-label') or '', re.I)
                if m: nm = m.group(1).strip(); break
        nm = re.sub(r'^(full bio for|jersey number)\s*', '', nm, flags=re.I).strip()
        if not nm or len(nm) > 60 or not re.search(r'[A-Za-z]{2}', nm): continue
        if re.fullmatch(r'(jersey number\s*)?\d*', nm, re.I): continue
        f = _sr_pairs(c)
        recs.append({'name': nm,
                     'cls': f.get('academic year') or f.get('class') or f.get('year') or '',
                     'pos': f.get('position') or '',
                     'home': f.get('hometown') or ''})
    seen, out = set(), []
    for r in recs:
        k = r['name'].lower()
        if k in seen: continue
        seen.add(k); out.append(r)
    return out or None

# ------------------------------------------------- roster-card (newer sidearm/WMT)
CLASSY = re.compile(r"""^(r[\-\.]?\s*)?(fr|so|jr|sr|gr|fy|rs)\b\.?$
                      |^(fresh|soph|jun|sen|grad|redshirt|first)
                      |^(1st|2nd|3rd|4th|5th|6th)\b
                      |^'?\d\d$|^20\d\d$""", re.I | re.X)

def _labelled_fields(c):
    """`roster-player-card-profile-field` blocks pair a label with its value."""
    out = {}
    for f in c.select('[class*="profile-field"]'):
        lab = f.select_one('[class*="profile-field__label"]')
        if not lab: continue
        lt = re.sub(r'\s+', ' ', lab.get_text(' ', strip=True)).strip().rstrip(':').lower()
        full = re.sub(r'\s+', ' ', f.get_text(' ', strip=True)).strip()
        lh = re.sub(r'\s+', ' ', lab.get_text(' ', strip=True)).strip()
        val = full[len(lh):].strip(' :') if full.startswith(lh) else full
        if lt and val and lt not in out: out[lt] = val
    return out

def parse_roster_cards(html):
    """`roster-card` / `roster-card-item` markup: name, position and hometown sit
    in named elements, while class shares a container with height, so the class
    is matched by shape rather than position."""
    soup = BeautifulSoup(html, 'lxml')
    recs = []
    for c in soup.select('.roster-card, .roster-card-item, [class*="roster-card"]'):
        a = c.select_one('[class*="card__title-link"], [class*="card-item__title-link"], '
                         '[class*="card__title"] a, [class*="card-item__title"] a, h3 a')
        if not a: continue
        nm = re.sub(r'\s+', ' ', a.get_text(' ', strip=True)).strip()
        if not nm or len(nm) > 60 or not re.search(r'[A-Za-z]{2}', nm): continue
        def g(*sels):
            for sel in sels:
                e = c.select_one(sel)
                if e:
                    t = re.sub(r'\s+', ' ', e.get_text(' ', strip=True)).strip()
                    if t: return t
            return ''
        f = _labelled_fields(c)
        cls = f.get('class') or f.get('academic year') or f.get('year') or ''
        if not cls:
            for v in c.select('[class*="profile-field__value"]'):
                t = re.sub(r'\s+', ' ', v.get_text(' ', strip=True)).strip()
                if t and CLASSY.match(t): cls = t; break
        pos = g('[class*="card__position"]', '[class*="card-item__position"]') or f.get('position', '')
        home = g('[class*="card__hometown"]', '[class*="card-item__hometown"]') or f.get('hometown', '')
        # some cards hand back one unsplit blob: "5'9\" Fifth Year Hometown
        # Winter Haven, Fla. High School Winter Haven Senior HS"
        if home and re.search(r'\bHometown\b', home):
            blob = home
            m = re.search(r'\bHometown\b\s*:?\s*(.*?)(?=\s*\b(?:High School|Last School|'
                          r'Previous School|Club|Major)\b|$)', blob, re.I)
            home = (m.group(1).strip(' :,-') if m else '')
            if not cls:
                head = blob[:blob.lower().index('hometown')]
                for tok in re.split(r'\s{1,}', head):
                    pass
                m2 = re.search(r'\b(R-)?(Fifth|Sixth|Fourth|Third|Second|First|Freshman|Sophomore|'
                               r'Junior|Senior|Graduate|Redshirt)[\w\- ]*?(Year)?\b', head, re.I)
                if m2: cls = m2.group(0).strip()
                else:
                    m3 = re.search(r'\b(R-)?(Fr|So|Jr|Sr|Gr|Fy)\.?\b', head)
                    if m3: cls = m3.group(0)
        # page furniture can carry a stray hometown, so require a class or position
        if not (cls or pos): continue
        recs.append({'name': nm, 'cls': cls, 'pos': pos, 'home': home})
    seen, out = set(), []
    for r in recs:
        k = r['name'].lower()
        if k in seen: continue
        seen.add(k); out.append(r)
    return out or None

# ---------------------------------------------------------------- generic tables
NAME_H  = ('name', 'player', 'full name', 'athlete')
CLS_H   = ('cl', 'yr', 'year', 'class', 'cl.', 'academic year', 'yr.', 'eligibility', 'cl/exp')
POS_H   = ('pos', 'position', 'pos.')
HOME_H  = ('hometown', 'hometown/high school', 'hometown / high school', 'hometown/highschool',
           'hometown (high school)', 'hometown/last school', 'hometown / previous school')
CLUB_H  = ('club', 'club team', 'high school', 'previous school', 'hs', 'major')

def _hmatch(h, opts):
    h = re.sub(r'\s+', ' ', h.strip().lower()).rstrip(':')
    if h in opts: return True
    return opts is HOME_H and h.startswith('hometown')

LABEL_FIELD = [(('name','player','full name','athlete'), 'name'),
               (('pos','position'), 'pos'),
               (('cl','yr','year','class','academic year','eligibility'), 'cls'),
               (('hometown','hometown/high school','hometown / high school',
                 'hometown/highschool','hometown/last school','hometown / previous school',
                 'hometown/hs'), 'home')]

def _label_of(td):
    """PrestoSports responsive tables carry a `Pos.:`-style span in each cell."""
    lab = td.select_one('span.label, span[class*="label"]')
    if not lab: return None, None
    lt = re.sub(r'\s+', ' ', lab.get_text(' ', strip=True)).strip().rstrip(':.').lower()
    rest = td.get_text(' ', strip=True)
    lh = lab.get_text(' ', strip=True)
    if rest.startswith(lh): rest = rest[len(lh):]
    return lt, re.sub(r'\s+', ' ', rest).strip(' :')

def _by_label(tds):
    """Assign fields from in-cell labels; returns {} when the table is not labelled."""
    got, hits = {}, 0
    for td in tds:
        lt, val = _label_of(td)
        if lt is None: continue
        hits += 1
        for opts, field in LABEL_FIELD:
            # 'Hometown/Previous School', 'Hometown/HS' etc. are all the same field
            if field not in got and (lt in opts or (field == 'home' and lt.startswith('hometown'))):
                got[field] = val; break
    return got if hits >= 2 else {}

def parse_tables(html):
    soup = BeautifulSoup(html, 'lxml')
    best = None
    for tb in soup.find_all('table'):
        hrow = None
        thead = tb.find('thead')
        if thead: hrow = thead.find('tr')
        if hrow is None:
            tr = tb.find('tr')
            if tr and tr.find_all(('th',)): hrow = tr
        heads = []
        if hrow is not None:
            heads = [re.sub(r'\s+', ' ', th.get_text(' ', strip=True)).strip()
                     for th in hrow.find_all(('th', 'td'))]
        low = [h.lower().rstrip(':') for h in heads]
        iN = next((i for i, h in enumerate(low) if _hmatch(h, NAME_H)), None)
        iC = next((i for i, h in enumerate(low) if _hmatch(h, CLS_H)), None)
        iP = next((i for i, h in enumerate(low) if _hmatch(h, POS_H)), None)
        iH = next((i for i, h in enumerate(low) if _hmatch(h, HOME_H)), None)
        body = tb.find('tbody') or tb
        recs = []
        for tr in body.find_all('tr'):
            if tr is hrow: continue
            tds = tr.find_all(('td', 'th'))
            if not tds: continue
            lab = _by_label(tds)
            if lab and not lab.get('name'):
                # labelled row whose name cell carries no label: take the bio link,
                # else the first unlabelled cell that reads like a name
                a = tr.select_one('a[href*="roster"], a[href*="bio"], a[href*="player"]')
                cand = a.get_text(' ', strip=True) if a else ''
                if not cand:
                    for td in tds:
                        if _label_of(td)[0] is not None: continue
                        t = re.sub(r'\s+', ' ', td.get_text(' ', strip=True)).strip()
                        if len(re.findall(r'[A-Za-z]', t)) >= 3 and len(t) <= 60:
                            cand = t; break
                if cand: lab['name'] = cand
            if lab.get('name'):
                nm = lab['name']
                rec = {'name': nm, 'cls': lab.get('cls', ''),
                       'pos': lab.get('pos', ''), 'home': lab.get('home', '')}
            else:
                if iN is None or len(tds) <= iN: continue
                def cell(i):
                    if i is None or i >= len(tds): return ''
                    td = tds[i]
                    _, v = _label_of(td)
                    if v is not None: return v
                    return re.sub(r'\s+', ' ', td.get_text(' ', strip=True)).strip()
                rec = {'name': cell(iN), 'cls': cell(iC), 'pos': cell(iP), 'home': cell(iH)}
                # a labelled row whose name cell is unlabelled still yields good fields
                for f in ('cls', 'pos', 'home'):
                    if not rec[f] and lab.get(f): rec[f] = lab[f]
            # collapse internal whitespace BEFORE length-checking: these tables
            # wrap first and last name across many tabs and newlines
            nm = re.sub(r'\s+', ' ', (rec['name'] or '')).strip()
            nm = re.sub(r'^#?\d+\s+', '', nm).strip()
            if not nm or len(nm) > 60 or not re.search(r'[A-Za-z]{2}', nm): continue
            if nm.lower() in ('name', 'player', 'full name'): continue
            rec['name'] = nm
            recs.append(rec)
        if recs and (best is None or len(recs) > len(best)): best = recs
    return best

def parse_any(html):
    """Try every parser and keep the richest read.

    A page often exposes the same roster twice - card markup and a table - and
    the two do not always agree on how many players they list, so prefer
    whichever yields more players rather than whichever matches first.
    """
    mt = re.search(r'<title[^>]*>(.*?)</title>', html, re.S)
    title = re.sub(r'\s+', ' ', mt.group(1)).strip() if mt else ''
    best, best_name, nuxt_title = None, 'none', None
    try:
        r, t = parse_nuxt(html)
        if t: nuxt_title = t
        if r: best, best_name = r, 'nuxt'
    except Exception:
        pass
    for fn, nm in ((parse_sidearm_html, 'sidearm-html'), (parse_tables, 'table'),
                   (parse_roster_cards, 'roster-card')):
        try: rr = fn(html)
        except Exception: rr = None
        if rr and (best is None or len(rr) > len(best)):
            best, best_name = rr, nm
    if best is None:
        try: rr = parse_person_cards(html)
        except Exception: rr = None
        if rr: best, best_name = rr, 'person-card'
    return best, (nuxt_title or title), best_name

# ---------------------------------------------------------------- normalize
GEO = json.load(open(os.path.join(HERE, 'geo25.json'), encoding='utf-8'))
G_EX, G_TL = GEO['exact'], GEO['tail']

US_ST = set("""AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM
NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR VI GU AS MP""".split())
US_NAME = set(x.lower() for x in """Alabama Alaska Arizona Arkansas California Colorado Connecticut Delaware Florida
Georgia Hawaii Idaho Illinois Indiana Iowa Kansas Kentucky Louisiana Maine Maryland Massachusetts Michigan Minnesota
Mississippi Missouri Montana Nebraska Nevada Ohio Oklahoma Oregon Pennsylvania Tennessee Texas Utah Vermont Virginia
Washington Wisconsin Wyoming USA U.S.A. US United States""".split('\n')[0].split() + [
 'new hampshire','new jersey','new mexico','new york','north carolina','north dakota','rhode island',
 'south carolina','south dakota','west virginia','district of columbia','puerto rico','united states',
 'united states of america','usa','u.s.a.','u.s.'])

def _n(s): return re.sub(r'[^a-z]', '', (s or '').lower())

def geo(home, use_exact=True):
    home = (home or '').strip()
    if not home: return '', ''
    if use_exact and home in G_EX:
        v = G_EX[home]
        if v[0]: return v[0], v[1]        # an empty verdict means "unknown", not USA
    segs = [s.strip() for s in re.split(r'[,/|]|\s+-\s+', home) if s.strip()]
    for s in reversed(segs[-2:] if len(segs) > 1 else segs):
        k = _n(s)
        if not k: continue
        if s.upper() in US_ST or s.lower().rstrip('.') in US_NAME: return 'USA', ''
        if k in G_TL:
            c = G_TL[k]
            return ('International', c) if c else ('USA', '')
    return 'USA', ''

STAFF = re.compile(r"""\b(head\s+(soccer\s+)?coach|assistant\s+coach|associate\s+head\s+coach
                      |volunteer\s+coach|goalkeeper\s+coach|coach\b
                      |graduate\s+assistant|student\s+assistant|manager\b|managers\b
                      |athletic\s+trainer|trainer\b|physician|nutrition|dietit
                      |strength|sports\s+performance|performance\s+coach
                      |director\b|supervisor\b|coordinator\b|operations\b|sports\s+information|equipment
                      |compliance|marketing|video|analyst|academic\s+advis
                      |chaplain|photographer|broadcast|media\s+relations
                      |administrat|intern\b|staff\b)""", re.I | re.X)

NAME_TITLE = re.compile(r"""\b(head\s+coach|assistant\s+coach|associate\s+head\s+coach
                          |goalkeeper\s+coach|volunteer\s+coach|athletic\s+trainer
                          |strength\s*&?\s*conditioning|director|coordinator|supervisor
                          |operations|graduate\s+assistant|student\s+manager)\b
                       |,\s*(ph\.?d|m\.?d|ed\.?d|atc|lat|m\.?s|msat|m\.?ed|mba|rd|cscs)
                        (\s*,\s*(ph\.?d|m\.?d|ed\.?d|atc|lat|m\.?s|msat|m\.?ed|mba|rd|cscs))*\s*\.?$
                    """, re.I | re.X)

def name_is_staff(name):
    """A roster card whose *name* carries a job title or clinical credentials."""
    n = re.sub(r'\s+', ' ', (name or '')).strip()
    return bool(n) and bool(NAME_TITLE.search(n))

def is_staff(pos, home=''):
    """True when a roster card is a coach or support-staff entry.

    Roster pages routinely render the staff block in the same card markup as
    the players, and a staff card carries a job title where a player card
    carries a playing position - and never carries a hometown.
    """
    p = re.sub(r'\s+', ' ', (pos or '')).strip()
    if not p: return False
    if position(p): return False          # a real playing position wins
    return bool(STAFF.search(p)) and not (home or '').strip()

POSMAP = [
 (r'\bgoal\s*keep|\bgoalie|\bkeeper|^gk|^g$|^gkp|^k$|^por\b', 'Goalkeeper'),
 (r'\bdefen|\bback\b|^def\b|^de$|^d$|^df$|^db$|^cb$|^lb$|^rb$|^fb$|^b$|^sw$|^d[/\-]', 'Defender'),
 (r'\bmid|^m$|^mf$|^mid\b|^mid|^cm$|^am$|^dm$|^lm$|^rm$|^cam$|^cdm$|^m[/\-]', 'Midfielder'),
 (r'\bforward|\bfoward|\bforwrd|\bstrik|\bwing|\battack|\battk|^fwd\b|^f$|^fw$|^st$|^w$|^lw$|^rw$|^cf$|^att|^a$|^f[/\-]', 'Forward'),
]
HTWT = re.compile(r"""(\d+\s*['’]\s*\d*\s*["”]?)      # 6'1"
                     |(\b\d\s*-\s*\d{1,2}\b)              # 5-10
                     |(\b\d{2,3}\s*(lbs?|kg)\b)             # 165 lbs
                     |(\b\d{2,3}\s*cm\b)""", re.I | re.X)

def position(p):
    s = re.sub(r'\s+', ' ', (p or '').strip())
    s = HTWT.sub(' ', s)                       # heights/weights share the cell
    s = re.sub(r'^(pos|position)\s*[:.]+\s*', '', s, flags=re.I)
    s = re.sub(r'\s+', ' ', s).strip(' -–|/,')
    if not s: return ''
    low = s.lower()
    # combined like "M/F", "Defender/Midfielder" -> first token
    first = re.split(r'\s*[/&,]\s*|\s+-\s+', low)[0].strip()
    for cand in (first, low):
        for rx, val in POSMAP:
            if re.search(rx, cand): return val
    return ''

CLSBASE = [
 (r'\b(gr|grad|graduate|grd|gs)\b|graduate student|^gr\.?$', 'GR'),
 (r'\b5th\b|fifth|\b6th\b|sixth|\b5\s*year|fifth year|sixth year', 'GR'),
 (r'\bsen(ior)?\b|^sr\b|^sr\.?$|\b4th\b|fourth', 'SR'),
 (r'\bjun(ior)?\b|^jr\b|^jr\.?$|\b3rd\b|third', 'JR'),
 (r'\bsoph|^so\b|^so\.?$|\b2nd\b|second', 'SO'),
 (r'\bfresh|^fr\b|^fr\.?$|first[\s-]*year|^fy|^f\.y|^1st|first|^rf\b', 'FR'),
]
GRAD_2024 = {'FR': '2029', 'SO': '2028', 'JR': '2027', 'SR': '2026', 'GR': '2025'}

def grad(cls):
    s = re.sub(r'\s+', ' ', (cls or '').strip())
    if not s: return ''
    # explicit class year: '27 / 2027 / Class of 2027
    m = re.search(r"(?:^|\D)'(\d{2})\b", s)
    if m: return '20' + m.group(1)
    m = re.search(r'\b(20\d{2})\b', s)
    if m: return m.group(1)
    low = s.lower().replace('redshirt', 'r-').replace('rs-', 'r-').replace('rs ', 'r-')
    # A redshirt SENIOR is in their final year, so they graduate with the
    # graduates (+1), not with the seniors (+2). This has to be caught before
    # the redshirt prefix is stripped below, which would otherwise turn
    # "R-Sr." into a plain senior. Under 5-year eligibility the offsets are
    # Fr +5, So +4, Jr +3, Sr +2, Gr/5th/R-Sr +1, which is what the
    # recruiting-class year on a registered player is compared against.
    if re.match(r'^(g-?sr|super\s*sen(ior)?|post[\s\-]?bacc\w*)\.?$', low.strip()):
        return GRAD_2024['GR']
    # A redshirt has spent one of the five years, so they sit with the class
    # above: R-Fr. with So., R-So. with Jr., R-Jr. with Sr., R-Sr. with Gr.
    # Under five-year eligibility the count is years TOTAL, so whether one of
    # them was a redshirt makes no difference to when the spot opens.
    # server/lib/classYear.js is authoritative and the CSVs are synced from the
    # database after import; this is kept in step so a standalone acquisition
    # writes the same value rather than one the sync silently corrects.
    was_redshirt = bool(re.match(r'^r[\.\-]?(?=\s|fr|so|jr|sr|f\b|$)', low.strip()))
    low = re.sub(r'^r[\.\-]?', '', low).strip()
    if was_redshirt:
        ADVANCE = {'FR': 'SO', 'SO': 'JR', 'JR': 'SR', 'SR': 'GR', 'GR': 'GR'}
        for rx, base in CLSBASE:
            if re.search(rx, low): return GRAD_2024[ADVANCE[base]]
    low = re.sub(r'^(cl|yr|class|year)[\s:.]+', '', low).strip()
    low = re.split(r'\s*[/]\s*', low)[0].strip()
    low = re.sub(r'\s*\(\d+(st|nd|rd|th)\)\s*', '', low).strip()
    low = re.sub(r'[-–]\s*(tr|r|\d+l|\d+)$', '', low).strip()
    for rx, base in CLSBASE:
        if re.search(rx, low): return GRAD_2024[base]
    return ''

def grad_for_season(cls, season):
    """Graduation year for a class label in a given season.

    grad() is anchored on the 2024 season; a later season shifts the offset by
    the same number of years. An explicit class-year label ('27, 2027) already
    names the year, so it is never shifted.
    """
    s = (cls or '').strip()
    if not s: return ''
    if re.search(r"(?:^|\D)'\d{2}\b", s) or re.search(r'\b20\d{2}\b', s):
        return grad(s)
    g = grad(s)
    if not g: return ''
    return str(int(g) + (int(season) - 2024))

BADCLS = re.compile(r'\b(fc|sc|academy|united|club|elite|rush|surf|thorns|revolution|impact|crossfire|'
                    r'sting|solar|blast|fire|energy|dallas|alliance|premier|youth|national team|ecnl|da|'
                    r'real|dksc|sporting|athletic|galaxy|strikers|dynamo|celtic|inter)\b'
                    r'|[a-z]{2,}sc$|[a-z]{2,}fc$', re.I)
def clean_cls(s):
    s = re.sub(r'\s+', ' ', (s or '').strip()).strip(' -–|')
    if not s: return ''
    # a club or squad name in the class column is the Texas-Tech-style bug
    if BADCLS.search(s) and not re.search(r'^(fr|so|jr|sr|gr|fy)\b', s, re.I): return ''
    # length alone is not disqualifying: 'Class: Graduate Student' is a real label,
    # so only drop long values that do not resolve to a class at all
    if len(s) > 22 and not grad(s): return ''
    return s

def clean_name(s):
    s = re.sub(r'\s+', ' ', (s or '').strip())
    s = re.sub(r'^\s*#?\d+\s*(?:/\s*\d+\s*)?(?=[A-Za-z])', '', s)
    s = re.sub(r'^\s*#?\d+\s*(?:/\s*\d+)?\s+', '', s)
    # a lone C / CC / A after the jersey number is a captain marker, not an initial.
    # The remainder can be initials (RJ Alvarez), hyphenated (John-John Dickenson),
    # accented (Sören Tollis) or a bare surname (Rosario).
    m = re.match(r'^(?:C|CC|A)\s+(\S.*)$', s)
    if m and len(re.findall(r'[^\W\d_]', m.group(1), re.UNICODE)) >= 3 \
            and re.match(r'[^\Wa-z\d_]', m.group(1), re.UNICODE):
        s = m.group(1).strip()
    s = re.sub(r'\s*\(.*?\)\s*$', '', s).strip()
    if ',' in s and s.count(',') == 1 and len(s.split(',')[0].split()) <= 2:
        a, b = [x.strip() for x in s.split(',')]
        if a and b and not re.search(r'\d', s): s = f'{b} {a}'
    return s.strip()

def clean_home(s):
    s = re.sub(r'\s+', ' ', (s or '').strip())
    s = re.sub(r'^(hometown|home town)\s*[:/]\s*', '', s, flags=re.I)
    return s.strip(' -–/|')

def season_ok(title, extra='', season=None):
    """True if the page clearly belongs to the target season.

    Titles name a season several ways -- "2024", "2024-25", "24-25" -- and a
    page that names a different year is a positive rejection, not a maybe.
    """
    season = int(season or SEASON)
    nxt = season + 1
    t = (title or '') + ' ' + (extra or '')
    if re.search(rf'\b{season}\b|{season}-{nxt % 100:02d}|{season}-{nxt}|{season % 100:02d}-{nxt % 100:02d}', t):
        return True
    for other in (season - 2, season - 1, nxt, season + 2, season + 3):
        if other == season: continue
        if re.search(rf'\b{other}\b|{other}-{(other + 1) % 100:02d}', t): return False
    return None
