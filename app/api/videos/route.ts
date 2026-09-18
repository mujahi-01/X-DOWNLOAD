import {NextRequest,NextResponse} from "next/server";

const API_KEY=process.env.YOUTUBE_MEDIA_RAPIDAPI_KEY||process.env.RAPIDAPI_KEY;
const HOST="youtube-media-downloader.p.rapidapi.com";
const BASE=`https://${HOST}`;

type ProviderThumb={url?:string;width?:number;height?:number;moving?:boolean};

type ProviderVideo={
  type?:string;
  id?:string;
  videoId?:string;
  title?:string;
  lengthText?:string;
  lengthSeconds?:number|string;
  viewCountText?:string;
  viewCount?:number|string;
  stats?:{views?:number|string};
  publishedTimeText?:string;
  publishedTime?:string;
  thumbnails?:ProviderThumb[];
  description?:string;
  isLiveNow?:boolean;
  isLiveStream?:boolean;
  channel?:{id?:string;name?:string;handle?:string};
};

type ChannelResponse={
  errorId?:string;
  id?:string;
  name?:string;
  title?:string;
  handle?:string;
  description?:string;
  subscriberCountText?:string;
  subscriberCount?:number|string;
  viewCountText?:string;
  viewCount?:number|string;
  videoCountText?:string;
  videoCount?:number|string;
  thumbnails?:ProviderThumb[];
  avatar?:ProviderThumb[];
  avatars?:ProviderThumb[];
  banner?:ProviderThumb[];
  [key:string]:unknown;
};

const firstString=(...xs:unknown[])=>xs.find(x=>typeof x==="string"&&x.trim()) as string|undefined;

function parseCount(value:unknown):number|undefined{
  if(typeof value==="number"&&Number.isFinite(value)) return value;
  if(value==null) return undefined;
  const raw=String(value).trim().toUpperCase().replace(/,/g,"");
  if(!raw) return undefined;
  const match=raw.match(/(-?\d+(?:\.\d+)?)\s*([KMBT])?/);
  if(!match) return undefined;
  const base=Number(match[1]);
  if(!Number.isFinite(base)) return undefined;
  const mult=match[2]==="K"?1e3:match[2]==="M"?1e6:match[2]==="B"?1e9:match[2]==="T"?1e12:1;
  return Math.round(base*mult);
}

function parseDuration(value:unknown):number|undefined{
  if(typeof value==="number"&&Number.isFinite(value)) return value;
  if(value==null) return undefined;
  const s=String(value).trim();
  if(/^\d+$/.test(s)) return Number(s);
  const parts=s.split(":").map(Number);
  if(parts.some(n=>!Number.isFinite(n))) return undefined;
  if(parts.length===3) return parts[0]*3600+parts[1]*60+parts[2];
  if(parts.length===2) return parts[0]*60+parts[1];
  return undefined;
}

function firstThumb(items:unknown):string|undefined{
  if(!Array.isArray(items)) return undefined;
  const thumbs=items.filter((x):x is ProviderThumb=>!!x&&typeof x==="object"&&typeof (x as ProviderThumb).url==="string");
  return thumbs.sort((a,b)=>(b.width||0)-(a.width||0))[0]?.url;
}

function normalizeChannel(d:ChannelResponse, fallbackId?:string){
  const countText=firstString(d?.subscriberCountText);
  return {
    channelId:firstString(d?.id,fallbackId),
    title:firstString(d?.name,d?.title),
    description:firstString(d?.description),
    subscribers:parseCount(d?.subscriberCount??countText),
    subscribersText:countText,
    views:parseCount(d?.viewCount??d?.viewCountText),
    videos:parseCount(d?.videoCount??d?.videoCountText),
    avatar:firstThumb(d?.avatar??d?.avatars??d?.thumbnails),
    banner:firstThumb(d?.banner),
    handle:firstString(d?.handle),
  };
}

function normalizeVideo(raw:ProviderVideo, fallbackChannelId?:string){
  const videoId=firstString(raw?.id,raw?.videoId);
  if(!videoId||raw?.type&&raw.type!=="video") return null;
  const views=parseCount(raw?.viewCount??raw?.viewCountText??raw?.stats?.views);
  return {
    videoId,
    title:firstString(raw?.title)||"Untitled",
    thumbnail:firstThumb(raw?.thumbnails),
    publishedTimeText:firstString(raw?.publishedTimeText),
    publishedAt:firstString(raw?.publishedTime),
    lengthSeconds:parseDuration(raw?.lengthSeconds??raw?.lengthText),
    views,
    author:firstString(raw?.channel?.name),
    channelId:firstString(raw?.channel?.id,fallbackChannelId),
    description:firstString(raw?.description),
    isLive:Boolean(raw?.isLiveNow||raw?.isLiveStream),
    url:`https://www.youtube.com/watch?v=${videoId}`,
  };
}

