import {NextRequest,NextResponse} from "next/server";

const API_KEY=process.env.RAPIDAPI_KEY;
const DATA_API_KEY=process.env.YOUTUBE_DATA_API_KEY;
const HOST="youtube138.p.rapidapi.com";
const BASE=`https://${HOST}`;
const DATA_BASE="https://www.googleapis.com/youtube/v3";

type RawVideo={
  videoId?:string; title?:string; thumbnails?:{url?:string}[]; publishedTimeText?:string; publishedAt?:string;
  lengthSeconds?:number|string; stats?:{views?:number|string}; author?:{title?:string;channelId?:string}; description?:string;
  isLive?:boolean; isLiveNow?:boolean; video?:RawVideo;
};

type RawDetails={
  channelId?:string; id?:string; title?:string; name?:string; description?:string;
  stats?:{subscribers?:number|string;subscribersText?:string;views?:number|string;videos?:number|string};
  avatar?:{url?:string}[]; banner?:{desktop?:{url?:string}[]};
  [key:string]:unknown;
};

const firstString=(...xs:unknown[])=>xs.find(x=>typeof x==="string"&&x.trim()) as string|undefined;
const num=(x:unknown)=>{const n=typeof x==="number"?x:Number(String(x??"").replace(/,/g,""));return Number.isFinite(n)?n:undefined};

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

async function youtubeData(path:string,params:Record<string,string|undefined>){
  if(!DATA_API_KEY) throw Error("YOUTUBE_DATA_API_KEY is not configured.");
  const u=new URL(DATA_BASE+path);
  for(const[k,v]of Object.entries(params)) if(v) u.searchParams.set(k,v);
  u.searchParams.set("key",DATA_API_KEY);
  const r=await fetch(u,{cache:"no-store"});
  const t=await r.text();
  let d:any; try{d=JSON.parse(t)}catch{d={message:t}}
  if(!r.ok) throw Error(d?.error?.message||d?.message||`YouTube Data API returned ${r.status}`);
  return d;
}

function normalizeChannel(d:RawDetails){
  const stats=(d?.stats||{}) as RawDetails["stats"];
  const avatar=Array.isArray(d?.avatar)?d.avatar.find(x=>x?.url)?.url:undefined;
  const banner=Array.isArray(d?.banner?.desktop)?d.banner.desktop.find(x=>x?.url)?.url:undefined;
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
    isLive:Boolean(v.isLive||v.isLiveNow),
    url:`https://www.youtube.com/watch?v=${v.videoId}`,
  };
}

function isoDurationToSeconds(value?:string){
  if(!value) return undefined;
  const m=value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if(!m) return undefined;
  return Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]||0);
}

function youtubeChannelToUi(d:any){
  const c=d?.items?.[0];
  if(!c) return undefined;
  return {
    channelId:c.id,
    title:c.snippet?.title,
    description:c.snippet?.description,
    subscribers:num(c.statistics?.subscriberCount),
    views:num(c.statistics?.viewCount),
    videos:num(c.statistics?.videoCount),
    avatar:c.snippet?.thumbnails?.high?.url||c.snippet?.thumbnails?.medium?.url||c.snippet?.thumbnails?.default?.url,
    banner:c.brandingSettings?.image?.bannerExternalUrl,
  };
}

function extractHandle(channel:string){
  try{
    const u=new URL(channel);
    const parts=u.pathname.split("/").filter(Boolean);
    const handle=parts.find(x=>x.startsWith("@"));
    return handle||undefined;
  }catch{return undefined}
}

