import { getChatGPTUser } from '../../chatgpt-auth';
import { getDb } from '../../../db';
import { profiles,buddies,messages } from '../../../db/schema';
import { eq,and,or,asc,desc,gt } from 'drizzle-orm';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in to connect.'},{status:401});
 const db=getDb(), url=new URL(req.url);const [me]=await db.select().from(profiles).where(eq(profiles.id,user.userId));
 if(!me)return Response.json({me:null,buddies:[],messages:[]});
 await db.update(profiles).set({seen:Date.now()}).where(eq(profiles.id,user.userId));
 const links=await db.select().from(buddies).where(eq(buddies.owner,user.userId));
 const people=await db.select({id:profiles.id,name:profiles.name,away:profiles.away,seen:profiles.seen}).from(profiles).orderBy(asc(profiles.name));
 const target=url.searchParams.get('with');
 const rows=target?await db.select().from(messages).where(or(and(eq(messages.sender,user.userId),eq(messages.recipient,target)),and(eq(messages.sender,target),eq(messages.recipient,user.userId)))).orderBy(desc(messages.at)).limit(200):[];
 const inbox=await db.select({sender:messages.sender,at:messages.at}).from(messages).where(and(eq(messages.recipient,user.userId),gt(messages.at,Number(url.searchParams.get('since'))||Date.now()-86400000))).orderBy(desc(messages.at)).limit(50);
 return Response.json({me,buddies:people.filter(p=>links.some(l=>l.buddy===p.id)),directory:people.filter(p=>p.id!==user.userId),messages:rows.reverse(),inbox},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in to connect.'},{status:401});
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return Response.json({error:'Invalid origin'},{status:403});
 try{const data=await req.json() as Record<string,unknown>,db=getDb(); const [me]=await db.select().from(profiles).where(eq(profiles.id,user.userId));
 if(data.action==='profile'){
 const name=String(data.name||'').trim();if(!/^[a-zA-Z][a-zA-Z0-9_]{2,19}$/.test(name))return Response.json({error:'Use 3–20 letters, numbers, or underscores. Start with a letter.'},{status:400});
 const all=await db.select().from(profiles);if(all.some(p=>p.name.toLowerCase()===name.toLowerCase()&&p.id!==user.userId))return Response.json({error:'That screen name is taken.'},{status:409});
 await db.insert(profiles).values({id:user.userId,name,away:'',seen:Date.now()}).onConflictDoUpdate({target:profiles.id,set:{name,seen:Date.now()}});
 }else{
 if(!me)return Response.json({error:'Choose a screen name first.'},{status:400});
 if(data.action==='away')await db.update(profiles).set({away:String(data.away||'').slice(0,500),seen:Date.now()}).where(eq(profiles.id,user.userId));
 else if(data.action==='buddy'){
 const [target]=await db.select().from(profiles).where(eq(profiles.id,String(data.id)));if(!target||target.id===user.userId)return Response.json({error:'Buddy not found.'},{status:404});
 await db.insert(buddies).values({owner:user.userId,buddy:target.id}).onConflictDoNothing();
 }else if(data.action==='remove')await db.delete(buddies).where(and(eq(buddies.owner,user.userId),eq(buddies.buddy,String(data.id))));
 else if(data.action==='send'){
 const body=String(data.body||'').trim();if(!body||body.length>4000)return Response.json({error:'Messages must be 1–4,000 characters.'},{status:400});
 const [target]=await db.select().from(profiles).where(eq(profiles.id,String(data.id)));if(!target)return Response.json({error:'Buddy not found.'},{status:404});
 const recent=await db.select().from(messages).where(and(eq(messages.sender,user.userId),gt(messages.at,Date.now()-10000))).limit(16);if(recent.length>=15)return Response.json({error:'Give your keyboard a breather. Try again in a few seconds.'},{status:429});
 await db.insert(messages).values({id:crypto.randomUUID(),sender:user.userId,recipient:target.id,body,at:Date.now()});
 }else return Response.json({error:'Unknown action'},{status:400});
 }return Response.json({ok:true});
 }catch(e){console.error(e);return Response.json({error:'Could not save that change. Please try again.'},{status:500});}
}
