export async function assertRealWorldAction(client,userId) {
 const {error}=await client.rpc('assert_admin_real_action',{p_actor_id:userId});
 if(error){const failure=new Error(error.message);failure.statusCode=403;throw failure;}
}
export async function isPlatformAdmin(client,userId) {
 const {data,error}=await client.rpc('is_admin',{p_user_id:userId});
 if(error)throw error;return data===true;
}
