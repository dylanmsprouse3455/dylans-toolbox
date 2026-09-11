import {captureUrl,publicConfig} from '@/lib/public-config';
export async function POST(request:Request){
  return fetch(captureUrl,{method:'POST',headers:{Authorization:request.headers.get('authorization')||'',apikey:publicConfig.key},body:await request.formData()});
}
