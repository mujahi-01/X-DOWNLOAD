"use client";
import {useEffect,useMemo,useState} from "react";

type Video={videoId:string;title:string;thumbnail?:string;publishedTimeText?:string;publishedAt?:string;lengthSeconds?:number;views?:number;url:string;author?:string;description?:string;isLive?:boolean};
type Channel={channelId?:string;title?:string;description?:string;subscribers?:number;subscribersText?:string;views?:number;videos?:number;avatar?:string;banner?:string};
type SearchResponse={channel?:Channel;videos:Video[];cursorNext?:string;error?:string;diagnostics?:{returnedItems:number;normalizedVideos:number;filter:string;channelId?:string}};
type HistoryItem={id:string;title:string;url:string;status:"success"|"error";time:string;message?:string};
type LogItem={id:string;time:string;type:"search"|"download"|"system";message:string};

const duration=(n?:number)=>{if(n==null)return "";const h=Math.floor(n/3600),m=Math.floor((n%3600)/60),s=n%60;return h?`${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`:`${m}:${String(s).padStart(2,"0")}`};
const esc=(s:string)=>`"${s.replaceAll('"','""')}"`;
const fmt=(n?:number)=>n==null?"—":n.toLocaleString();
const id=()=>`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

function extractVideoId(value:string){
  const s=value.trim();
  if(/^[A-Za-z0-9_-]{6,20}$/.test(s))return s;
  try{const u=new URL(s),host=u.hostname.replace(/^www\./,"").toLowerCase();if(host==="youtu.be")return u.pathname.split("/").filter(Boolean)[0]||null;if(host.endsWith("youtube.com")){const q=u.searchParams.get("v");if(q)return q;const parts=u.pathname.split("/").filter(Boolean),i=parts.findIndex(x=>["shorts","embed","live"].includes(x));if(i>=0)return parts[i+1]||null}}catch{}return null;
}

export default function Home(){
 const [view,setView]=useState<"channel"|"direct"|"history"|"logs">("channel");
 const [channelUrl,setChannelUrl]=useState("");
 const [filter,setFilter]=useState("videos_latest");
 const [keyword,setKeyword]=useState("");
 const [from,setFrom]=useState("");
 const [to,setTo]=useState("");
 const [advanced,setAdvanced]=useState(false);
 const [videos,setVideos]=useState<Video[]>([]);
 const [cursor,setCursor]=useState<string>();
 const [channelId,setChannelId]=useState("");
 const [channel,setChannel]=useState<Channel>({});
 const [selected,setSelected]=useState<string[]>([]);
 const [loading,setLoading]=useState(false);
 const [downloadState,setDownloadState]=useState("");
 const [error,setError]=useState("");
 const [directUrl,setDirectUrl]=useState("");
 const [history,setHistory]=useState<HistoryItem[]>([]);
 const [logs,setLogs]=useState<LogItem[]>([]);
 const [detailsOpen,setDetailsOpen]=useState(false);

 useEffect(()=>{try{setHistory(JSON.parse(localStorage.getItem("ycf-history")||"[]"));setLogs(JSON.parse(localStorage.getItem("ycf-logs")||"[]"))}catch{}},[]);
 function addLog(type:LogItem["type"],message:string){const item:{id:string;time:string;type:LogItem["type"];message:string}={id:id(),time:new Date().toISOString(),type,message};setLogs(prev=>{const next=[item,...prev].slice(0,100);localStorage.setItem("ycf-logs",JSON.stringify(next));return next})}
 function addHistory(item:HistoryItem){setHistory(prev=>{const next=[item,...prev].slice(0,100);localStorage.setItem("ycf-history",JSON.stringify(next));return next})}

 const results=useMemo(()=>{
   const q=keyword.trim().toLowerCase();
   return videos.filter(v=>{
     if(q&&!v.title.toLowerCase().includes(q))return false;
     if(from&&v.publishedAt&&new Date(v.publishedAt)<new Date(`${from}T00:00:00`))return false;
     if(to&&v.publishedAt&&new Date(v.publishedAt)>new Date(`${to}T23:59:59`))return false;
     return true;
   });
 },[videos,keyword,from,to]);

 async function search(more=false){
   if(!channelUrl.trim()){setError("Enter a YouTube channel URL.");return}
   setLoading(true);setError("");
   try{
     const p=new URLSearchParams({channel:channelUrl.trim(),filter});
     if(more&&cursor){p.set("cursor",cursor);if(channelId)p.set("channelId",channelId)}
     const r=await fetch(`/api/videos?${p}`);const d:SearchResponse=await r.json();
     if(!r.ok)throw Error(d.error||"Channel request failed.");
     setChannel(d.channel||{});setChannelId(d.channel?.channelId||d.diagnostics?.channelId||channelId);
     setVideos(v=>more?[...v,...(d.videos||[])]:d.videos||[]);setCursor(d.cursorNext);setSelected([]);setView("channel");
     addLog("search",`Loaded ${d.videos?.length||0} videos from ${d.channel?.title||channelUrl.trim()} (${d.diagnostics?.returnedItems??0} API items).`);
     if(!d.videos?.length)addLog("search","Search returned no normalized videos. The server diagnostics were: "+JSON.stringify(d.diagnostics||{}));
   }catch(e){const msg=e instanceof Error?e.message:"Search failed";setError(msg);addLog("search",msg)}finally{setLoading(false)}
 }

 function toggle(id:string){setSelected(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id])}
 function selectVisible(){setSelected(results.map(v=>v.videoId))}
 function clearSelection(){setSelected([])}

 async function saveAndDownload(v:Video){
   setDownloadState(v.videoId);setError("");
   try{
     const r=await fetch(`/api/download?videoId=${encodeURIComponent(v.videoId)}`);
     if(!r.ok){const d=await r.json().catch(()=>({}));throw Error(d.error||`Download failed (${r.status})`)}
     const b=await r.blob(),u=URL.createObjectURL(b),a=document.createElement("a");
     a.href=u;a.download=`${v.title.replace(/[<>:"/\\|?*]+/g,"_").slice(0,120)||v.videoId}.mp4`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);
     addHistory({id:id(),title:v.title,url:v.url,status:"success",time:new Date().toISOString()});
     addLog("download",`Downloaded: ${v.title}`);
   }catch(e){const msg=e instanceof Error?e.message:"Download failed";setError(msg);addHistory({id:id(),title:v.title,url:v.url,status:"error",time:new Date().toISOString(),message:msg});addLog("download",`${v.title}: ${msg}`)}finally{setDownloadState("")}
 }

 async function downloadSelected(){
   const queue=results.filter(v=>selected.includes(v.videoId));
   if(!queue.length)return;
   setError("");
   for(let i=0;i<queue.length;i++){setDownloadState(`${i+1}/${queue.length}`);await saveAndDownload(queue[i]);}
   setDownloadState("");
 }
 async function directDownload(){
   const vid=extractVideoId(directUrl);
   if(!vid){setError("Paste a valid YouTube video URL (watch, youtu.be, shorts, or live).");addLog("download","Invalid direct video URL entered.");return}
   await saveAndDownload({videoId:vid,title:`YouTube video ${vid}`,url:directUrl.trim()||`https://www.youtube.com/watch?v=${vid}`});
 }
 function copyAll(){navigator.clipboard.writeText(results.map(v=>v.url).join("\n"))}
 function csv(){const rows=[["Title","URL","Published","Views","Duration"],...results.map(v=>[v.title,v.url,v.publishedTimeText||v.publishedAt||"",String(v.views??""),duration(v.lengthSeconds)])].map(r=>r.map(esc).join(",")).join("\n");const b=new Blob([rows],{type:"text/csv"}),u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download="youtube-videos.csv";a.click();URL.revokeObjectURL(u)}
 function clearHistory(){setHistory([]);localStorage.removeItem("ycf-history")}
 function clearLogs(){setLogs([]);localStorage.removeItem("ycf-logs")}

 return <main className="shell">
   <header className="top"><div><span className="badge">YOUTUBE VIDEO WORKSPACE</span><h1>Channel → dashboard → download.</h1><p>Find a channel’s videos, choose exactly what you need, and queue downloads. Advanced filters stay out of the way.</p></div><nav className="nav">{[["channel","Channel"],["direct","Video URL"],["history","History"],["logs","Error log"]].map(([k,l])=><button key={k} className={view===k?"navActive":""} onClick={()=>{setView(k as typeof view);setError("")}}>{l}{k==="history"&&history.length?` ${history.length}`:""}</button>)}</nav></header>

   {view==="channel"&&<>
     <section className="panel searchPanel">
       <div className="labelRow"><div><label>Channel URL</label><input value={channelUrl} onChange={e=>setChannelUrl(e.target.value)} placeholder="https://www.youtube.com/@WWE" onKeyDown={e=>e.key==="Enter"&&search(false)}/></div><div className="control"><label>Content</label><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="videos_latest">Videos</option><option value="shorts_latest">Shorts</option><option value="streams_latest">Live streams</option></select></div></div>
       <div className="primaryRow"><button className="primary" onClick={()=>search(false)} disabled={loading}>{loading?"Loading channel…":"Search channel"}</button><button className="secondary" onClick={()=>{setChannelUrl("");setVideos([]);setChannel({});setSelected([]);setCursor(undefined);setChannelId("")}}>Clear</button><button className="advancedToggle" onClick={()=>setAdvanced(x=>!x)}>{advanced?"Hide advanced filters":"Advanced filters"}</button></div>
       {advanced&&<div className="advanced"><div><label>Keyword</label><input value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="Filter loaded videos by title"/></div><div><label>From</label><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div><div><label>To</label><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></div></div>}
       {error&&<div className="error"><strong>Problem</strong><span>{error}</span><button onClick={()=>setView("logs")}>Open error log</button></div>}
     </section>

     {channel.title&&<section className="channelCard">
       <div className="channelIdentity">{channel.avatar?<img src={channel.avatar} alt=""/>:<div className="avatarFallback">YT</div>}<div><span className="eyebrow">CHANNEL</span><h2>{channel.title}</h2><p>{channel.description||"Channel video dashboard"}</p></div></div>
       <div className="stats"><div><b>{fmt(channel.subscribers)}</b><span>Subscribers</span></div><div><b>{fmt(channel.views)}</b><span>Total views</span></div><div><b>{fmt(channel.videos)}</b><span>Videos</span></div></div>
     </section>}

     {videos.length>0&&<section className="toolbar panel"><div><strong>{results.length}</strong> visible <span className="dot">·</span> <strong>{selected.length}</strong> selected</div><div className="toolbarButtons"><button onClick={selected.length===results.length?clearSelection:selectVisible}>{selected.length===results.length?"Clear selection":"Select visible"}</button><button className="downloadAll" onClick={downloadSelected} disabled={!selected.length||!!downloadState}>{downloadState?`Downloading ${downloadState}…`:`Download selected (${selected.length})`}</button><button onClick={copyAll} disabled={!results.length}>Copy URLs</button><button onClick={csv} disabled={!results.length}>CSV</button></div></section>}

     <section className="results">
       {loading&&<div className="empty">Loading channel videos…</div>}
       {!loading&&videos.length>0&&<>{results.map(v=><article className={`video ${selected.includes(v.videoId)?"selected":""}`} key={v.videoId}>
         <label className="check"><input type="checkbox" checked={selected.includes(v.videoId)} onChange={()=>toggle(v.videoId)}/><span></span></label>
         <img src={v.thumbnail||`https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`} alt=""/>
         <div className="videoBody"><div className="titleLine"><h3>{v.title}</h3>{v.isLive&&<span className="live">LIVE</span>}</div><div className="meta">{v.publishedTimeText||v.publishedAt||"Date unavailable"}{v.views!=null?` · ${fmt(v.views)} views`:""}{v.lengthSeconds!=null?` · ${duration(v.lengthSeconds)}`:""}</div>{v.description&&<p className="description">{v.description}</p>}<div className="videoActions"><a href={v.url} target="_blank" rel="noreferrer">Open YouTube</a><button onClick={()=>navigator.clipboard.writeText(v.url)}>Copy URL</button><button className="download" onClick={()=>saveAndDownload(v)} disabled={!!downloadState}>{downloadState===v.videoId?"Preparing…":"Download"}</button><button className="detailsBtn" onClick={()=>setDetailsOpen(detailsOpen?false:true)}>Details</button></div></div>
       </article>)}</>}
       {!loading&&videos.length>0&&!results.length&&<div className="empty">No videos match the advanced filters. Clear the filters to see the loaded videos.</div>}
       {!loading&&channel.title&&!videos.length&&<div className="empty"><strong>Channel found, but no videos were returned.</strong><span>Open Error log for the API diagnostics.</span></div>}
       {cursor&&<button className="loadMore" onClick={()=>search(true)} disabled={loading}>{loading?"Loading…":"Load more videos"}</button>}
     </section>
     {detailsOpen&&<section className="detailNote panel"><strong>Video details</strong><p>Each card can expose title, publication time, view count, duration, description, live state, thumbnail, direct YouTube URL, and download action. More channel-level metadata is shown above.</p></section>}
   </>}

   {view==="direct"&&<section className="panel directPanel"><span className="eyebrow">DIRECT DOWNLOAD</span><h2>Paste a YouTube video URL</h2><p>Works with watch URLs, youtu.be links, Shorts, and Live URLs.</p><input value={directUrl} onChange={e=>setDirectUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." onKeyDown={e=>e.key==="Enter"&&directDownload()}/><div className="primaryRow"><button className="primary" onClick={directDownload} disabled={!!downloadState}>{downloadState?"Downloading…":"Download video"}</button><button className="secondary" onClick={()=>setDirectUrl("")}>Clear</button></div>{error&&<div className="error">{error}</div>}<div className="tip"><strong>Tip:</strong> download history is stored locally in this browser.</div></section>}

   {view==="history"&&<section><div className="sectionHead"><div><span className="eyebrow">LOCAL HISTORY</span><h2>Download history</h2></div><button onClick={clearHistory} disabled={!history.length}>Clear history</button></div><div className="list panel">{history.length?history.map(x=><div className="historyRow" key={x.id}><div><strong>{x.title}</strong><span>{new Date(x.time).toLocaleString()} · {x.status}</span>{x.message&&<small>{x.message}</small>}</div><a href={x.url} target="_blank" rel="noreferrer">Open</a></div>):<div className="emptyInner">No downloads yet.</div>}</div></section>}

   {view==="logs"&&<section><div className="sectionHead"><div><span className="eyebrow">DIAGNOSTICS</span><h2>Error & issue log</h2></div><button onClick={clearLogs} disabled={!logs.length}>Clear log</button></div><div className="list panel">{logs.length?logs.map(x=><div className={`logRow ${x.type}`} key={x.id}><div><span>{x.type}</span><strong>{x.message}</strong></div><time>{new Date(x.time).toLocaleString()}</time></div>):<div className="emptyInner">No issues logged.</div>}</div></section>}

   <footer>RapidAPI key remains server-side. Browser history/logs are local to this device.</footer>
 </main>
}
