const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { createRequire } = require('node:module');
const path = require('node:path');
const webRequire = createRequire(path.resolve('apps/web/package.json'));
function proxy(fetch) {
 const source = fs.readFileSync('apps/web/app/api/syncos/[...path]/route.ts','utf8');
 const exports = {};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:webRequire,process:{env:{SYNCOS_API_BASE_URL:'http://localhost:3457'}},fetch,URL,Headers});
 return exports;
}
test('proxy preserves multipart file bytes and downloaded PDF bytes',async()=>{
 const body = Buffer.concat([Buffer.from('--boundary\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n'),Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0xff,0,0xfe]),Buffer.alloc(200*1024,0x89)]),Buffer.from('\r\n--boundary--\r\n')]);
 const pdf=Buffer.from([0x25,0x50,0x44,0x46,0xff,0x00,0xfe]);let captured;
 const handler=proxy(async(url,options)=>{captured={url,options};return new Response(pdf,{headers:{'content-type':'application/pdf','content-disposition':'attachment; filename="proof.pdf"'}});});
 const req=new Request('http://localhost/api/syncos/upload?kind=proof',{method:'POST',headers:{authorization:'Bearer test','content-type':'multipart/form-data; boundary=boundary'},body});req.nextUrl=new URL(req.url);
 const response=await handler.POST(req,{params:Promise.resolve({path:['upload']})});
 assert.deepEqual(Buffer.from(captured.options.body),body);assert.equal(captured.options.headers.get('content-type'),'multipart/form-data; boundary=boundary');assert.equal(captured.options.headers.get('authorization'),'Bearer test');assert.equal(captured.url.searchParams.get('kind'),'proof');
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),pdf);assert.equal(response.headers.get('content-disposition'),'attachment; filename="proof.pdf"');
});
test('proxy supports empty successful responses',async()=>{
 const handler=proxy(async()=>new Response(null,{status:204}));const req=new Request('http://localhost/api/syncos/action',{method:'POST',body:'{}'});req.nextUrl=new URL(req.url);
 const response=await handler.POST(req,{params:Promise.resolve({path:['action']})});assert.equal(response.status,204);assert.equal(await response.text(),'');
});
