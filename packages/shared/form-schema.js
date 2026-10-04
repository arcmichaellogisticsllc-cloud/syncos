// Pure validation shared by the browser and API. These supplemental forms never authorize work.
function text(value,label,max){if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`${label} is required (maximum ${max} characters).`);return value.trim();}
function template(input){
 if(!input||!Array.isArray(input.fields)||input.fields.length<1||input.fields.length>50)throw new Error('Provide between 1 and 50 fields.');
 const previous=new Map();
 const fields=input.fields.map(f=>{
  if(!f||!/^[a-z][a-z0-9_]{0,49}$/.test(f.key)||['__proto__','constructor','prototype'].includes(f.key)||previous.has(f.key))throw new Error('Each field needs a unique key beginning with a letter.');
  if(!['text','textarea','number','date','checkbox','select'].includes(f.type))throw new Error('Unsupported field type.');
  const field={key:f.key,label:text(f.label,'Field label',160),type:f.type,required:f.required===true};
  if(f.type==='select'){if(!Array.isArray(f.options)||f.options.length<1||f.options.length>50)throw new Error('A selection needs 1–50 choices.');field.options=f.options.map(v=>text(v,'Choice',120));if(new Set(field.options).size!==field.options.length)throw new Error('Choices must be distinct.');}
  if(f.showWhen){const parent=previous.get(f.showWhen.key);if(!parent||!['select','checkbox'].includes(parent.type))throw new Error('A conditional field must refer to an earlier choice or checkbox.');if(parent.type==='checkbox'?typeof f.showWhen.equals!=='boolean':!parent.options.includes(f.showWhen.equals))throw new Error('Invalid conditional value.');field.showWhen={key:parent.key,equals:f.showWhen.equals};}
  previous.set(field.key,field);return field;
 });
 return {name:text(input.name,'Form name',160),description:typeof input.description==='string'?input.description.trim().slice(0,2000):'',fields};
}
function visibleFields(schema,answers){const visible=new Set();return schema.fields.filter(f=>{const show=!f.showWhen||(visible.has(f.showWhen.key)&&answers[f.showWhen.key]===f.showWhen.equals);if(show)visible.add(f.key);return show;});}
function answers(schema,input,complete=true){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Answers must be a record.');
 const fields=visibleFields(schema,input),keys=new Set(fields.map(f=>f.key)),result={};
 for(const key of Object.keys(input))if(!keys.has(key))throw new Error('Remove answers for hidden or unknown fields.');
 for(const f of fields){const v=input[f.key],empty=v===undefined||v===null||v==='';if(empty){if(complete&&f.required)throw new Error(`${f.label} is required.`);continue;}
  if(f.type==='checkbox'){if(typeof v!=='boolean')throw new Error(`${f.label} must be yes or no.`);}
  else if(f.type==='number'){if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e12)throw new Error(`${f.label} must be a finite number within range.`);}
  else if(typeof v!=='string'||v.length>(f.type==='textarea'?4000:1000))throw new Error(`${f.label} is too long or invalid.`);
  if(f.type==='select'&&!f.options.includes(v))throw new Error(`Choose a listed value for ${f.label}.`);
  if(f.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))throw new Error(`${f.label} needs a valid date.`);
  if(complete&&f.required&&typeof v==='string'&&!v.trim())throw new Error(`${f.label} is required.`);
  result[f.key]=typeof v==='string'?v.trim():v;
 }
 return result;
}
module.exports={validateFormTemplate:template,validateFormAnswers:answers,visibleFormFields:visibleFields};
