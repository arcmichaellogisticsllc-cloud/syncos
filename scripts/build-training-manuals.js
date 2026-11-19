const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const definitions=[['identity-delivery','Sign-in and prime delivery','identity-and-prime-delivery.md'],['operations','Demand, operations and quality','demand-operations-and-quality.md'],['field','Sync crews and partner crews','field-and-partner.md'],['finance','Finance and payment controls','finance-and-controls.md']];
const manuals=definitions.map(([id,title,file])=>({id,title,file,content:fs.readFileSync(path.join(root,'docs/training',file),'utf8')}));
fs.writeFileSync(path.join(root,'apps/web/app/training/manuals.json'),JSON.stringify(manuals,null,2)+'\n');
console.log(`Generated ${manuals.length} training manuals from reviewed sources.`);
