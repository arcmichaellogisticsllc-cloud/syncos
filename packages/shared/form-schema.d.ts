export type FormField={key:string;label:string;type:'text'|'textarea'|'number'|'date'|'checkbox'|'select';required:boolean;options?:string[];showWhen?:{key:string;equals:string|boolean}};
export type FormSchema={name:string;description:string;fields:FormField[]};
export function validateFormTemplate(input:unknown):FormSchema;
export function validateFormAnswers(schema:FormSchema,input:unknown,complete?:boolean):Record<string,string|number|boolean>;
export function visibleFormFields(schema:FormSchema,answers:Record<string,unknown>):FormField[];
