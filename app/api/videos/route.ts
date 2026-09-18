import {NextRequest,NextResponse} from "next/server";

const API_KEY=process.env.RAPIDAPI_KEY;
const HOST="youtube138.p.rapidapi.com";
const BASE=`https://${HOST}`;

type RawVideo={
  videoId?:string; title?:string; thumbnails?:{url?:string}[]; publishedTimeText?:string; publishedAt?:string;
  lengthSeconds?:number|string; stats?:{views?:number|string}; author?:{title?:string;channelId?:string}; description?:string;
  isLive?:boolean; video?:RawVideo;
};

type RawDetails={
  channelId?:string; id?:string; title?:string; name?:string; description?:string;
  stats?:{subscribers?:number|string;subscribersText?:string;views?:number|string;videos?:number|string};
  avatar?:{url?:string}[]; banner?:{desktop?:{url?:string}[]};
  [key:string]:unknown;
};

async function rapid(path:string,params:Record<string,string|undefined>){
  if(!API_KEY) throw Error("RAPIDAPI_KEY is not configured.");
  const u=new URL(BASE+path);
  for(const[k,v]of Object.entries(params)) if(v) u.searchParams.set(k,v);
  const r=await fetch(u,{headers:{"x-rapidapi-key":API_KEY,"x-rapidapi-host":HOST},cache:"no-store"});
  const t=await r.text();
  let d:any; try{d=JSON.parse(t)}catch{d={message:t}}
  if(!r.ok) throw Error(d?.message||`RapidAPI returned ${r.status}`);
  return d;
}

const firstString=(...xs:unknown[])=>xs.find(x=>typeof x==="string"&&x.trim()) as string|undefined;
const num=(x:unknown)=>{const n=typeof x==="number"?x:Number(String(x??"").replace(/,/g,""));return Number.isFinite(n)?n:undefined};

function normalizeChannel(d:RawDetails){
  const stats=(d?.stats||{}) as RawDetails["stats"];
  const avatar=Array.isArray(d?.avatar)?d.avatar.find(x=>x?.url)?.url:undefined;
  const banner=Array.isArray(d?.banner?.desktop)?d.banner?.desktop?.find(x=>x?.url)?.url:undefined;
  return {
    channelId:firstString(d?.channelId,d?.id,(d as any)?.channel?.channelId,(d as any)?.channel?.id,(d as any)?.data?.channelId),
    title:firstString(d?.title,d?.name,(d as any)?.channel?.title,(d as any)?.data?.title),
    description:firstString(d?.description,(d as any)?.channel?.description,(d as any)?.data?.description),
    subscribers:num(stats?.subscribers),
    subscribersText:stats?.subscribersText,
    views:num(stats?.views),
    videos:num(stats?.videos),
    avatar,
    banner,
  };
}

function normalizeContents(d:any):RawVideo[]{
  const c=d?.contents ?? d?.data?.contents ?? d?.items ?? d?.data?.items;
  return Array.isArray(c)?c:[];
}

function normalizeVideo(raw:RawVideo){
  const v=raw?.video||raw;
  if(!v?.videoId) return null;
  return {
    videoId:v.videoId,
    title:v.title||"Untitled",
    thumbnail:v.thumbnails?.find(x=>x?.url)?.url,
    publishedTimeText:v.publishedTimeText,
    publishedAt:v.publishedAt,
    lengthSeconds:num(v.lengthSeconds),
    views:num(v.stats?.views),
    author:v.author?.title,
    channelId:v.author?.channelId,
    description:v.description,
    isLive:Boolean(v.isLive),
    url:`https://www.youtube.com/watch?v=${v.videoId}`,
  };
}

export async function GET(req:NextRequest){
  try{
    const q=new URL(req.url).searchParams;
    const channel=q.get("channel")?.trim();
    const channelIdParam=q.get("channelId")?.trim();
    const cursor=q.get("cursor")||undefined;
    const filter=q.get("filter")||"videos_latest";
    if(!channel && !channelIdParam) return NextResponse.json({error:"Channel URL is required."},{status:400});

    let channelInfo:any;
    let channelId=channelIdParam;

    if(!channelId){
      const details=await rapid("/channel/details/",{id:channel!,hl:"en",gl:"US"});
      channelInfo=normalizeChannel(details);
      channelId=channelInfo.channelId;
      if(!channelId) throw Error("RapidAPI resolved the channel name, but did not return a channel ID. Check the server logs/API response.");
    } else {
      try{channelInfo=normalizeChannel(await rapid("/channel/details/",{id:channelId,hl:"en",gl:"US"}))}catch{channelInfo={channelId}};
      channelInfo.channelId=channelId;
    }

    const d=await rapid("/channel/videos/",{id:channelId,filter,cursor,hl:"en",gl:"US"});
    const source=normalizeContents(d);
    const videos=source.map(normalizeVideo).filter(Boolean);
    const cursorNext=firstString(d?.cursorNext,d?.nextCursor,d?.pagination?.nextCursor,d?.pagination?.nextPageToken);

    return NextResponse.json({
      channel:channelInfo,
      videos,
      cursorNext,
      diagnostics:{returnedItems:source.length,normalizedVideos:videos.length,filter,channelId},
    });
  }catch(e){
    return NextResponse.json({error:e instanceof Error?e.message:"Unexpected error"},{status:500});
  }
}
