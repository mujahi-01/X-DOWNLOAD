import {NextRequest,NextResponse} from "next/server";

export const maxDuration=60;

const MEDIA_API_KEY=process.env.YOUTUBE_MEDIA_RAPIDAPI_KEY||process.env.RAPIDAPI_KEY;
const MEDIA_HOST="youtube-media-downloader.p.rapidapi.com";
const MEDIA_BASE=`https://${MEDIA_HOST}`;

const FAST_API_KEY=process.env.YOUTUBE_FAST_RAPIDAPI_KEY||process.env.RAPIDAPI_KEY;
const FAST_HOST="youtube-video-fast-downloader-24-7.p.rapidapi.com";
const FAST_BASE=`https://${FAST_HOST}`;
const FAST_DEFAULT_QUALITY=process.env.YOUTUBE_FAST_DOWNLOAD_QUALITY||"18";

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

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

async function providerGet(base:string,host:string,key:string,path:string,params:Record<string,string>){
  if(!key) throw Error(`${host} RapidAPI key is not configured.`);
  const u=new URL(base+path);
  for(const[k,v]of Object.entries(params)) u.searchParams.set(k,v);
  const r=await fetch(u,{headers:{"x-rapidapi-key":key,"x-rapidapi-host":host},cache:"no-store"});
  const text=await r.text();
  let data:any;try{data=JSON.parse(text)}catch{data={message:text}};
  if(!r.ok) throw Object.assign(new Error(data?.message||data?.error||`RapidAPI returned ${r.status}`),{status:r.status,provider:host});
  if(data?.errorId&&data.errorId!=="Success") throw Object.assign(new Error(data?.message||`Provider error: ${data.errorId}`),{status:502,provider:host});
  return data;
}

function qualityScore(item:MediaItem){
  const height=item.height||Number(item.quality?.match(/\d{3,4}/)?.[0]||0);
  const size=item.size||0;
  return height*1_000_000+size;
}

async function streamResponse(media:Response,title:string,extensionHint="mp4",mimeHint?:string){
  if(!media.ok||!media.body) throw Object.assign(new Error(`Media server returned ${media.status}.`),{status:media.status});
  const ct=mimeHint?.split(";")[0]||media.headers.get("content-type")||"video/mp4";
  const ext=extensionHint||(ct.includes("webm")?"webm":"mp4");
  const headers=new Headers({
    "Content-Type":ct,
    "Content-Disposition":`attachment; filename="${safe(title)}.${ext}"`,
    "Cache-Control":"no-store",
  });
  const len=media.headers.get("content-length");if(len) headers.set("Content-Length",len);
  return new Response(media.body,{headers});
}

async function tryPrimary(id:string){
  if(!MEDIA_API_KEY) throw Error("YOUTUBE_MEDIA_RAPIDAPI_KEY is not configured.");
  const d=await providerGet(MEDIA_BASE,MEDIA_HOST,MEDIA_API_KEY,"/v2/video/details",{
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

  if(!chosen?.url) throw Object.assign(new Error("The primary provider returned no combined video+audio stream."),{status:404});

  const media=await fetch(chosen.url,{cache:"no-store"});
  if(!media.ok||!media.body) throw Object.assign(new Error(`Primary media server returned ${media.status}.`),{status:media.status});

  return {response:await streamResponse(media,d?.title||id,chosen.extension||(chosen.mimeType?.includes("webm")?"webm":"mp4"),chosen.mimeType),provider:MEDIA_HOST};
}

async function tryFastFallback(id:string,titleHint:string,quality:string){
  if(!FAST_API_KEY) throw Error("YOUTUBE_FAST_RAPIDAPI_KEY is not configured.");

  const d=await providerGet(FAST_BASE,FAST_HOST,FAST_API_KEY,`/download_video/${encodeURIComponent(id)}`,{quality});
  const file=typeof d?.file==="string"?d.file:typeof d?.url==="string"?d.url:typeof d?.downloadUrl==="string"?d.downloadUrl:null;
  if(!file) throw Object.assign(new Error(d?.message||d?.error||"Fast downloader did not return a file URL."),{status:502});

  let lastStatus=0;
  // The provider can take some time to generate the file. Poll the returned
  // file URL briefly within this server request before reporting failure.
  for(let attempt=0;attempt<7;attempt++){
    const media=await fetch(file,{cache:"no-store",redirect:"follow"});
    lastStatus=media.status;
    if(media.ok&&media.body){
      const contentType=media.headers.get("content-type")||"video/mp4";
      const ext=contentType.includes("webm")?"webm":"mp4";
      return {response:await streamResponse(media,titleHint,ext,contentType),provider:FAST_HOST};
    }
    if(![403,404,408,425,429,500,502,503,504].includes(media.status)) break;
    if(attempt<6) await sleep(5000);
  }

  throw Object.assign(new Error(`Fast downloader file is not ready yet (last response ${lastStatus}). Try the download again in a few seconds.`),{status:504});
}

export async function GET(req:NextRequest){
  const p=new URL(req.url).searchParams;
  const supplied=p.get("videoId")?.trim()||p.get("url")?.trim();
  const quality=p.get("quality")?.trim()||FAST_DEFAULT_QUALITY;
  if(!supplied) return NextResponse.json({error:"Paste a YouTube video URL or provide a video ID."},{status:400});
  const id=extractVideoId(supplied);
  if(!id) return NextResponse.json({error:"Invalid YouTube video URL/ID."},{status:400});
  const title=p.get("title")?.trim()||id;

  let primaryError="";
  try{
    const result=await tryPrimary(id);
    return result.response;
  }catch(error){
    primaryError=error instanceof Error?error.message:"Primary provider failed.";
  }

  try{
    const result=await tryFastFallback(id,title,quality);
    const response=result.response;
    response.headers.set("X-Download-Provider",result.provider);
    response.headers.set("X-Primary-Error",encodeURIComponent(primaryError).slice(0,500));
    return response;
  }catch(error){
    const fastError=error instanceof Error?error.message:"Fallback provider failed.";
    const status=(error as {status?:number})?.status||502;
    return NextResponse.json({
      error:fastError,
      primaryProvider:MEDIA_HOST,
      primaryError,
      fallbackProvider:FAST_HOST,
      quality,
    },{status});
  }
}
