import { request, rpc } from './world-test.mjs';

// These interface suites exercise forms, not global event popups. Acknowledge
// only this fixture citizen's notices through the real authorized RPCs, including
// consecutive events whose dialogs reuse the same button element.
export async function installWorldNoticeHandlers(page, person) {
  const acknowledge=async(types,field,procedure)=>{
    const pending=await request(person.client.from('notifications').select('id').eq('user_id',person.id).in('type',types).is(`metadata->>${field}`,null));
    for(const event of pending)await rpc(person.client,procedure,{p_notification_id:event.id});
    await page.waitForTimeout(400);
  };
  await page.addLocatorHandler(page.getByRole('button',{name:'Entendi',exact:true}),()=>acknowledge(['role_changed','election_candidacy_open','election_voting_open','election_result_published','institutional_result'],'popup_shown_at','acknowledge_role_change'),{noWaitAfter:true});
  await page.addLocatorHandler(page.getByRole('button',{name:'Continuar minha jornada',exact:true}),()=>acknowledge(['party_membership_confirmed','party_approved','party_founded','party_role_changed'],'celebration_seen_at','acknowledge_party_welcome'),{noWaitAfter:true});
}
