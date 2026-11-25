import {describe,it,expect} from 'vitest';
import {STAGES,type StudioProject,type StudioInfo} from '../../shared/studio-project';
import {studioRoster,STUDIO_ROOM} from './office-view';
import {Office} from '../model/office';
import {NameStore} from '../model/names';
import {tempDir} from '../test/fixtures';
import {join} from 'node:path';
const p:StudioProject={id:'test',brief:'Aplicativo de oficina',research:false,createdAt:'2026-10-01T00:00:00Z',state:'new',stages:[]};
const info=(project?:StudioProject):StudioInfo=>({configured:true,webResearch:false,provider:'codex-cli',projects:project?[project]:[]});
describe('managed office',()=>{
 it('shows only real working role and approval',()=>{
   expect(studioRoster(info(),1000).every(a=>a.status==='idle')).toBe(true);
   expect(studioRoster(info({...p,state:'running'}),1000).filter(a=>a.status==='working').map(a=>a.managed?.role)).toEqual(['scout']);
   expect(studioRoster(info({...p,state:'approval'}),1000).find(a=>a.managed?.role==='scout')?.status).toBe('waiting');
 });
 it('shows actual delivery progress, not fake tests',()=>{
   const project:StudioProject={...p,state:'complete',stages:STAGES.map(s=>({role:s[0],text:'plan',sources:[],at:p.createdAt})),delivery:{state:'running',workspace:'/test',steps:[{role:'dev',report:'report',at:p.createdAt}]}};
   expect(studioRoster(info(project),1000).filter(a=>a.status==='working').map(a=>a.managed?.role)).toEqual(['qa']);
   project.delivery!.state='failed';
   expect(studioRoster(info(project),1000).filter(a=>a.status==='working')).toHaveLength(0);
 });
 it('publishes eight characters and deduplicates transitions',()=>{
   const tmp=tempDir();try{
   const office=new Office({names:new NameStore(join(tmp.dir,'names.json')),version:'test',startedAt:1000,accounts:()=>[],sources:()=>[],accountName:()=>undefined,now:()=>1000});
   office.syncStudio(info());expect(office.commit().snapshot.agents).toHaveLength(8);
   expect(office.list()).toHaveLength(0);
   office.syncStudio(info({...p,state:'running'}));const result=office.commit();
   expect(result.snapshot.rooms.find(r=>r.id===STUDIO_ROOM)?.managed).toBe(true);
   expect(result.snapshot.agents.filter(a=>a.status==='working')).toHaveLength(1);
   expect(result.feed.filter(f=>f.activity.kind==='plan')).toHaveLength(1);
   office.syncStudio(info({...p,state:'running'}));expect(office.commit().changed).toBe(false);
   }finally{tmp.cleanup();}
 });
});
