import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const fixtures=vi.hoisted(()=>({invoke:vi.fn(),getConfig:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:fixtures.invoke}));
vi.mock('../services/workstationHealth',async original=>{const actual=await original<typeof import('../services/workstationHealth')>();const snapshot={...actual.emptyHealth,checkedAt:'2026-11-12T10:00:00Z',reporting:{configured:true,pending:0,error:null}};return {...actual,getCachedHealth:()=>snapshot,loadHealth:vi.fn().mockResolvedValue(snapshot),loadNews:vi.fn().mockResolvedValue({items:[],lastSuccessAt:null,lastCheckedAt:null,error:null})};});
vi.mock('../services/ki',()=>({getKiConfig:fixtures.getConfig,listMyKiAcknowledgements:vi.fn().mockResolvedValue([]),getKiPdf:vi.fn()}));
vi.mock('../services/db',()=>({getOutlookProfileCatalog:vi.fn()}));
vi.mock('./UpdateNotifier',()=>({updateAvailableEvent:'dmh:update-available'}));
vi.mock('./M365Loading',()=>({M365Loading:()=>null}));
vi.mock('./KiMyReceipts',()=>({KiMyReceipts:()=> <div>Nachweise</div>}));
import {WorkstationPanel} from './WorkstationPanel';
beforeEach(()=>{fixtures.invoke.mockReset();fixtures.getConfig.mockReset();Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(){this.setAttribute('open','');}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(){this.removeAttribute('open');}});});
it('leaving a pending documents request does not leave the overview controls disabled',async()=>{
 let resolve!:(v:unknown)=>void;fixtures.getConfig.mockReturnValue(new Promise(r=>{resolve=r;}));render(<WorkstationPanel onNavigate={()=>{}} kiEnabled/>);await waitFor(()=>expect(screen.getByRole('button',{name:'Aktualisieren'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Meine Dokumente'}));expect(await screen.findByText('Wird geprüft …')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Übersicht'}));expect(screen.getByRole('button',{name:'Aktualisieren'})).toBeEnabled();await act(async()=>resolve({title:'KI',revision:'one'}));
});
it('a failed diagnostic save remains visible inside the dialog and never claims it was queued',async()=>{
 fixtures.invoke.mockRejectedValue(new Error('disk unavailable'));render(<WorkstationPanel onNavigate={()=>{}} kiEnabled={false}/>);await waitFor(()=>expect(screen.getByRole('button',{name:'Diagnose senden'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Diagnose senden'}));fireEvent.click(screen.getByRole('button',{name:'An EDV senden'}));const error=await screen.findByText('Diagnose konnte nicht gespeichert werden. Bitte erneut versuchen.');expect(screen.getByRole('dialog')).toContainElement(error);expect(screen.queryByText(/Diagnose lokal gespeichert/)).toBeNull();
});
