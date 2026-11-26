import type { StudioRole } from './studio-project';
export type StudyJob={id:string;role:StudioRole;source:string;kind:'text'|'media'|'link'|'video';state:'running'|'done'|'failed';at:string;error?:string};
export type StudyNote={role:StudioRole;source:string;kind:string;createdAt:string;text:string;validated:false};
export type StudyInfo={enabled:boolean;mediaEnabled:boolean;videoEnabled?:boolean;jobs:StudyJob[];notes:StudyNote[];videos:{role:StudioRole;title:string;url:string}[]};
export const MEDIA_LIMIT=8*1024*1024;
