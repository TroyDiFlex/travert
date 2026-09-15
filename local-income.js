import {ApiError} from './api.js';
import {validateData} from './model.js';

// Локальный адаптер доходов: тот же интерфейс, что у серверного Api,
// но данные живут в localStorage этого браузера. Пароль не нужен,
// вход выполняется сразу. Ревизии, корзина на 30 дней и формат
// резервных копий повторяют сервер (server/Storage.gs, Backups.gs),
// поэтому переход на сервер позже не потребует менять интерфейс.
export const LOCAL_INCOME_KEY='travert-income-v1';
const TRASH_RETENTION_MS=30*24*60*60*1000;
const BACKUP_SCHEMA='potok-income-backup';
const BACKUP_VERSION=1;
const MAX_SOURCES=200;
const MAX_ENTRIES=20000;

async function sha256hex(text){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
function fail(code,message){throw new ApiError(message,code);}
const validMonth=value=>typeof value==='string'&&/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value);
const validAmount=amount=>Number.isSafeInteger(amount)&&amount>=0&&amount<=999999999999;
const validSource=s=>s&&typeof s.id==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(s.id)
  &&typeof s.name==='string'&&s.name.trim().length>0&&s.name.length<=80
  &&typeof s.active==='boolean'&&typeof s.color==='string'&&/^#[0-9a-f]{6}$/i.test(s.color)
  &&Number.isInteger(s.order)&&s.order>=0&&s.order<=10000;

