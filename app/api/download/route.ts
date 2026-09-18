import {NextRequest,NextResponse} from "next/server";
export const maxDuration=60;
const API_KEY=process.env.RAPIDAPI_KEY;
const HOST="youtube138.p.rapidapi.com";

type F={url?:string;mimeType?:string;qualityLabel?:string;width?:number;height?:number;bitrate?:number};
const score=(f:F)=>(f.height||Number(f.qualityLabel?.match(/\d{3,4}/)?.[0]||0))*1000000+(f.bitrate||0);
const safe=(s:string)=>s.replace(/[<>:"/\\|?*]+/g,"_").trim().slice(0,120)||"youtube-video";

function extractVideoId(value:string){
  const s=value.trim();
  if(/^[A-Za-z0-9_-]{6,20}$/.test(s)) return s;
  try{
    const u=new URL(s);
    const host=u.hostname.replace(/^www\./,"").toLowerCase();
    if(host==="youtu.be") return u.pathname.split("/").filter(Boolean)[0]||null;
    if(host.endsWith("youtube.com")){
      const q=u.searchParams.get("v");
      if(q) return q;
      const parts=u.pathname.split("/").filter(Boolean);
      const idx=parts.findIndex(p=>["shorts","embed","live"].includes(p));
      if(idx>=0) return parts[idx+1]||null;
    }
  }catch{}
  return null;
}

async function rapid(path:string,params:Record<string,string>){
  if(!API_KEY) throw Error("RAPIDAPI_KEY is not configured.");
  const u=new URL(`https://${HOST}${path}`);for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);
  const r=await fetch(u,{headers:{"x-rapidapi-key":API_KEY,"x-rapidapi-host":HOST},cache:"no-store"});
  const t=await r.text();let d:any;try{d=JSON.parse(t)}catch{d={message:t}}
  if(!r.ok) throw Error(d?.message||`RapidAPI returned ${r.status}`);return d;
}

export async function GET(req:NextRequest){
  try{
    if(!API_KEY) return NextResponse.json({error:"RAPIDAPI_KEY is not configured."},{status:500});
    const p=new URL(req.url).searchParams;
    const supplied=p.get("videoId")?.trim()||p.get("url")?.trim();
    if(!supplied) return NextResponse.json({error:"Paste a YouTube video URL or provide a video ID."},{status:400});
    const id=extractVideoId(supplied);
    if(!id) return NextResponse.json({error:"Invalid YouTube video URL/ID."},{status:400});

    const d=await rapid("/video/streaming-data/",{id});
    const formats:F[]=Array.isArray(d?.formats)?d.formats:[];
    const adaptive:F[]=Array.isArray(d?.adaptiveFormats)?d.adaptiveFormats:[];
    const progressive=formats.filter(f=>f.url&&(f.mimeType||"").startsWith("video/mp4")).sort((a,b)=>score(b)-score(a))[0];
    const chosen=progressive||formats.filter(f=>f.url).sort((a,b)=>score(b)-score(a))[0]||adaptive.filter(f=>f.url&&(f.mimeType||"").startsWith("video/")).sort((a,b)=>score(b)-score(a))[0];
    if(!chosen?.url) return NextResponse.json({error:"No downloadable stream was returned for this video."},{status:404});

    const media=await fetch(chosen.url,{cache:"no-store"});
    if(!media.ok||!media.body) return NextResponse.json({error:`Media server returned ${media.status}.`},{status:502});

    let title=id;
    try{const tr=await rapid("/video/details/",{id,hl:"en",gl:"US"});title=tr?.title||tr?.name||id}catch{}
    const ct=chosen.mimeType?.split(";")[0]||media.headers.get("content-type")||"video/mp4";
    const ext=ct.includes("webm")?"webm":"mp4";
    const h=new Headers({"Content-Type":ct,"Content-Disposition":`attachment; filename="${safe(title)}.${ext}"`,"Cache-Control":"no-store"});
    const len=media.headers.get("content-length");if(len)h.set("Content-Length",len);
    return new Response(media.body,{headers:h});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Download failed"},{status:500})}
}
