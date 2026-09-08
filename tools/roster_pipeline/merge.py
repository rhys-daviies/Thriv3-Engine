import sys,os,json,glob
sys.path.insert(0,'.')
import state
main=state.load()
order=['state_discovered.json','state_browser.json','state_selector.json','state_wayback2.json','state_browser2.json','state_variants.json','state_wayback2.json','state_browser3.json','state_final.json']
added=0
for f in order:
    if not os.path.exists(f): continue
    d=json.load(open(f,encoding='utf-8'))
    for k,v in d.items():
        if v.get('status')=='done' and main.get(k,{}).get('status')!='done':
            main[k]=v; added+=1
        elif v.get('status')!='done' and main.get(k,{}).get('status')!='done':
            prev=main.get(k,{}); t=prev.get('tried',[])+v.get('tried',[])
            main[k]={**v,'tried':t}
state.save(main)
done=sum(1 for v in main.values() if v.get('status')=='done')
print('merged +%d done. total done=%d / %d  (%.1f%%)'%(added,done,len(main),100*done/max(len(main),1)))
open('remaining.txt','w').write('\n'.join(sorted(k for k,v in main.items() if v.get('status')!='done')))
print('remaining:',sum(1 for v in main.values() if v.get('status')!='done'))
