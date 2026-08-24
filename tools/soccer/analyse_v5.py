"""Run the existing v5 algorithm on the corrected data and measure what it actually does."""
import csv,math,collections,statistics as st
P={"weights":[40,60,75,100],  # 2021 dropped
   "win":1.0,"draw":0.4,"loss":-0.1,"ps_bonus":1.35,"curve":0.28,
   "div_mult":{"D1":1.00,"D2":0.40,"NAIA":0.32,"D3":0.18,"NJCAA":0.10},
   "prestige":{"D1":1.60,"D2":1.00,"NAIA":0.85,"D3":0.70,"NJCAA":0.50},
   "conf_tier_mult":{"d1t1":1.22,"d1t2":1.06,"d1t3":0.88,"d1t4":0.74,
                     "d2t1":1.18,"d2t2":1.00,"d3t1":1.20,"d3t2":1.00,
                     "naiat1":1.16,"naiat2":1.00,"njcaat1":1.00,"njcaat2":1.00}}
SEASONS=[2022,2023,2024,2025]
def qual(row,p):
    num=den=0.0
    for i,y in enumerate(SEASONS):
        w,l,d=row.get(f"{y}_W",""),row.get(f"{y}_L",""),row.get(f"{y}_D","")
        if w=="" or l=="": continue
        w,l=int(w),int(l); d=int(d) if d else 0
        g=w+l+d
        if not g: continue
        dm=p["div_mult"].get(row["division"],1.0)
        cm=p["conf_tier_mult"].get(row["conf_tier"],1.0)
        wt=p["weights"][i]
        rv=p["win"]*w+p["draw"]*d+p["loss"]*l
        num+=wt*dm*cm*rv; den+=wt*g
    return num/den if den>0 else 0.0
def final(row,p): return qual(row,p)*p["prestige"].get(row["division"],1.0)
def run(path,label):
    rows=[r for r in csv.DictReader(open(path))]
    raw=[(r,final(r,P)) for r in rows]
    mx=max(s for _,s in raw) or 1.0
    out=[(r,s,math.pow(max(s,0)/mx,P["curve"])*100) for r,s in raw]
    print(f"===== {label}: {len(rows)} programs")
    bydiv=collections.defaultdict(list)
    for r,s,n in out: bydiv[r["division"]].append(n)
    print(f"{'div':6}{'n':>5}{'min':>8}{'p25':>8}{'median':>8}{'p75':>8}{'max':>8}")
    for d in ["D1","D2","NAIA","D3","NJCAA"]:
        v=sorted(bydiv.get(d,[]))
        if not v: continue
        q=lambda f: v[min(len(v)-1,int(f*len(v)))]
        print(f"{d:6}{len(v):5}{v[0]:8.1f}{q(.25):8.1f}{st.median(v):8.1f}{q(.75):8.1f}{v[-1]:8.1f}")
    # overlap: how much do divisions actually interleave?
    out.sort(key=lambda x:-x[2])
    print("\ntop 15 overall:")
    for r,s,n in out[:15]: print(f"   {n:6.1f}  {r['name'][:30]:30} {r['division']:5} {r['conference'][:16]}")
    print("\nbest non-D1 program and its overall rank:")
    for i,(r,s,n) in enumerate(out,1):
        if r["division"]!="D1":
            print(f"   rank {i}: {r['name']} ({r['division']}) {n:.1f}"); break
    # how many D1 programs rank below the best D3?
    best_d3=max((n for r,s,n in out if r["division"]=="D3"),default=0)
    d1_below=sum(1 for r,s,n in out if r["division"]=="D1" and n<best_d3)
    print(f"   best D3 score {best_d3:.1f}; D1 programs scoring below it: {d1_below}")
    return out
if __name__=="__main__":
    run("/Users/rhysdavies/Documents/Thriv3/Soccer Records/soccer_records.csv","MEN")
    print()
    run("/Users/rhysdavies/Documents/Thriv3/Soccer Records/soccer_records_women.csv","WOMEN")