export class LocalIncomeApi{
  token=null;
  isLocal=true;
  constructor({storage}={}){
    this.storage=storage??globalThis.localStorage??null;
  }
  load(){
    if(!this.storage)fail('STORAGE','Локальное хранилище недоступно в этом браузере.');
    let model;
    try{
      const raw=this.storage.getItem(LOCAL_INCOME_KEY);
      model=raw?JSON.parse(raw):{sources:[],entries:[]};
    }catch{fail('STORAGE','Не удалось прочитать локальные данные доходов.');}
    if(!model||!Array.isArray(model.sources)||!Array.isArray(model.entries))fail('STORAGE','Локальные данные доходов повреждены.');
    return model;
  }
  save(model){
    try{this.storage.setItem(LOCAL_INCOME_KEY,JSON.stringify(model));}
    catch{fail('STORAGE','Не удалось сохранить: хранилище переполнено или недоступно.');}
  }
  purgeExpired(model,now=Date.now()){
    const ids=new Set(model.sources.filter(s=>s.deletedAt&&s.deletedAt+TRASH_RETENTION_MS<=now).map(s=>s.id));
    if(!ids.size)return 0;
    model.entries=model.entries.filter(e=>!ids.has(e.sourceId));
    model.sources=model.sources.filter(s=>!ids.has(s.id));
    return ids.size;
  }
  async publicData(model){
    const sources=model.sources.filter(s=>!s.deletedAt),ids=new Set(sources.map(s=>s.id));
    const trash=model.sources.filter(s=>!!s.deletedAt).map(s=>{
      const items=model.entries.filter(e=>e.sourceId===s.id);
      return {...s,expiresAt:s.deletedAt+TRASH_RETENTION_MS,entryCount:items.length,total:items.reduce((sum,e)=>sum+e.amount,0)};
    });
    return {sources,entries:model.entries.filter(e=>ids.has(e.sourceId)),trash,revision:await sha256hex(JSON.stringify([model.sources,model.entries]))};
  }
  async read(){
    const model=this.load();
    if(this.purgeExpired(model))this.save(model);
    return this.publicData(model);
  }
  async login(){
    return this.read();
  }
  async logout(){}
  async backup(){
    const model=this.load();
    const createdAt=Date.now();
    const sources=model.sources.map(s=>({...s})),entries=model.entries.map(e=>({...e}));
    return {schema:BACKUP_SCHEMA,version:BACKUP_VERSION,createdAt,reason:'download',checksum:await sha256hex(JSON.stringify([sources,entries])),data:{sources,entries}};
  }
  async createBackup(){
    fail('BACKUP_SETUP','В локальном режиме копии на Google Drive недоступны. Используйте «Скачать JSON».');
  }
  async backupMaintenance(){
    fail('BACKUP_SETUP','В локальном режиме ежедневные копии не настраиваются. Используйте «Скачать JSON».');
  }
  checkRevision(model,revision,expected){
    if(typeof revision!=='string'||revision!==expected)fail('CONFLICT','Данные изменены на другом устройстве или в таблице. Закройте форму, нажмите «Обновить» и повторите изменение. Введённые значения пока сохранены в форме.');
  }
  applySetSource(model,source){
    if(!validSource(source))fail('VALIDATION','Проверьте название и цвет источника.');
    const clean={id:source.id,name:source.name.trim(),active:source.active,color:source.color,order:source.order};
    if(model.sources.some(s=>s.id===clean.id&&s.deletedAt))fail('VALIDATION','Источник находится в корзине. Сначала восстановите его.');
    if(model.sources.some(s=>s.id!==clean.id&&s.name.trim().toLowerCase()===clean.name.toLowerCase()))fail('VALIDATION','Источник с таким названием уже существует, в том числе в корзине.');
    const index=model.sources.findIndex(s=>s.id===clean.id);
    if(index<0){if(model.sources.length>=MAX_SOURCES)fail('VALIDATION','Достигнут предел: 200 источников.');model.sources.push(clean);}
    else model.sources[index]=clean;
  }
  applySetEntries(model,entries){
    if(!Array.isArray(entries)||!entries.length||entries.length>200)fail('VALIDATION','Некорректный список сумм.');
    const seen=new Set();
    for(const e of entries){
      if(!e||!model.sources.some(s=>s.id===e.sourceId&&!s.deletedAt)||!validMonth(e.month)||!(e.amount===null||validAmount(e.amount)))fail('VALIDATION','Проверьте месяц, источник и сумму.');
      const key=e.sourceId+'|'+e.month;
      if(seen.has(key))fail('VALIDATION','Повторная запись.');
      seen.add(key);
    }
    for(const e of entries){
      model.entries=model.entries.filter(old=>!(old.sourceId===e.sourceId&&old.month===e.month));
      if(e.amount!==null)model.entries.push({sourceId:e.sourceId,month:e.month,amount:e.amount});
    }
    model.entries.sort((a,b)=>a.month.localeCompare(b.month)||a.sourceId.localeCompare(b.sourceId));
    if(model.entries.length>MAX_ENTRIES)fail('VALIDATION','Достигнут предел: 20 000 записей.');
  }
  applyTrashRestoreDelete(model,op){
    const target=model.sources.find(s=>s.id===op.sourceId);
    if(!target)fail('VALIDATION','Источник не найден. Обновите данные.');
    if(op.type==='trashSource'){
      if(target.deletedAt)fail('VALIDATION','Источник уже в корзине.');
      target.deletedAt=Date.now();
    }else{
      if(!target.deletedAt)fail('VALIDATION','Сначала переместите источник в корзину.');
      if(op.type==='restoreSource'){delete target.deletedAt;}
      else{
        model.entries=model.entries.filter(e=>e.sourceId!==target.id);
        model.sources=model.sources.filter(s=>s.id!==target.id);
      }
    }
  }
  applyImportData(model,data){
    if(!data||!Array.isArray(data.sources)||!Array.isArray(data.entries))fail('VALIDATION','Некорректный план импорта.');
    const trashed=model.sources.filter(s=>s.deletedAt),trashIds=new Set(trashed.map(s=>s.id));
    const visible=model.sources.filter(s=>!s.deletedAt),incomingIds=new Set(data.sources.map(s=>s.id));
    if(visible.some(s=>!incomingIds.has(s.id))||data.sources.some(s=>trashIds.has(s.id)||s.deletedAt))fail('VALIDATION','CSV-импорт не может удалять источники или изменять корзину.');
    model.sources=[...data.sources.map(s=>({...s})),...trashed];
    model.entries=[...data.entries.map(e=>({...e})),...model.entries.filter(e=>trashIds.has(e.sourceId))];
  }
  async applyRestoreBackup(model,backup){
    if(!backup||backup.schema!==BACKUP_SCHEMA||backup.version!==BACKUP_VERSION||!Number.isSafeInteger(backup.createdAt)||!backup.data||!Array.isArray(backup.data.sources)||!Array.isArray(backup.data.entries))fail('VALIDATION','Некорректная резервная копия.');
    const sources=backup.data.sources.map(s=>({...s})),entries=backup.data.entries.map(e=>({...e}));
    if(await sha256hex(JSON.stringify([sources,entries]))!==backup.checksum)fail('VALIDATION','Контрольная сумма резервной копии не совпадает.');
    const now=Date.now();
    model.sources=sources.map(s=>{if(s.deletedAt)s.deletedAt=now;return s;});
    model.entries=entries;
  }
  async mutate(revision,operation){
    const model=this.load();
    this.purgeExpired(model);
    const expected=await sha256hex(JSON.stringify([model.sources,model.entries]));
    this.checkRevision(model,revision,expected);
    const op=operation;
    if(!op||typeof op.type!=='string')fail('BAD_REQUEST','Неверное изменение.');
    if(op.type==='setSource')this.applySetSource(model,op.source);
    else if(op.type==='setEntries')this.applySetEntries(model,op.entries);
    else if(op.type==='importData')this.applyImportData(model,op.data);
    else if(op.type==='restoreBackup')await this.applyRestoreBackup(model,op.backup);
    else if(['trashSource','restoreSource','deleteSource'].includes(op.type))this.applyTrashRestoreDelete(model,op);
    else fail('BAD_REQUEST','Неизвестный тип изменения.');
    if(model.sources.length>MAX_SOURCES||model.entries.length>MAX_ENTRIES)fail('VALIDATION','Импорт превышает допустимый размер данных.');
    validateData({sources:model.sources.map(({deletedAt,...s})=>s),entries:model.entries});
    this.save(model);
    return this.publicData(model);
  }
}
