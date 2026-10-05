#!/usr/bin/env node
// Read-only inventory. Classifications are review annotations, not proof of access.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const directory='apps/api/src/routes';
const directoryMethods=new Set(['listAccounts','listTransactions','listMatches','listInvoices','listCollectionCases','listCollectionActions','listCashReceipts','listPaymentApplications','listArRecords','listPayables','listPayrollRuns','listBatches','listQcReviewQueue','listQcReviewsEnriched','listBillableItemsEnriched','listProductionRecordsEnriched','listWorkOrdersEnriched','listProjectsEnriched','listTasks']);
const samples=new Set(['blockersForSnapshot','billableProduction','openConstraints']);
const batches=new Set(['billablesForBody','sourcesForSettlement','createCustomerCoilBillables']);
const results=[];
for(const file of fs.readdirSync(directory).filter(f=>f.endsWith('.ts'))){
 const full=path.join(directory,file),text=fs.readFileSync(full,'utf8'),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 function visit(node,method='module'){
  if(ts.isMethodDeclaration(node)||ts.isFunctionDeclaration(node))method=node.name?.getText(source)||method;
  if(ts.isCallExpression(node)){
   const call=node.expression.getText(source),args=node.arguments.filter(a=>ts.isStringLiteral(a)||ts.isNoSubstitutionTemplateLiteral(a)||ts.isTemplateExpression(a)).map(a=>a.getText(source)),sql=args.find(a=>/\bSELECT\b/.test(a)&&/\bLIMIT\s+(?:[2-9]\d*|1\d+|\$)/.test(a));
   if(sql){let classification='review';
    if(call==='activityPage')classification='cursor page; supported final SQL bound is replaced by authorized keyset query';
    else if(['workspaceHistory','workspaceChoices'].includes(method)||file==='activity-pagination.ts'||file==='record-history.controller.ts')classification='cursor page / searchable directory';
    else if(directoryMethods.has(method)||file==='project-handoffs.controller.ts'&&method==='list')classification='recent workspace view; complete records via Record history and existing detail actions';
    else if(samples.has(method)||['opportunity-capacity-matching.controller.ts','partner-performance-capacity.controller.ts'].includes(file))classification='intentional dashboard or ranked-match preview';
    else if(batches.has(method)||/INSERT INTO workflow_notifications|INSERT INTO inquiry_follow_up_notifications/.test(sql))classification='bounded processing batch; not a complete history response';
    else if(/work-safety|internal-workforce|customer-inquiries|material-inventory/.test(file)&&/SELECT id,/.test(sql))classification='initial selector options; searchable choices endpoint reaches remaining records';
    else if(file==='workflow-notifications.controller.ts')classification='recipient-scoped cursor page';
    else if(['companyFieldOverview','fieldForms','fieldMaterials','discrepancies'].includes(method))classification='scoped cursor page with one extra row for next-page detection';
    else if(file==='record-work-authorization.ts')classification='at-most-two ambiguity check; rejects ambiguous authorization';
    else if(file==='search.controller.ts'||method==='listEnrichedSignals')classification='search preview or existing parameterized directory pagination; complete records via directory/history';
    else if(file==='dashboards.controller.ts'||file==='partner-dashboard.controller.ts'||file==='executive-command.controller.ts')classification='intentional dashboard preview; operational records use their authorized workspace/history';
    else if(/Summary$|^related|^getSignalDetail$|^getAccountDetail$|^financeRelevance$|^workflowTasks$|^sourceCommitmentWarnings$|^duplicateWarning$/.test(method)||method==='organizationTimeline')classification='intentional contextual preview; full underlying records/activity retain separate authorization';
    else if(file==='syncfield.controller.ts'&&method==='acceptedProductionRows')classification='explicit export size guard; rejects oversize rather than truncating';
    results.push({file:full,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,method,classification,bounds:[...sql.matchAll(/\bLIMIT\s+(\d+|\$\w+)/g)].map(m=>m[1])});
   }
  }
  ts.forEachChild(node,child=>visit(child,method));
 }
 visit(source);
}
console.log(JSON.stringify({scope:'Route query bounds; verify unbounded reads and UI reachability separately',entries:results,unclassified:results.filter(r=>r.classification==='review')},null,2));
