import { fetchPublicProfiles } from './publicProfiles';

async function allRows(query) {
  const rows=[];
  for(let offset=0;;offset+=1000) {
    const result=await query.range(offset,offset+999);
    if(result.error)throw result.error;
    rows.push(...(result.data||[]));
    if((result.data||[]).length<1000)return rows;
  }
}

// Both views load the same public history. Bounded ID batches avoid URL/header
// limits as Parliament's permanent archive grows; no historical rows are dropped.
export async function hydrateBillHistory(bills, client) {
  if (!bills.length) return [];
  const ids=bills.map(bill=>bill.id), votings=[], history=[], effects=[];
  const authors=await fetchPublicProfiles(bills.map(bill=>bill.author_id),client);
  for(let start=0;start<ids.length;start+=75) {
    const batch=ids.slice(start,start+75);
    const [votes,events,rules]=await Promise.all([
      allRows(client.from('parliament_votings').select('id,status,end_date,house_id,related_id,votes:parliament_voting_votes(vote,member_id)').eq('type','bill').in('related_id',batch).order('created_at',{ascending:false}).order('id')),
      allRows(client.from('bill_status_history').select('id,bill_id,status,event_label,occurred_at').in('bill_id',batch).order('occurred_at',{ascending:true}).order('id')),
      allRows(client.from('law_effects').select('id,source_id,effect_key,operation,effect_value,explanation,status,activated_at,effect_data,previous_snapshot,valid_from,valid_until').eq('source_kind','bill').in('source_id',batch).order('id')),
    ]);
    votings.push(...votes);history.push(...events);effects.push(...rules);
  }
  const group=(rows,key)=>rows.reduce((map,row)=>{(map[row[key]]||=[]).push(row);return map;},{});
  const votingMap=group(votings,'related_id'),historyMap=group(history,'bill_id'),effectMap=group(effects,'source_id');
  return bills.map(bill=>({...bill,author:authors.get(bill.author_id)||bill.author,votings:votingMap[bill.id]||[],status_history:historyMap[bill.id]||[],legal_effects:effectMap[bill.id]||[]}));
}
