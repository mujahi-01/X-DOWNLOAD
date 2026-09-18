import {NextRequest,NextResponse} from "next/server";

export const maxDuration=60;
const API_KEY=process.env.YOUTUBE_MEDIA_RAPIDAPI_KEY||process.env.RAPIDAPI_KEY;
const HOST="youtube-media-downloader.p.rapidapi.com";
const BASE=`https://${HOST}`;

type MediaItem={
  url?:string;
  lengthMs?:number;
  mimeType?:string;
  extension?:string;
  size?:number;
  sizeText?:string;
  hasAudio?:boolean;
  quality?:string;
  width?:number;
  height?:number;
};

type VideoDetails={
  errorId?:string;
  id?:string;
  title?:string;
  videos?:{errorId?:string;items?:MediaItem[]};
  audios?:{errorId?:string;items?:MediaItem[]};
};

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

async function providerGet(path:string,params:Record<string,string>){
  if(!API_KEY) throw Error("YOUTUBE_MEDIA_RAPIDAPI_KEY is not configured.");
  const u=new URL(BASE+path);
  for(const[k,v]of Object.entries(params)) u.searchParams.set(k,v);
  const r=await fetch(u,{headers:{"x-rapidapi-key":API_KEY,"x-rapidapi-host":HOST},cache:"no-store"});
  const text=await r.text();
  let data:any;try{data=JSON.parse(text)}catch{data={message:text}};
  if(!r.ok) throw Error(data?.message||data?.error||`RapidAPI returned ${r.status}`);
  if(data?.errorId&&data.errorId!=="Success") throw Error(data?.message||`YouTube Media Downloader error: ${data.errorId}`);
  return data;
}

function qualityScore(item:MediaItem){
  const height=item.height||Number(item.quality?.match(/\d{3,4}/)?.[0]||0);
  const size=item.size||0;
  return height*1_000_000+size;
}

export async function GET(req:NextRequest){
  try{
    if(!API_KEY) return NextResponse.json({error:"YOUTUBE_MEDIA_RAPIDAPI_KEY is not configured."},{status:500});
    const p=new URL(req.url).searchParams;
    const supplied=p.get("videoId")?.trim()||p.get("url")?.trim();
    if(!supplied) return NextResponse.json({error:"Paste a YouTube video URL or provide a video ID."},{status:400});
    const id=extractVideoId(supplied);
    if(!id) return NextResponse.json({error:"Invalid YouTube video URL/ID."},{status:400});

    // The new provider returns downloadable media under /v2/video/details.
    // Ask for normal URL access and simplified video objects so we can select a
    // progressive MP4 stream that already contains audio.
    const d=await providerGet("/v2/video/details",{
      videoId:id,
      urlAccess:"normal",
      lang:"en-US",
      videos:"true",
      audios:"true",
      subtitles:"false",
      related:"false",
    }) as VideoDetails;

    const items=Array.isArray(d?.videos?.items)?d.videos.items:[];
    const chosen=items
      .filter(x=>x?.url&&x?.hasAudio&&((x.mimeType||"").toLowerCase().startsWith("video/mp4")||x.extension==="mp4"))
      .sort((a,b)=>qualityScore(b)-qualityScore(a))[0]
      ||items.filter(x=>x?.url&&x?.hasAudio).sort((a,b)=>qualityScore(b)-qualityScore(a))[0];

    if(!chosen?.url){
      return NextResponse.json({error:"The provider returned video formats, but no combined video+audio stream was available for this video."},{status:404});
    }

    const media=await fetch(chosen.url,{cache:"no-store"});
    if(!media.ok||!media.body) return NextResponse.json({error:`Media server returned ${media.status}.`},{status:502});

    const title=d?.title||id;
    const ct=chosen.mimeType?.split(";")[0]||media.headers.get("content-type")||"video/mp4";
    const ext=chosen.extension||(ct.includes("webm")?"webm":"mp4");
    const filename=safe(title);
    const headers=new Headers({
      "Content-Type":ct,
      "Content-Disposition":`attachment; filename="${filename}.${ext}"`,
      "Cache-Control":"no-store",
    });
    const len=media.headers.get("content-length");if(len) headers.set("Content-Length",len);
    return new Response(media.body,{headers});
  }catch(e){
    return NextResponse.json({error:e instanceof Error?e.message:"Download failed"},{status:500});
  }
}