async function resolveDataChannel(channel:string,channelId?:string){
  if(channelId){
    return youtubeData("/channels",{part:"snippet,contentDetails,statistics,brandingSettings",id:channelId});
  }
  const handle=extractHandle(channel);
  if(handle){
    const byHandle=await youtubeData("/channels",{part:"snippet,contentDetails,statistics,brandingSettings",forHandle:handle});
    if(byHandle?.items?.length) return byHandle;
  }
  const idMatch=channel.match(/(?:\/channel\/)([A-Za-z0-9_-]{20,})/);
  if(idMatch) return youtubeData("/channels",{part:"snippet,contentDetails,statistics,brandingSettings",id:idMatch[1]});
  throw Error("YouTube Data API could not resolve this channel URL. Use a channel URL with an @handle or a /channel/UC… path.");
}

async function loadYoutubeDataVideos(channel:string,channelId:string,filter:string,cursor?:string){
  if(!DATA_API_KEY) throw Error("YOUTUBE_DATA_API_KEY is not configured.");
  const channelData=await resolveDataChannel(channel,channelId);
  const c=channelData?.items?.[0];
  if(!c?.id) throw Error("YouTube Data API did not return the channel.");
  const uploadsId=c.contentDetails?.relatedPlaylists?.uploads;
  if(!uploadsId) throw Error("YouTube Data API did not return the channel uploads playlist.");

  // The official API exposes uploads through the channel's system-generated uploads playlist.
  // It does not have the Youtube138 filter tokens, so the fallback uses the uploads feed for all
  // three dashboard modes and filters live items client-side where practical.
  const page=await youtubeData("/playlistItems",{part:"snippet,contentDetails",playlistId:uploadsId,maxResults:"50",pageToken:cursor?.replace(/^ytdata:/,"")||undefined});
  const ids=(page?.items||[]).map((x:any)=>x?.contentDetails?.videoId||x?.snippet?.resourceId?.videoId).filter(Boolean);
  if(!ids.length){
    return {
      channel:youtubeChannelToUi(channelData),
      videos:[],
      cursorNext:page?.nextPageToken?`ytdata:${page.nextPageToken}`:undefined,
      diagnostics:{returnedItems:0,normalizedVideos:0,filter,channelId:c.id,source:"youtube-data-api"},
    };
  }

  const detail=await youtubeData("/videos",{part:"snippet,contentDetails,statistics",id:ids.join(",")});
  const byId=new Map<string,any>((detail?.items||[]).map((x:any)=>[x.id,x]));
  const videos=(page?.items||[]).map((item:any)=>{
    const id=item?.contentDetails?.videoId||item?.snippet?.resourceId?.videoId;
    const v=byId.get(id);
    if(!id||!v) return null;
    const liveMode=v.snippet?.liveBroadcastContent;
    return {
      videoId:id,
      title:v.snippet?.title||item?.snippet?.title||"Untitled",
      thumbnail:v.snippet?.thumbnails?.high?.url||v.snippet?.thumbnails?.medium?.url||v.snippet?.thumbnails?.default?.url,
      publishedTimeText:undefined,
      publishedAt:v.snippet?.publishedAt||item?.snippet?.publishedAt,
      lengthSeconds:isoDurationToSeconds(v.contentDetails?.duration),
      views:num(v.statistics?.viewCount),
      author:v.snippet?.channelTitle,
      channelId:v.snippet?.channelId||c.id,
      description:v.snippet?.description,
      isLive:liveMode==="live"||liveMode==="upcoming",
      url:`https://www.youtube.com/watch?v=${id}`,
    };
  }).filter(Boolean);

  const filtered=filter==="streams_latest"?videos.filter((v:any)=>v.isLive||v.publishedAt):videos;
  return {
    channel:youtubeChannelToUi(channelData),
    videos:filtered,
    cursorNext:page?.nextPageToken?`ytdata:${page.nextPageToken}`:undefined,
    diagnostics:{returnedItems:(page?.items||[]).length,normalizedVideos:filtered.length,filter,channelId:c.id,source:"youtube-data-api"},
  };
}