function channelIdentifier(value:string){
  const raw=value.trim();
  if(!raw) return null;
  if(raw.startsWith("@")) return raw;
  if(/^UC[A-Za-z0-9_-]{10,}$/.test(raw)) return raw;
  try{
    const u=new URL(raw);
    const host=u.hostname.replace(/^www\./,"").toLowerCase();
    if(!host.endsWith("youtube.com")) return null;
    const parts=u.pathname.split("/").filter(Boolean);
    if(parts[0]?.startsWith("@")) return parts[0];
    if(parts[0]==="channel"&&parts[1]) return parts[1];
    if((parts[0]==="user"||parts[0]==="c")&&parts[1]) return parts[1];
  }catch{}
  return null;
}

async function providerGet(path:string,params:Record<string,string|undefined>){
  if(!API_KEY) throw Error("YOUTUBE_MEDIA_RAPIDAPI_KEY is not configured.");
  const u=new URL(BASE+path);
  for(const[k,v]of Object.entries(params)) if(v) u.searchParams.set(k,v);
  const r=await fetch(u,{headers:{"x-rapidapi-key":API_KEY,"x-rapidapi-host":HOST},cache:"no-store"});
  const text=await r.text();
  let data:any;try{data=JSON.parse(text)}catch{data={message:text}};
  if(!r.ok) throw Error(data?.message||data?.error||`RapidAPI returned ${r.status}`);
  if(data?.errorId&&data.errorId!=="Success") throw Error(data?.message||`YouTube Media Downloader error: ${data.errorId}`);
  return data;
}

async function providerPost(path:string,body:Record<string,unknown>){
  if(!API_KEY) throw Error("YOUTUBE_MEDIA_RAPIDAPI_KEY is not configured.");
  const r=await fetch(BASE+path,{method:"POST",headers:{"content-type":"application/json","x-rapidapi-key":API_KEY,"x-rapidapi-host":HOST},body:JSON.stringify(body),cache:"no-store"});
  const text=await r.text();
  let data:any;try{data=JSON.parse(text)}catch{data={message:text}};
  if(!r.ok) throw Error(data?.message||data?.error||`RapidAPI returned ${r.status}`);
  if(data?.errorId&&data.errorId!=="Success") throw Error(data?.message||`YouTube Media Downloader error: ${data.errorId}`);
  return data;
}

async function listChannelVideos(channelId:string,type:string,nextToken?:string){
  // The provider documents POST /v2/misc/list-items for unusually large nextToken values.
  if(nextToken&&nextToken.length>3500) return providerPost("/v2/misc/list-items",{nextToken,lang:"en-US"});
  return providerGet("/v2/channel/videos",{channelId,lang:"en-US",type,sortBy:"newest",nextToken});
}

async function handle(req:NextRequest,body?:Record<string,unknown>){
  try{
    const q=new URL(req.url).searchParams;
    const channel=typeof body?.channel==="string"?body.channel.trim():q.get("channel")?.trim();
    const channelIdParam=(typeof body?.channelId==="string"?body.channelId:q.get("channelId"))?.trim()||undefined;
    const cursor=(typeof body?.cursor==="string"?body.cursor:q.get("cursor"))||undefined;
    const filter=String(typeof body?.filter==="string"?body.filter:q.get("filter")||"videos_latest");
    if(!channel&&!channelIdParam) return NextResponse.json({error:"Channel URL is required."},{status:400});

    const requestedId=channelIdParam||channelIdentifier(channel||"");
    if(!requestedId) return NextResponse.json({error:"Use a YouTube channel URL such as https://www.youtube.com/@WWE, a /channel/UC... URL, or a @handle."},{status:400});

    const type=filter==="shorts_latest"?"shorts":filter==="streams_latest"?"live":"videos";
    const cursorToken=cursor;

    let channelInfo:ReturnType<typeof normalizeChannel>;
    try{
      const details=await providerGet("/v2/channel/details",{channelId:requestedId,lang:"en-US"}) as ChannelResponse;
      channelInfo=normalizeChannel(details,requestedId);
    }catch(error){
      if(cursorToken) throw error;
      channelInfo=normalizeChannel({id:requestedId},requestedId);
    }

    const data=await listChannelVideos(requestedId,type,cursorToken) as {items?:ProviderVideo[];nextToken?:string;errorId?:string};
    const items=Array.isArray(data?.items)?data.items:[];
    const videos=items.map(v=>normalizeVideo(v,channelInfo.channelId||requestedId)).filter(Boolean);

    return NextResponse.json({
      channel:channelInfo,
      videos,
      cursorNext:firstString(data?.nextToken),
      diagnostics:{returnedItems:items.length,normalizedVideos:videos.length,filter,provider:HOST,channelId:channelInfo.channelId||requestedId,usedLargeTokenEndpoint:Boolean(cursorToken&&cursorToken.length>3500)},
    });
  }catch(e){
    return NextResponse.json({error:e instanceof Error?e.message:"Unexpected error"},{status:500});
  }
}

export async function GET(req:NextRequest){return handle(req);}
export async function POST(req:NextRequest){
  let body:Record<string,unknown>={};
  try{body=await req.json()}catch{}
  return handle(req,body);
}
