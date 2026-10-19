import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url));
const check=(ok,message)=>{if(!ok)throw Error(message);};
const text=v=>typeof v==='string'&&v.trim().length>0&&v.length<=100;
const qty=v=>Number.isSafeInteger(v)&&v>=0&&v<=1000000;
export function validate(s){
 check(s?.version===1&&Array.isArray(s.products)&&Array.isArray(s.orders),'백업 형식이 올바르지 않습니다.');
 check(s.products.length<=1000&&s.orders.length<=10000,'데이터 한도를 초과했습니다.');
 const ids=new Set();for(const p of s.products){check(text(p.sku)&&text(p.name)&&qty(p.stock)&&!ids.has(p.sku),'상품 데이터가 올바르지 않습니다.');ids.add(p.sku);}
 const orders=new Set(),reserved={};for(const o of s.orders){check(text(o.id)&&!orders.has(o.id)&&text(o.customer)&&['reserved','shipped','cancelled'].includes(o.status)&&Array.isArray(o.lines)&&o.lines.length>0&&o.lines.length<=100,'주문 데이터가 올바르지 않습니다.');orders.add(o.id);const seen=new Set();for(const l of o.lines){check(ids.has(l.sku)&&!seen.has(l.sku)&&qty(l.qty)&&l.qty>0,'주문 품목이 올바르지 않습니다.');seen.add(l.sku);if(o.status==='reserved')reserved[l.sku]=(reserved[l.sku]||0)+l.qty;}}
 for(const p of s.products)check((reserved[p.sku]||0)<=p.stock,'예약 수량이 재고보다 많습니다.');return s;
}
export function createApp({databasePath=join(root,'data/dispatch.sqlite')}={}){
 if(databasePath!==':memory:')mkdirSync(dirname(databasePath),{recursive:true});
 const db=new DatabaseSync(databasePath);db.exec('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS recovery (id INTEGER PRIMARY KEY, json TEXT NOT NULL)');
 db.prepare('INSERT OR IGNORE INTO state VALUES(1,?)').run(JSON.stringify({version:1,products:[],orders:[]}));
 const load=()=>JSON.parse(db.prepare('SELECT json FROM state WHERE id=1').get().json);
 const server=createServer(async(req,res)=>{
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try{
 const host=req.headers.host;if(!/^127\.0\.0\.1:\d+$/.test(host||'')){send(403,{error:'허용되지 않은 호스트'});return;}
 const path=new URL(req.url,'http://'+host).pathname;
 if(req.method==='GET'&&path==='/api/health'){send(200,{ok:true});return;}
 if(req.method==='GET'&&(path==='/api/state'||path==='/api/export')){if(path==='/api/export')res.setHeader('Content-Disposition','attachment; filename="dispatch-backup.json"');send(200,load());return;}
 if(req.method==='POST'&&path.startsWith('/api/')){
 if(req.headers.origin&&req.headers.origin!=='http://'+host){send(403,{error:'외부 출처의 변경 요청은 허용하지 않습니다.'});return;}
 check(req.headers['content-type']?.startsWith('application/json'),'JSON 요청이 필요합니다.');
 let raw='';for await(const chunk of req){raw+=chunk;check(Buffer.byteLength(raw)<=2000000,'요청이 너무 큽니다.');}const b=JSON.parse(raw);const s=load();
 if(path==='/api/product'){check(text(b.sku)&&text(b.name)&&qty(b.stock),'SKU, 이름과 0 이상의 정수 수량을 입력하세요.');check(!s.products.some(p=>p.sku===b.sku.trim()),'이미 등록된 SKU입니다.');s.products.push({sku:b.sku.trim(),name:b.name.trim(),stock:b.stock});}
 else if(path==='/api/restock'){const p=s.products.find(p=>p.sku===b.sku);check(p&&qty(b.qty)&&b.qty>0,'입고 수량을 확인하세요.');p.stock+=b.qty;}
 else if(path==='/api/order'){check(text(b.customer),'고객명을 입력하세요.');s.orders.unshift({id:randomUUID(),customer:b.customer.trim(),status:'reserved',lines:b.lines});}
 else if(path==='/api/transition'){const o=s.orders.find(o=>o.id===b.id);check(o&&o.status==='reserved'&&['shipped','cancelled'].includes(b.status),'이미 처리되었거나 잘못된 주문입니다.');if(b.status==='shipped')for(const l of o.lines)s.products.find(p=>p.sku===l.sku).stock-=l.qty;o.status=b.status;}
 else if(path==='/api/restore'){validate(b);db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO recovery(json) VALUES(?)').run(JSON.stringify(s));db.prepare('UPDATE state SET json=? WHERE id=1').run(JSON.stringify(b));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}send(200,b);return;}
 else {send(404,{error:'없는 API입니다.'});return;}
 validate(s);db.prepare('UPDATE state SET json=? WHERE id=1').run(JSON.stringify(s));send(200,s);return;
 }
 const files={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css'};if(req.method!=='GET'||!files[path]){send(404,{error:'찾을 수 없습니다.'});return;}
 res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});res.end(readFileSync(join(root,files[path])));
 }catch(e){send(400,{error:e.message});}
 });
 return {server,close:()=>new Promise(r=>server.close(()=>{db.close();r();}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const app=createApp();app.server.listen(Number(process.env.PORT||4280),'127.0.0.1',()=>console.log('출고 데스크 http://127.0.0.1:'+(process.env.PORT||4280)));}
