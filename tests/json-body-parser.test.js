const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
test('bounded upload parsers retain an explicit ordinary JSON fallback',()=>{
 const source=fs.readFileSync('apps/api/src/main.ts','utf8');
 const fallback=source.indexOf('app.use(json({ limit: "100kb" }))');
 assert.ok(fallback>source.indexOf('"14mb"'));
 assert.ok(fallback>source.indexOf('"3mb"'));
 assert.ok(fallback<source.indexOf('app.listen'));
});
