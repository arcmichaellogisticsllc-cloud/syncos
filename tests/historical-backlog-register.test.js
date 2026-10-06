const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('historical register retains all IDs, including narrative-only later additions',()=>{
 const register=JSON.parse(fs.readFileSync('docs/product/historical-backlog-register.json','utf8')),ids=register.items.map(i=>i.id);assert.equal(new Set(ids).size,ids.length);
 for(const source of new Set(register.items.map(i=>i.source))){const text=fs.readFileSync(source,'utf8');for(const [id]of text.matchAll(/\b(?:OUX|OWB|STG|GAP-AS|E2E-[A-Z]+)-\d{3}\b/g))assert.ok(ids.includes(id),`${source}: missing ${id}`);}
 assert.equal(register.pilotHold,true);for(const i of register.items){assert.ok(i.status);assert.ok(i.evidence.length);for(const file of i.evidence)assert.ok(fs.existsSync(file),`${i.id}: ${file}`);}
});