async function loadYoutube138Videos(channelUrl:string,channelId:string,filter:string,cursor?:string){
  const params:{id:string;filter?:string;cursor?:string;hl:string;gl:string}={id:channelId,hl:"en",gl:"US"};
  if(cursor) params.cursor=cursor;
  // Youtube138 documents videos_latest as the default. Omitting the filter on the default
  // path avoids breaking when a provider deployment rejects an otherwise valid legacy token.
  if(filter!=="videos_latest") params.filter=filter;
  let d=await rapid("/channel/videos/",params);
  let source=normalizeContents(d);

  // Some deployments have temporarily diverged in how they accept the channel identifier.
  // Retry once with an explicit filter, then once with the original channel URL.
  if(!source.length && !cursor && filter==="videos_latest"){
    d=await rapid("/channel/videos/",{id:channelId,filter,hl:"en",gl:"US"});
    source=normalizeContents(d);
  }
  if(!source.length && !cursor && channelUrl && channelUrl!==channelId){
    d=await rapid("/channel/videos/",{id:channelUrl,filter,hl:"en",gl:"US"});
    source=normalizeContents(d);
  }
  const videos=source.map(normalizeVideo).filter(Boolean);
  const cursorNext=firstString(d?.cursorNext,d?.nextCursor,d?.pagination?.nextCursor,d?.pagination?.nextPageToken);
  return {videos,cursorNext,rawCount:source.length};
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
      if(!API_KEY && !DATA_API_KEY) return NextResponse.json({error:"Configure RAPIDAPI_KEY or YOUTUBE_DATA_API_KEY on the server."},{status:500});
      if(API_KEY){
        try{
          const details=await rapid("/channel/details/",{id:channel!,hl:"en",gl:"US"});
          channelInfo=normalizeChannel(details);
          channelId=channelInfo.channelId;
        }catch(e){
          if(DATA_API_KEY){
            const d=await resolveDataChannel(channel!);
            channelInfo=youtubeChannelToUi(d);
            channelId=channelInfo?.channelId;
          }else throw e;
        }
      }else if(DATA_API_KEY){
        const d=await resolveDataChannel(channel!);
        channelInfo=youtubeChannelToUi(d);
        channelId=channelInfo?.channelId;
      }
      if(!channelId) throw Error("Could not resolve the YouTube channel ID.");
    }else if(API_KEY){
      try{channelInfo=normalizeChannel(await rapid("/channel/details/",{id:channelId,hl:"en",gl:"US"}))}catch{channelInfo={channelId}}
      channelInfo.channelId=channelId;
    }

    // A ytdata-prefixed cursor means the previous page came from the official fallback.
    if(cursor?.startsWith("ytdata:")){
      const d=await loadYoutubeDataVideos(channel||channelId!,channelId!,filter,cursor);
      return NextResponse.json(d);
    }

    let primaryError:string|undefined;
    if(API_KEY){
      try{
        const d=await loadYoutube138Videos(channel||channelId!,channelId!,filter,cursor);
        if(d.videos.length){
          return NextResponse.json({
            channel:channelInfo,
            videos:d.videos,
            cursorNext:d.cursorNext,
            diagnostics:{returnedItems:d.rawCount,normalizedVideos:d.videos.length,filter,channelId,source:"youtube138"},
          });
        }
        primaryError="Youtube138 returned zero channel videos.";
      }catch(e){primaryError=e instanceof Error?e.message:"Youtube138 channel request failed."}
    }

    if(DATA_API_KEY){
      const d=await loadYoutubeDataVideos(channel||channelId!,channelId!,filter,cursor);
      d.channel=d.channel||channelInfo;
      return NextResponse.json({
        ...d,
        diagnostics:{...d.diagnostics,primaryError},
      });
    }

    return NextResponse.json({
      channel:channelInfo,
      videos:[],
      cursorNext:undefined,
      diagnostics:{returnedItems:0,normalizedVideos:0,filter,channelId,source:"youtube138",primaryError},
    });
  }catch(e){
    return NextResponse.json({error:e instanceof Error?e.message:"Unexpected error"},{status:500});
  }
}
