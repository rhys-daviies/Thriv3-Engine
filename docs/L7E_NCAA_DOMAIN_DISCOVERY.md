# L7E — bounded NCAA athletics host discovery

Thirteen active NCAA programmes had no trusted athletics host, so the candidate
generator L7B built had nothing to run on. This stage found and verified hosts
for **ten of them**, wrote nine ledger rows and one role correction, and left
the other three alone with a reason.

**Eight are now ready for acquisition.** No roster was acquired, no sheet
written, no roster row imported. P6 unchanged.

---

## 1. The thirteen

Reproduced from the current 18-gap cohort by running the L7B planner and taking
`NO_TRUSTED_HOST`. They span **eleven institutions** — Anna Maria and New Jersey
City each appear twice, as the men's and women's rows of one institution under
different name spellings, which is why a single verified host unblocks two
programmes.

| division | | programme | unitid | city | conference |
|---|---|---|---|---|---|
| D2 | M | Southwest Minnesota State | 175078 | Marshall, MN | NSIC |
| D2 | W | Tuskegee | 102377 | Tuskegee, AL | Independent |
| D2 | W | Wayne State (MI) | 172644 | Detroit, MI | GLIAC |
| D3 | M | Anna Maria | 164492 | Paxton, MA | MASCAC |
| D3 | W | Anna Maria College | 164492 | Paxton, MA | MASCAC |
| D3 | M | New Jersey City | 185129 | Jersey City, NJ | NJAC |
| D3 | W | New Jersey City University | 185129 | Jersey City, NJ | NJAC |
| D3 | W | Eureka College | 144971 | Eureka, IL | SLIAC |
| D3 | W | Lasell | 166391 | Newton, MA | — |
| D3 | W | Mitchell | 129774 | New London, CT | — |
| D3 | W | Saint Mary's College (IN) | 152390 | Notre Dame, IN | MIAA |
| D3 | W | Trinity Washington University | 131876 | Washington, DC | Independent |
| D3 | W | Wesleyan (GA) | 141325 | Macon, GA | CCS |

None had a `website_domain` on its registry row.

## 2. Why the authority refused each

Not all thirteen were simply missing.

