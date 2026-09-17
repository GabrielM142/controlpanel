export type Tone='g'|'a'|'r';
export type Rich=ReportNode[];
export interface BarRow {n:string;v:number;vt:string;color?:string}
export type ReportNode=
 | {kind:'text';text:string}
 | {kind:'element';tag:string;attrs:Record<string,string>;navigate?:string;children:Rich}
 | {kind:'panel';title:string;children:Rich;span?:number}
 | {kind:'kpi';label:string;value:Rich;deltas:{label:string;value:Rich;tone:string}[];tone:Tone}
 | {kind:'metric';label:string;value:Rich;sub:string}
 | {kind:'bars';title:string;rows:BarRow[];max?:number}
 | {kind:'table';title:string;headers:{t:string;num?:number}[];rows:Rich[][];span?:number}
 | {kind:'list';title:string;items:{c:string;t:string;d:string}[]}
 | {kind:'ise';id:string;score:number;status:string;color:string;components:[string,number][];formula:string}
 | {kind:'toggle';id:string;title:string;options:string[];defaultOption:string;data:Record<string,BarRow[]>}
 | {kind:'matrix';rows:string[][]}
 | {kind:'geo';id:string};
export interface ReportPage {id:string;group:string;label:string;dot:Tone;filters:string[];paused?:boolean;question:string;nodes:Rich}
export interface Report {filters:Record<string,{label:string;options:string[];sel:string}>;pages:ReportPage[]}
