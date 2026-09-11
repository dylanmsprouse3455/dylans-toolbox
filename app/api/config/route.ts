import {publicConfig} from '@/lib/public-config';
export function GET(){return Response.json(publicConfig,{headers:{'Cache-Control':'no-store'}});}