| | n | |
|---|---:|---|
| `INSUFFICIENT_IDENTITY` | **6** | a ledger row existed but the crawler could not establish whose the host was — SMSU, Anna Maria ×2, Eureka, Lasell, Mitchell |
| `NO_LEDGER_ROW` | **5** | Tuskegee, Wayne State (MI), NJCU (women's), Trinity Washington, Wesleyan (GA) |
| `CONFLICTED` | **2** | New Jersey City (men's), Saint Mary's College (IN) |
| `BASE_ONLY_ONLY` · `OTHER` | 0 | |

Several already had the right host sitting in the table unadmitted:
`smsumustangs.com`, `goamcats.com`, `eurekareddevils.com`,
`www.mitchellathletics.com`, all `INSUFFICIENT_EVIDENCE`. Lasell's
`laserpride.lasell.edu` was already **verified** for its institution and
excluded only by `role='INSTITUTION_SITE'`.

## 3. Identity inputs

**Proof:** `unitid`; an official institution page that links to the host; the
host's own `og:site_name`; the registry's `city`/`state`; an existing ledger row
already verified for that unitid.

**Candidate generation only:** the school's name, a guessed institution domain,
anything a search returns. A name may say *where to look*. It never says *whose
it is* — L7 measured seven of eight `BASE_ONLY` rows wrong, including
`uconnhuskies.com` filed under Connecticut College.

## 4. Method

Method A carried nine of the ten: **the institution's own official site, linking
to its athletics property.** Five of those institutions already had a ledger row
VERIFYING their `.edu` for that unitid, which makes the link a chain from an
established identity rather than from a name.

Method A on an unverified institution domain carried the rest: a candidate `.edu`
generated from the name, then accepted only because the page **self-identified**
as the institution and named the registry's city.

Every host was then fetched on its own and had to self-identify. No conference
directory was needed; no search result was used as proof; nothing came from an
aggregator, a fan page or social media.

## 5. What was found

| programme | host | institution anchor | host says | place |
|---|---|---|---|---|
| SMSU | `smsumustangs.com` | smsu.edu (VERIFIED) links "ATHLETICS" | "SMSU Athletics" | Marshall ✓ |
| Anna Maria ×2 | `goamcats.com` | annamaria.edu (VERIFIED) links "Athletics" | → `annamaria.prestosports.com` | — |
| Eureka | `eurekareddevils.com` | eureka.edu (VERIFIED) links "Athletics" | "Eureka College" | Eureka ✓ |
| Lasell | `laserpride.lasell.edu` | lasell.edu links "Official site of Lasell Athletics" | "Lasell University" | Newton ✓ |
| Mitchell | `mitchellathletics.com` | mitchell.edu/athletics links "Athletics Website" | "Mitchell College" | New London ✓ |
| Tuskegee | `goldentigersports.com` | tuskegee.edu links "Athletics" | "Tuskegee University Athletics" | Tuskegee ✓ |
| Wayne State (MI) | `wsuathletics.com` | wayne.edu links "Athletics" | "Wayne State University Athletics" | **Detroit ✓** |
| Wesleyan (GA) | `wesleyanathletics.com` | wesleyancollege.edu links "Athletics" | "Wesleyan College" | **Macon ✓** |
| Saint Mary's (IN) | `belles.saintmarys.edu` | saintmarys.edu/athletics redirects to it | "Saint Mary's College" | **Notre Dame, IN ✓** |

**The SMSU case is the one Phase 7 named in advance.** "SMSU Athletics" is an
abbreviation and L7 refused it on that basis. It is admitted here not because
the standard was lowered but because a second anchor arrived: Southwest
Minnesota State's own official page links directly to the host.

**Where the name is shared, the place decides.** Wayne State exists in Michigan
and in Nebraska; Wesleyan several times over; Saint Mary's in Indiana and in
Minnesota. L7 had already refused `saintmaryssports.com` for Saint Mary's (IN)
because that host belongs to Saint Mary's University of Minnesota — and this
stage found the separate, correct one rather than reversing that refusal.

### The three that were not found

**New Jersey City University — `PROGRAMME_STATUS_QUESTION`, ×2.** Not a
discovery failure. `njcu.edu` now redirects to `www.kean.edu/jersey-city` and
self-identifies as "Kean Jersey City | Kean University"; `njcugothicknights.com`
redirects to `keanathletics.com`. Kean has absorbed NJCU, and the ledger had
recorded exactly that. Whether NJCU still fields NCAA soccer under its own
identity is a registry question, not a domain one, and no host was invented.

**Trinity Washington University — `HUMAN_REVIEW_REQUIRED`.** `trinitydc.edu`
returns 403 to every route tried. Nothing about its athletics property could be
established, and a guess is not a verification.

| classification | n |
|---|---:|
| `VERIFIED_HOST` | **10** |
| `PROGRAMME_STATUS_QUESTION` | 2 |
| `HUMAN_REVIEW_REQUIRED` | 1 |
| `NO_OFFICIAL_HOST_FOUND` · `IDENTITY_CONFLICT` · `OTHER` | 0 |

## 6. Ledger rows

**Schema sufficient: YES, with no change.** L7 noted the table carried one
batch-level `checked_at` and that partial refresh was unproven. The column is
per-row and `NOT NULL`; it had simply never been written that way. Nine rows now
carry their own real verification time, and the count of distinct `checked_at`
values is no longer 1.

The row shape is not new either. Three rows already used
`OFFICIAL_DIRECTORY_AND_PAGE_SELF_IDENTIFICATION`, and they set the precedent
followed exactly — including for an abbreviated site name: `bsubears.com` reads
"Bridgewater St." and is still `WHOLE_NAME`, because `identity_strength` records
that an identity is *whole* rather than a short-base-name coincidence, and the
coincidence is what `BASE_ONLY` means.

```
status VERIFIED · role ATHLETICS_SITE · confidence CORROBORATED
identity_method EXACT · identity_strength WHOLE_NAME
evidence_kind CURATED_CORRECTION
verification_method OFFICIAL_DIRECTORY_AND_PAGE_SELF_IDENTIFICATION
notes  <both anchors, in prose>
```

**Written: 9** — 4 updates (`smsumustangs.com`, `goamcats.com`,
`eurekareddevils.com`, `regisrangers.com`), 4 inserts (`mitchellathletics.com`,
`goldentigersports.com`, `wsuathletics.com`, `wesleyanathletics.com`,
`belles.saintmarys.edu` — five), plus **1 role correction**
(`laserpride.lasell.edu`, INSTITUTION_SITE → ATHLETICS_SITE; its identity was
never in question, the label was wrong).

Nothing was written for the human-review, status-question or conflicted cases.
The backfill is NCAA-only, and a test asserts that.

`server/data/seeds/athletics_domains_verified.json` holds the evidence in prose
beside each row; `server/scripts/verifiedDomainBackfill.js` applies it
idempotently and refuses a "role correction" that would move a host to a
different institution.

### Regis (CO)

L7B left this open: seven `BASE_ONLY` rows wrong, one — `regisrangers.com` —
correct, and excluding the class would have cost that one row a real operator
link. **It was repaired up to the same standard rather than by loosening the
rule.** `regis.edu` self-identifies as "Regis University | Jesuit Catholic
University in Denver, Colorado" — Denver, CO as the registry has it, which
separates it from Regis College in Massachusetts — and links "Athletics" to the
host, whose own `og:site_name` reads "Regis University Athletics".

**The trusted `BASE_ONLY` set is now exactly the seven known-wrong rows.**
Excluding the class from the strict profile would now cost nothing, which is the
decision L7B deferred and which is now cheap to take. It was not taken here.

## 7. After the backfill

**10 of 13 gained a trusted host, under STRICT and DISCOVERY alike** — the rows
are strong enough for production source verification, not only for discovery.

Every one of the ten produced candidates, none ambiguous. Bounded verification,
one request per candidate until a programme answered:

| verdict | n | |
|---|---:|---|
| `200_ROSTER` | **8** | SMSU, Tuskegee, Wayne State (MI), Eureka, Lasell, Mitchell, Saint Mary's (IN), Wesleyan (GA) |
| `403` | 2 | Anna Maria ×2 — `goamcats.com` redirects to a site-in-maintenance page |
| redirect · client-rendered · soft-404 · 404 · other | 0 | |

Every resolved page's `og:site_name` named the right institution.

SMSU is worth a note: it first reported 404 after eight candidates, and that was
the verifier's own bound, not the site's answer. Its host is PRESTO-flagged so
the PRESTO shapes are tried first, and the URL that works —
`smsumustangs.com/sports/msoc/roster/season/2026` — is tenth in the ladder. Run
to the full ladder it returns `200_ROSTER`.

| | n |
|---|---:|
| `READY_FOR_ACQUISITION` | **8** |
| `TRUSTED_HOST_NO_VALID_SOURCE` | 2 — Anna Maria ×2 |
| `PROGRAMME_STATUS_QUESTION` | 2 — NJCU ×2 |
| `HUMAN_REVIEW_REQUIRED` | 1 — Trinity Washington |
| `CLIENT_RENDER_REQUIRED` · `NO_OFFICIAL_HOST_FOUND` · `IDENTITY_CONFLICT` | 0 |

## 8. Functional coverage

The metric that matters is not the ledger percentage but whether the programmes
that *need* acquisition have a verified identity.

**This cohort: 0/13 → 10/13.**

Broader: trusted athletics hosts 942 → 951 rows; active NCAA programmes with a
trusted host 1,391 → 1,403 of 1,761.

## 9. Baselines

Predicted: manifest moves, and no behavioural surface does, since all ten
institutions are gaps with no roster to link.

**The prediction was wrong on one surface, and the reason is a good one.**

| surface | result |
|---|---|
| OUTBOUND_DECISION · COACH_COMPOSITION · EMAIL_BODY · OPERATOR_WIRE · LOG_PAYLOAD | value **unchanged** |
| `OPERATOR_EVIDENCE` | `30c2f087e44f5a7b` → `e64f79df7ae4fc12` |

Measured against a WAL-consistent pre-stage snapshot: **4 pairs, 2 programmes —
`Eureka|mens-soccer` and `Southwest Minnesota State|womens-soccer`.** The single
difference in each is `sourceUrl: null` → a real roster URL.

Those are the **siblings** of the cohort. Eureka's women's programme was the
gap; its men's programme already had a roster fetched from
`www.eurekareddevils.com` but the host was not trusted, so the operator was shown
no link. Verifying the host for the institution gave the link to the programme
that already had the data. That is the intended effect of verification reaching
one programme through another, and it is provenance rather than semantics — no
claim, kind, sentence or email changed anywhere.

Corpus unchanged at 1,758 personalised / 2,984 generic, 2,845 rendered
sentences, 221 held. Manifest `a54be838875e8fef` → `860c7b439677ac86`
(**UNCOMPARABLE**, `athletics_domains` 2,717 → 2,722). **P6 unchanged.**

## 10. Debt

**`verified: true` remains a caller-supplied boolean.** L7E introduced no new
caller — it used the existing planner — so the assertion is still contained to
`candidatesForLookup`, which derives it from an authority lookup rather than
from a caller's opinion. Recorded, not refactored.

**`BASE_ONLY` in the strict profile.** Now costs nothing to exclude. The
decision is available and was deliberately not taken inside a discovery stage.

**Still open:** 2 client-render failures (Northwood, Wisconsin-Oshkosh), 2
source-not-available (Bryn Athyn ×2), 1 manual review (Wisconsin-La Crosse), the
USCAA state-vs-sheet value question, 2026 roster sheets not being repository seed
data.

## 11. Next acquisition cohort

**Eight programmes**, all with a verified host and a candidate that returned a
roster page:

```
Southwest Minnesota State||mens-soccer      Tuskegee||womens-soccer
Wayne State (MI)||womens-soccer             Eureka College||womens-soccer
Lasell||womens-soccer                       Mitchell||womens-soccer
Saint Mary's College (IN)||womens-soccer    Wesleyan (GA)||womens-soccer
```

Anna Maria's two join them if its site comes out of maintenance.
